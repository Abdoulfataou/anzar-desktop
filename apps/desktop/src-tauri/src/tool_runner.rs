//! Exécution de commandes hors webview.
//!
//! La webview n'a plus accès au plugin shell : elle appelle `tool_spawn`,
//! `tool_wait` et `tool_kill`. La politique (programme, arguments, cwd) est
//! appliquée ici, avant tout `Command::new`, et aucun shell intermédiaire
//! (`sh -c`, `cmd /C`) n'est utilisé.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// Politique de commandes : source unique partagée avec TypeScript
/// (`src/services/agent/policy/commands.json`), incluse à la compilation — impossible de
/// la faire diverger entre les deux côtés sans casser ce test de parité.
#[allow(dead_code)]
#[derive(Deserialize)]
struct CommandLimits {
    #[serde(rename = "maxArgs")]
    max_args: usize,
    #[serde(rename = "maxArgChars")]
    max_arg_chars: usize,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct CommandProgram {
    name: String,
    #[serde(default)]
    agent: bool,
    #[serde(default)]
    install: bool,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct CommandsPolicy {
    version: u32,
    limits: CommandLimits,
    programs: Vec<CommandProgram>,
}

const COMMANDS_POLICY_JSON: &str = include_str!("../../src/services/agent/policy/commands.json");

fn commands_policy() -> &'static CommandsPolicy {
    static POLICY: OnceLock<CommandsPolicy> = OnceLock::new();
    POLICY.get_or_init(|| serde_json::from_str(COMMANDS_POLICY_JSON).expect("commands.json invalide"))
}

fn is_allowed_program(name: &str) -> bool {
    commands_policy().programs.iter().any(|p| p.name == name)
}

#[derive(Default)]
pub struct ToolState {
    procs: Arc<Mutex<HashMap<String, Arc<Proc>>>>,
}

struct Proc {
    child: Arc<Mutex<Child>>,
    /// Séquence du journal réseau au lancement : les refus postérieurs concernent cette commande.
    blocked_seq: u64,
    status: (Mutex<Option<i32>>, Condvar),
    stdout: Mutex<String>,
    stderr: Mutex<String>,
    killed: AtomicBool,
    /// Windows : job object de la commande (arrêt de toute l'arborescence).
    #[cfg(windows)]
    job: Option<crate::winjob::Job>,
}

#[derive(Clone, Serialize)]
struct ToolOutput {
    id: String,
    stream: String,
    line: String,
}

#[derive(Serialize)]
pub struct ToolWaitResult {
    code: i32,
    stdout: String,
    stderr: String,
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 128 || !id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
        return Err("Identifiant de processus invalide.".into());
    }
    Ok(())
}

/// `approved` : l'utilisateur a accepté CETTE commande d'installation dans ANZAR
/// (carte « L'agent demande ton accord »). Sans accord, l'installation reste refusée.
fn validate_args(program: &str, args: &[String], approved: bool) -> Result<(), String> {
    let limits = &commands_policy().limits;
    if args.len() > limits.max_args {
        return Err(format!("Trop d'arguments (max {}).", limits.max_args));
    }
    for a in args {
        if a.contains('\r') || a.contains('\n') || a.chars().count() > limits.max_arg_chars {
            return Err(format!(
                "Argument invalide (retour à la ligne ou plus de {} caractères).",
                limits.max_arg_chars
            ));
        }
    }
    let first = args.first().map(|s| s.as_str()).unwrap_or("");
    let second = args.get(1).map(|s| s.as_str()).unwrap_or("");
    match program {
        "node" if matches!(first, "-e" | "--eval" | "-p" | "--print") => {
            return Err("node -e/--eval/-p est refusé.".into());
        }
        "python" | "python3" if first == "-c" => {
            return Err("python -c est refusé. Écris un fichier .py puis exécute-le.".into());
        }
        "python" | "python3" if first == "-m" && second.is_empty() => {
            return Err("Module Python manquant.".into());
        }
        "git" if first == "config" || first == "-c" => {
            return Err("git config / git -c est refusé (hooks et fsmonitor).".into());
        }
        "git" if first == "push" || (first == "remote" && second == "add") => {
            return Err("git push / git remote add est refusé par la politique locale.".into());
        }
        "git" if first == "reset" && second == "--hard" => {
            return Err("git reset --hard est refusé par la politique locale.".into());
        }
        "git" if first == "clean" && second.starts_with('-') => {
            return Err("git clean est refusé par la politique locale.".into());
        }
        "npm" if matches!(first, "exec" | "publish") => {
            return Err("npm exec / npm publish est refusé par la politique locale.".into());
        }
        "npm" if matches!(first, "install" | "i" | "ci" | "add") && !approved => {
            return Err("Installation npm refusée sans ton accord : l'agent doit la demander (carte d'accord).".into());
        }
        "pip" | "pip3" if first == "install" && !approved => {
            return Err("Installation pip refusée sans ton accord : l'agent doit la demander (carte d'accord).".into());
        }
        "cargo" if first == "install" => {
            return Err("cargo install refusé dans ce chemin.".into());
        }
        _ => {}
    }
    Ok(())
}

fn validate_dir(root: &str, cwd: &str) -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    let home = crate::roots::home()?;
    let root_p = std::fs::canonicalize(root).map_err(|_| "Dossier projet introuvable.".to_string())?;
    let cwd_p = std::fs::canonicalize(cwd).map_err(|_| "Dossier de travail introuvable.".to_string())?;
    if !root_p.starts_with(&home) || !cwd_p.starts_with(&home) {
        return Err("Dossier hors du répertoire utilisateur.".into());
    }
    if !cwd_p.starts_with(&root_p) {
        return Err("Dossier de travail hors du projet.".into());
    }
    Ok((root_p, cwd_p))
}

/// Cherche un programme dans le PATH de l'app (sandbox-exec ne dit pas clairement qu'il manque).
fn find_in_path(program: &str) -> Option<std::path::PathBuf> {
    let path = crate::mcp::enriched_path();
    std::env::split_paths(&path).map(|dir| dir.join(program)).find(|p| p.is_file())
}

/// Fait passer les outils par le proxy local (npm, pip, cargo, git respectent ces variables).
fn apply_proxy_env(cmd: &mut Command, port: u16) {
    let proxy = format!("http://127.0.0.1:{port}");
    for key in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"] {
        cmd.env(key, &proxy);
    }
    cmd.env("NO_PROXY", "localhost,127.0.0.1,::1");
    cmd.env("no_proxy", "localhost,127.0.0.1,::1");
    // npm lit sa configuration par variables d'environnement `npm_config_*`.
    cmd.env("npm_config_proxy", &proxy);
    cmd.env("npm_config_https_proxy", &proxy);
    // Node 24+ : `fetch` honore les variables d'environnement avec ce drapeau.
    cmd.env("NODE_USE_ENV_PROXY", "1");
}

fn apply_base_env(cmd: &mut Command) {
    cmd.env_clear();
    for key in ["HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TERM", "TZ",
                "SYSTEMROOT", "WINDIR", "ComSpec", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA"] {
        if let Ok(v) = std::env::var(key) {
            cmd.env(key, v);
        }
    }
    cmd.env("PATH", crate::mcp::enriched_path());
}

fn spawn_reader<R: Read + Send + 'static>(pipe: R, id: String, stream: &'static str,
                                          app: AppHandle, target: Arc<Proc>) {
    std::thread::spawn(move || {
        let reader = BufReader::new(pipe);
        for line in reader.lines().map_while(Result::ok) {
            if stream == "stdout" {
                if let Ok(mut s) = target.stdout.lock() { s.push_str(&line); s.push('\n'); }
            } else if let Ok(mut s) = target.stderr.lock() { s.push_str(&line); s.push('\n'); }
            let _ = app.emit("tool://output", ToolOutput { id: id.clone(), stream: stream.into(), line });
        }
    });
}

fn spawn_waiter(child: Arc<Mutex<Child>>, id: String, app: AppHandle, target: Arc<Proc>) {
    std::thread::spawn(move || {
        let code = loop {
            let mut c = match child.lock() { Ok(c) => c, Err(_) => break 1 };
            match c.try_wait() {
                Ok(Some(status)) => break status.code().unwrap_or(1),
                Ok(None) => {}
                Err(_) => break 1,
            }
            drop(c);
            std::thread::sleep(Duration::from_millis(100));
        };
        *target.status.0.lock().unwrap() = Some(code);
        target.status.1.notify_all();
        let _ = app.emit("tool://exit", serde_json::json!({ "id": id, "code": code }));
    });
}

#[tauri::command]
pub fn tool_spawn(
    app: AppHandle,
    state: State<'_, ToolState>,
    id: String,
    program: String,
    args: Vec<String>,
    cwd: String,
    root: String,
    sandbox: Option<bool>,
    approved: Option<bool>,
    network: Option<bool>,
    proxy: Option<bool>,
    proxy_hosts: Option<Vec<String>>,
) -> Result<u32, String> {
    validate_id(&id)?;
    // Liste d'hôtes autorisés fournie par les réglages (s'applique aussi sans redémarrage).
    if let Some(hosts) = proxy_hosts {
        crate::netproxy::set_extra_hosts(hosts);
    }
    let program = program.trim().to_lowercase();
    if program.contains('/') || program.contains('\\') || !is_allowed_program(&program) {
        return Err("Programme non autorisé.".into());
    }
    validate_args(&program, &args, approved.unwrap_or(false))?;
    let (root_p, cwd_p) = validate_dir(&root, &cwd)?;
    if !crate::roots::is_allowed_root(&app, &root_p) {
        return Err("Dossier non autorisé : ouvre-le d'abord comme projet dans ANZAR.".into());
    }

    // Isolation (macOS) : activée sauf si le réglage « Isoler les commandes » est coupé.
    let isolated = sandbox.unwrap_or(true) && crate::sandbox::available();
    if isolated && find_in_path(&program).is_none() {
        return Err(format!("« {program} » est introuvable sur cet ordinateur."));
    }
    // Réseau : réglage « Réseau des commandes » ouvert, ou commande qui télécharge.
    let net = network.unwrap_or(false)
        || crate::sandbox::network_allowed(&program, &args, approved.unwrap_or(false));
    // Filtrage : quand il est actif, la commande ne sort que par le proxy (localhost) et le
    // proxy n'ouvre que les hôtes autorisés. S'il ne démarre pas, on garde le comportement
    // précédent plutôt que de bloquer l'utilisateur.
    let proxy_port = if proxy.unwrap_or(false) && net { crate::netproxy::ensure() } else { None };
    let allow_network = net && proxy_port.is_none();
    let wrapped = if isolated {
        crate::sandbox::wrap(&program, &args, &root_p, allow_network)
    } else {
        crate::sandbox::Wrapped { program: program.clone(), args: args.clone() }
    };

    let mut cmd = Command::new(&wrapped.program);
    cmd.args(&wrapped.args)
        .current_dir(&cwd_p)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_base_env(&mut cmd);
    if let Some(port) = proxy_port {
        apply_proxy_env(&mut cmd, port);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!("« {program} » est introuvable sur cet ordinateur.")
        } else {
            format!("Lancement impossible : {e}")
        }
    })?;
    let pid = child.id();
    #[cfg(windows)]
    let job = crate::winjob::Job::assign(&child);
    let stdout = child.stdout.take().ok_or("Sortie indisponible")?;
    let stderr = child.stderr.take().ok_or("Sortie d'erreur indisponible")?;
    let child = Arc::new(Mutex::new(child));
    let target = Arc::new(Proc {
        child: child.clone(),
        blocked_seq: crate::netproxy::blocked_seq(),
        status: (Mutex::new(None), Condvar::new()),
        stdout: Mutex::new(String::new()),
        stderr: Mutex::new(String::new()),
        killed: AtomicBool::new(false),
        #[cfg(windows)]
        job,
    });
    spawn_reader(stdout, id.clone(), "stdout", app.clone(), target.clone());
    spawn_reader(stderr, id.clone(), "stderr", app.clone(), target.clone());
    spawn_waiter(child, id.clone(), app, target.clone());
    state.procs.lock().unwrap().insert(id, target);
    Ok(pid)
}

/// Attend la fin d'un processus. L'attente bloquante tourne sur un thread dédié
/// (`spawn_blocking`) : une commande longue ne gèle ni la fenêtre ni l'IPC.
#[tauri::command]
pub async fn tool_wait(
    state: State<'_, ToolState>,
    id: String,
) -> Result<ToolWaitResult, String> {
    let proc = {
        let procs = state.procs.lock().unwrap();
        procs.get(&id).cloned().ok_or("Processus inconnu.")?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let (lock, cv) = &proc.status;
        let mut guard = lock.lock().unwrap();
        while guard.is_none() {
            guard = cv
                .wait_timeout(guard, Duration::from_secs(3600))
                .map_err(|e| e.to_string())?
                .0;
            if guard.is_none() && proc.killed.load(Ordering::SeqCst) {
                break;
            }
        }
        let code = guard.unwrap_or(1);
        let stdout = proc.stdout.lock().unwrap().clone();
        let mut stderr = proc.stderr.lock().unwrap().clone();
        // Hôtes refusés par le filtre réseau pendant cette commande : l'agent (et
        // l'utilisateur) doivent savoir quoi autoriser, sinon l'échec est incompréhensible.
        let blocked = crate::netproxy::blocked_hosts_since(proc.blocked_seq);
        if !blocked.is_empty() {
            stderr.push_str(&format!(
                "\n[ANZAR] Hôtes bloqués par le filtre réseau : {}. Ajoute-les dans Paramètres → Réseau si c'est légitime.",
                blocked.join(", ")
            ));
        }
        Ok(ToolWaitResult { code, stdout, stderr })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn tool_kill(state: State<'_, ToolState>, id: String) -> Result<(), String> {
    let proc = state.procs.lock().unwrap().get(&id).cloned().ok_or("Processus inconnu.")?;
    proc.killed.store(true, Ordering::SeqCst);
    #[cfg(windows)]
    if let Some(job) = &proc.job {
        job.terminate(130);
    }
    let mut child = proc.child.lock().unwrap();
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &format!("-{}", child.id())])
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
    *proc.status.0.lock().unwrap() = Some(130);
    proc.status.1.notify_all();
    Ok(())
}


#[cfg(test)]
mod security_tests {
    use super::*;

    fn args(v: &[&str]) -> Vec<String> { v.iter().map(|s| s.to_string()).collect() }

    #[test]
    fn refuses_inline_code_and_git_config() {
        assert!(validate_args("node", &args(&["-e", "1"]), false).is_err());
        assert!(validate_args("python3", &args(&["-c", "print(1)"]), false).is_err());
        assert!(validate_args("git", &args(&["config", "core.fsmonitor", "x"]), false).is_err());
        assert!(validate_args("git", &args(&["-c", "core.hooksPath=x", "status"]), false).is_err());
        assert!(validate_args("git", &args(&["push"]), false).is_err());
        assert!(validate_args("npm", &args(&["install"]), false).is_err());
        assert!(validate_args("npm", &args(&["install", "react"]), true).is_ok());
        assert!(validate_args("npm", &args(&["publish"]), true).is_err());
        assert!(validate_args("npm", &args(&["exec", "x"]), true).is_err());
        assert!(validate_args("cargo", &args(&["install", "x"]), true).is_err());
        assert!(validate_args("git", &args(&["status"]), false).is_ok());
        assert!(validate_args("npm", &args(&["run", "build"]), false).is_ok());
    }

    #[test]
    fn command_policy_matches_the_shared_manifest() {
        let policy = commands_policy();
        assert_eq!(policy.version, 1);
        assert_eq!(policy.limits.max_args, 8);
        assert_eq!(policy.limits.max_arg_chars, 400);
        for name in ["npm", "node", "git", "cargo", "python", "python3", "pip", "pip3", "ffmpeg", "ffprobe", "rg"] {
            assert!(is_allowed_program(name), "{name} absent de commands.json");
        }
        assert!(!is_allowed_program("curl"));
        assert!(!is_allowed_program("npx"));
        // Chaque programme destiné à l'agent doit aussi être autorisé côté Rust.
        assert!(policy.programs.iter().filter(|p| p.agent).all(|p| is_allowed_program(&p.name)));
    }

    #[test]
    fn refuses_paths_outside_home_or_root() {
        let home = dirs::home_dir().unwrap();
        let base = home.join(format!(".anzar-tool-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("sub")).unwrap();
        assert!(validate_dir(base.to_str().unwrap(), base.join("sub").to_str().unwrap()).is_ok());
        assert!(validate_dir(base.to_str().unwrap(), "/tmp").is_err());
        assert!(validate_dir("/tmp", base.to_str().unwrap()).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }
}
