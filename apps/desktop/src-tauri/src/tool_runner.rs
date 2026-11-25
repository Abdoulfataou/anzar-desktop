//! Exécution de commandes hors webview.
//!
//! La webview n'a plus accès au plugin shell : elle appelle `tool_spawn`,
//! `tool_wait` et `tool_kill`. La politique (programme, arguments, cwd) est
//! appliquée ici, avant tout `Command::new`. Deux chemins existent :
//! - `run_command` : un programme de la liste, sans shell intermédiaire ;
//! - `bash` : une ligne `bash -c`, acceptée seulement quand l'isolation système est
//!   disponible (macOS). La frontière est alors le profil Seatbelt, pas une liste blanche.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct ToolState {
    procs: Arc<Mutex<HashMap<String, Arc<Proc>>>>,
}

struct Proc {
    child: Arc<Mutex<Child>>,
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

/// Cherche `program` dans `path` en essayant les extensions données (Windows : .exe, .cmd, .bat).
#[cfg_attr(not(windows), allow(dead_code))]
fn resolve_with_exts(program: &str, path: &str, exts: &[&str]) -> Option<std::path::PathBuf> {
    std::env::split_paths(path).find_map(|dir| {
        exts.iter().map(|e| dir.join(format!("{program}{e}"))).find(|p| p.is_file())
    })
}

/// Une commande de shell mentionne-t-elle un port local réservé aux connecteurs ?
/// Heuristique de défense en profondeur : Seatbelt ne peut pas exprimer « localhost sauf ces
/// ports » sans couper le reste du réseau.
fn mentions_blocked_local_app(command: &str) -> bool {
    if command.contains("audacity_script_pipe") {
        return true;
    }
    let tokens: Vec<&str> = command.split(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '=' | '/' | ',' | ';' | '&' | '|')).collect();
    tokens.iter().any(|t| {
        let t = t.trim_matches(|c: char| !c.is_ascii_digit());
        matches!(t, "9876" | "9877" | "4455") || t.ends_with(":9876") || t.ends_with(":9877") || t.ends_with(":4455")
    })
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

/// `python` → `python3` et `pip` → `pip3` quand seul le second existe (cas de macOS).
fn python3_fallback(program: String, exists: impl Fn(&str) -> bool) -> String {
    if cfg!(windows) {
        return program;
    }
    let alt = match program.as_str() {
        "python" => "python3",
        "pip" => "pip3",
        _ => return program,
    };
    if !exists(&program) && exists(alt) { alt.to_string() } else { program }
}

/// Cherche un programme dans le PATH de l'app (sandbox-exec ne dit pas clairement qu'il manque).
fn find_in_path(program: &str) -> Option<std::path::PathBuf> {
    let path = crate::mcp::enriched_path();
    std::env::split_paths(&path).map(|dir| dir.join(program)).find(|p| p.is_file())
}

/// Environnement de base des commandes (pas de proxy : réseau libre comme Harness).
fn apply_base_env(cmd: &mut Command) {
    cmd.env_clear();
    for key in ["HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TERM", "TZ",
                "SYSTEMROOT", "WINDIR", "ComSpec", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
                // Emplacements des SDK (pas des secrets) : Java, Android, Flutter, Go, .NET, Ruby, Xcode…
                "JAVA_HOME", "ANDROID_HOME", "ANDROID_SDK_ROOT", "FLUTTER_ROOT", "PUB_CACHE", "CHROME_EXECUTABLE",
                "GOPATH", "GOROOT", "DOTNET_ROOT", "GEM_HOME", "GEM_PATH", "DEVELOPER_DIR",
                "CARGO_HOME", "RUSTUP_HOME", "PNPM_HOME", "BUN_INSTALL", "DENO_DIR", "COMPOSER_HOME",
                "GRADLE_USER_HOME", "PYENV_ROOT"] {
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
    shell: Option<bool>,
    shell_command: Option<String>,
    escalated: Option<bool>,
    escalation_reason: Option<String>,
) -> Result<u32, String> {
    validate_id(&id)?;
    let use_shell = shell.unwrap_or(false);
    let escalated = escalated.unwrap_or(false);
    if escalated && escalation_reason.as_deref().unwrap_or("").trim().is_empty() {
        return Err("Élévation refusée : une justification est obligatoire.".into());
    }
    let (program, args) = if use_shell {
        // Shell confiné : la frontière est l'isolation du système d'exploitation. Sans
        // elle, un shell complet serait une porte ouverte : on refuse plutôt que de
        // laisser croire que la commande est isolée.
        if !crate::sandbox::available() {
            return Err("Le shell confiné n'est pas disponible sur cet ordinateur : utilise run_command.".into());
        }
        let command = shell_command.unwrap_or_default();
        let trimmed = command.trim();
        if trimmed.is_empty() {
            return Err("Commande vide.".into());
        }
        if trimmed.chars().count() > 20_000 {
            return Err("Commande trop longue (max 20 000 caractères).".into());
        }
        if trimmed.contains('\0') {
            return Err("Commande invalide (caractère NUL).".into());
        }
        if mentions_blocked_local_app(trimmed) {
            return Err(
                "Les ports locaux 9876 (Blender), 9877 (GIMP) et 4455 (OBS), ainsi que le tube \
                 d'Audacity, sont réservés aux connecteurs d'ANZAR : une commande ne doit pas les utiliser."
                    .into(),
            );
        }
        if find_in_path("bash").is_none() && !std::path::Path::new("/bin/bash").exists() {
            return Err("bash est introuvable sur cet ordinateur.".into());
        }
        ("bash".to_string(), vec!["-c".to_string(), command])
    } else {
        // macOS n'a que `python3` / `pip3` : l'agent écrit souvent `python` ou `pip`.
        let program = python3_fallback(program.trim().to_lowercase(), |p| find_in_path(p).is_some());
        (program, args)
    };
    if !use_shell && mentions_blocked_local_app(&format!("{program} {}", args.join(" "))) {
        return Err(
            "Les ports locaux 9876 (Blender), 9877 (GIMP) et 4455 (OBS), ainsi que le tube \
             d'Audacity, sont réservés aux connecteurs d'ANZAR : une commande ne doit pas les utiliser."
                .into(),
        );
    }
    let (root_p, cwd_p) = validate_dir(&root, &cwd)?;
    if !crate::roots::is_allowed_root(&app, &root_p) {
        return Err("Dossier non autorisé : ouvre-le d'abord comme projet dans ANZAR.".into());
    }
    // `./gradlew` : script du projet, résolu dans le dossier de travail (jamais via le PATH).
    let gradlew_path = if !use_shell && program == "gradlew" {
        let file = cwd_p.join(if cfg!(windows) { "gradlew.bat" } else { "gradlew" });
        let real = std::fs::canonicalize(&file)
            .map_err(|_| "Pas de script gradlew dans ce dossier.".to_string())?;
        if !real.starts_with(&root_p) {
            return Err("Le script gradlew est hors du projet.".into());
        }
        Some(real)
    } else {
        None
    };

    let isolated = sandbox.unwrap_or(true) && crate::sandbox::available();
    if isolated && !use_shell && gradlew_path.is_none() && find_in_path(&program).is_none() {
        return Err(format!("« {program} » est introuvable sur cet ordinateur."));
    }
    let exe: String = if use_shell {
        "/bin/bash".to_string()
    } else {
        match &gradlew_path {
            Some(p) => p.to_string_lossy().into_owned(),
            None => {
                #[cfg(windows)]
                {
                    resolve_with_exts(&program, &crate::mcp::enriched_path(), &[".exe", ".cmd", ".bat"])
                        .map(|p| p.to_string_lossy().into_owned())
                        .unwrap_or_else(|| program.clone())
                }
                #[cfg(not(windows))]
                {
                    program.clone()
                }
            }
        }
    };
    let wrapped = if isolated && !escalated {
        crate::sandbox::wrap(&exe, &args, &root_p)
    } else {
        crate::sandbox::Wrapped { program: exe.clone(), args: args.clone() }
    };

    let mut cmd = Command::new(&wrapped.program);
    cmd.args(&wrapped.args)
        .current_dir(&cwd_p)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_base_env(&mut cmd);
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
        let stderr = proc.stderr.lock().unwrap().clone();
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
        let pgid = child.id();
        let _ = Command::new("kill")
            .args(["-TERM", &format!("-{pgid}")])
            .status();
        // Un sous-processus qui ignore SIGTERM (démon de build, serveur) ne doit pas
        // survivre au bouton Stop : SIGKILL sur tout le groupe peu après.
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(1500));
            let _ = Command::new("kill").args(["-KILL", &format!("-{pgid}")]).status();
        });
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

    #[test]
    fn connector_ports_and_audacity_are_still_blocked() {
        assert!(mentions_blocked_local_app("nc 127.0.0.1 9876"));
        assert!(mentions_blocked_local_app("curl http://localhost:9877/x"));
        assert!(mentions_blocked_local_app("cat /tmp/audacity_script_pipe.to.x"));
        assert!(!mentions_blocked_local_app("npm test -- --run"));
        assert!(!mentions_blocked_local_app("echo 44550"));
        let only3 = |p: &str| p == "python3" || p == "pip3";
        if !cfg!(windows) {
            assert_eq!(python3_fallback("python".into(), only3), "python3");
            assert_eq!(python3_fallback("pip".into(), only3), "pip3");
        }
        assert_eq!(python3_fallback("python".into(), |_| true), "python");
    }

    #[test]
    fn windows_extension_lookup() {
        let dir = std::env::temp_dir().join(format!("anzar-exts-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("flutter.bat"), "").unwrap();
        let path = std::env::join_paths([&dir]).unwrap().to_string_lossy().into_owned();
        assert_eq!(resolve_with_exts("flutter", &path, &[".exe", ".cmd", ".bat"]), Some(dir.join("flutter.bat")));
        assert_eq!(resolve_with_exts("dart", &path, &[".exe", ".cmd", ".bat"]), None);
        let _ = std::fs::remove_dir_all(&dir);
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
