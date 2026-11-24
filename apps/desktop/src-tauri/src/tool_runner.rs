//! Exécution de commandes hors webview.
//!
//! La webview n'a plus accès au plugin shell : elle appelle `tool_spawn`,
//! `tool_wait` et `tool_kill`. La politique (programme, arguments, cwd) est
//! appliquée ici, avant tout `Command::new`. Deux chemins existent :
//! - `run_command` : un programme de la liste, sans shell intermédiaire ;
//! - `bash` : une ligne `bash -c`, acceptée seulement quand l'isolation système est
//!   disponible (macOS). La frontière est alors le profil Seatbelt, pas une liste blanche.

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
    /// Sous-commandes qui installent ou téléchargent du code : accord de l'utilisateur + réseau.
    /// "" = toute invocation, "<none>" = programme lancé sans argument.
    #[serde(default)]
    installs: Vec<String>,
    /// Sous-commandes qui ont besoin d'internet sans être des installations (build, run…).
    #[serde(default)]
    network: Vec<String>,
    /// Sous-commandes toujours refusées.
    #[serde(default)]
    deny: Vec<DenyRule>,
    /// Sous-commandes qui lancent un autre programme (`npx X`, `bundle exec X`…) : X ne
    /// doit pas être un programme interdit.
    #[serde(default)]
    launches: Vec<String>,
}

#[derive(Deserialize)]
struct DenyRule {
    args: String,
    reason: String,
}

#[derive(Deserialize, Default)]
struct DeniedPrograms {
    #[serde(default)]
    names: Vec<String>,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct CommandsPolicy {
    version: u32,
    limits: CommandLimits,
    programs: Vec<CommandProgram>,
    #[serde(default, rename = "deniedPrograms")]
    denied_programs: DeniedPrograms,
}

const COMMANDS_POLICY_JSON: &str = include_str!("../../src/services/agent/policy/commands.json");

fn commands_policy() -> &'static CommandsPolicy {
    static POLICY: OnceLock<CommandsPolicy> = OnceLock::new();
    POLICY.get_or_init(|| serde_json::from_str(COMMANDS_POLICY_JSON).expect("commands.json invalide"))
}

fn is_allowed_program(name: &str) -> bool {
    commands_policy().programs.iter().any(|p| p.name == name)
}

fn program_rule(name: &str) -> Option<&'static CommandProgram> {
    commands_policy().programs.iter().find(|p| p.name == name)
}

/// Programme jamais lancé par l'agent, même avec l'accord de l'utilisateur
/// (shells, sudo, outils réseau bruts, outils système…).
pub(crate) fn is_denied_program(name: &str) -> bool {
    let n = name.trim().to_lowercase();
    let base = n.trim_end_matches(".exe").trim_end_matches(".cmd").trim_end_matches(".bat");
    commands_policy().denied_programs.names.iter().any(|d| d == base)
}

/// Nom de programme simple (pas de chemin, pas d'espace) : `flutter`, `go`, `my-cli`…
pub(crate) fn is_valid_program_name(name: &str) -> bool {
    let len = name.chars().count();
    (1..=64).contains(&len)
        && name.chars().next().map(|c| c.is_ascii_alphanumeric()).unwrap_or(false)
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '+'))
}

/// Arguments positionnels (sans les options `-x` / `--xyz`), en minuscules.
fn positional(args: &[String]) -> Vec<String> {
    args.iter().filter(|a| !a.starts_with('-')).map(|a| a.to_lowercase()).collect()
}

/// Options de lanceurs suivies d'une valeur (`xcrun --sdk iphoneos X`, `npx -p pkg X`…).
const VALUE_OPTIONS: &[&str] = &["--sdk", "-sdk", "--toolchain", "-toolchain", "-p", "--package", "--with",
                                 "--from", "--python", "--directory", "--cwd", "-C", "--project"];

/// Programme lancé par un lanceur : premier argument positionnel après les `skip` mots de la
/// sous-commande, en sautant les valeurs des options connues.
fn launch_target(args: &[String], skip: usize) -> Option<String> {
    let mut seen = 0;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if a.starts_with('-') {
            if !a.contains('=') && VALUE_OPTIONS.contains(&a.as_str()) {
                it.next();
            }
            continue;
        }
        if seen == skip {
            return Some(a.to_lowercase());
        }
        seen += 1;
    }
    None
}

/// La règle (« pub get », « install », "" ou "<none>") correspond-elle au début des arguments ?
fn matches_rule(pos: &[String], rule: &str) -> bool {
    match rule.trim() {
        "" => true,
        "<none>" => pos.is_empty(),
        r => {
            let words: Vec<&str> = r.split_whitespace().collect();
            words.len() <= pos.len() && words.iter().zip(pos).all(|(w, p)| *w == p.as_str())
        }
    }
}

/// La commande installe-t-elle ou télécharge-t-elle du code (accord nécessaire) ?
pub(crate) fn is_install(program: &str, args: &[String]) -> bool {
    let pos = positional(args);
    program_rule(program).map(|p| p.installs.iter().any(|r| matches_rule(&pos, r))).unwrap_or(false)
}

/// La commande a-t-elle besoin d'internet hors installation (build, run…) ?
pub(crate) fn needs_network(program: &str, args: &[String]) -> bool {
    let pos = positional(args);
    program_rule(program).map(|p| p.network.iter().any(|r| matches_rule(&pos, r))).unwrap_or(false)
}

#[derive(Default)]
pub struct ToolState {
    procs: Arc<Mutex<HashMap<String, Arc<Proc>>>>,
}

struct Proc {
    child: Arc<Mutex<Child>>,
    /// Séquence du journal réseau au lancement : les refus postérieurs concernent cette commande.
    blocked_seq: u64,
    /// La commande devait passer par le relais réseau (variables de proxy fournies).
    proxied: bool,
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
        // Options qui déplacent le dépôt ou choisissent un modèle : elles contourneraient la
        // protection des hooks et de la config (dossier .git ailleurs, hooks du modèle).
        "git" if args.iter().any(|a| {
            let a = a.as_str();
            a == "-C"
                || ["--git-dir", "--work-tree", "--separate-git-dir", "--template", "--exec-path", "--config-env", "--super-prefix"]
                    .iter()
                    .any(|o| a == *o || a.starts_with(&format!("{o}=")))
        }) => {
            return Err("Option git refusée (-C, --git-dir, --work-tree, --separate-git-dir, --template…) : le dépôt reste dans le projet, avec ses hooks protégés.".into());
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
        "cargo" if first == "install" && !approved => {
            return Err("cargo install refusé sans ton accord : l'agent doit le demander (carte d'accord).".into());
        }
        _ => {}
    }
    // Règles de commands.json (partagées avec l'interface)
    if let Some(rule) = program_rule(program) {
        let pos = positional(args);
        if let Some(d) = rule.deny.iter().find(|d| matches_rule(&pos, &d.args)) {
            return Err(format!("« {program} {} » est refusé : {}.", d.args, d.reason));
        }
        for launch in &rule.launches {
            if !matches_rule(&pos, launch) {
                continue;
            }
            if let Some(target) = launch_target(args, launch.split_whitespace().count()) {
                let name = target.rsplit(['/', '\\']).next().unwrap_or(&target).to_string();
                if is_denied_program(&name) {
                    return Err(format!("« {program} » ne peut pas lancer « {name} » : programme interdit à l'agent."));
                }
            }
        }
        if !approved && rule.installs.iter().any(|r| matches_rule(&pos, r)) {
            return Err(format!(
                "« {program} {} » installe ou télécharge du code : il faut ton accord (carte d'accord).",
                pos.first().map(|s| s.as_str()).unwrap_or("")
            ));
        }
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

/// Opérations que le shell ne doit pas exécuter, même en Accès complet : elles engagent
/// le dépôt de l'utilisateur ou élèvent les droits. La liste reste volontairement courte ;
/// le reste est borné par Seatbelt et par les règles du prompt.
fn forbidden_shell_operation(command: &str) -> Option<&'static str> {
    let tokens: Vec<&str> = command
        .split(|c: char| c.is_whitespace() || matches!(c, ';' | '&' | '|' | '(' | ')' | '`'))
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.contains(&"sudo") {
        return Some("« sudo » est interdit à l'agent : ne cherche pas à élever tes droits.");
    }
    if tokens.iter().any(|t| t.contains(".git/hooks") || t.contains(".git/config") || t.ends_with("/.git")) {
        return Some("Les hooks et la configuration Git du projet restent protégés, même avec une élévation : ne les écris pas à la main.");
    }
    let secret = tokens.iter().find(|t| {
        let t = t.trim_matches(|c: char| matches!(c, '"' | '\''));
        t == ".env"
            || (t.starts_with(".env.")
                && !t.ends_with(".example")
                && !t.ends_with(".sample")
                && !t.ends_with(".template"))
            || t.ends_with("/.env")
            || t.ends_with("/.env.local")
            || t.contains("/.ssh/")
            || t.contains("/.aws/")
            || t.contains("/.gnupg/")
            || t.contains("/.kube/")
            || t.ends_with("/.netrc")
            || t.ends_with("/.git-credentials")
            || t.ends_with("id_rsa")
            || t.ends_with("id_ed25519")
            || t.ends_with(".pem")
            || t.ends_with(".key")
    });
    if let Some(secret) = secret {
        return Some(if secret.contains(".env") {
            "Le fichier .env contient des secrets : ne le lis pas et ne le transmets pas. Demande à l'utilisateur les variables dont tu as besoin."
        } else {
            "Ce chemin contient un secret (clé ou identifiant) : ne le lis pas et ne le transmets pas."
        });
    }
    for (i, token) in tokens.iter().enumerate() {
        if *token != "git" && !token.ends_with("/git") {
            continue;
        }
        // Premier mot qui n'est pas une option = la sous-commande git.
        let mut j = i + 1;
        while j < tokens.len() && tokens[j].starts_with('-') {
            // Options qui prennent une valeur : -C <dir>, -c <clé=valeur>, --git-dir <dir>…
            j += if matches!(tokens[j], "-C" | "-c" | "--git-dir" | "--work-tree" | "--namespace") { 2 } else { 1 };
        }
        let Some(sub) = tokens.get(j).copied() else { continue };
        let next = tokens.get(j + 1).copied().unwrap_or("");
        match sub {
            "push" => return Some("« git push » est réservé à l'utilisateur : ne pousse pas le code, dis-lui de le faire."),
            "remote" if next == "add" => {
                return Some("« git remote add » configure un dépôt distant : laisse l'utilisateur le faire.");
            }
            "config" => {
                return Some("« git config » est refusé : la configuration Git appartient à l'utilisateur.");
            }
            "reset" if next == "--hard" => {
                return Some("« git reset --hard » efface le travail non commité : utilise git status puis git checkout <fichier>.");
            }
            "clean" if next.starts_with('-') && next.contains('f') => {
                return Some("« git clean -f » supprime les fichiers non suivis : demande-le à l'utilisateur.");
            }
            _ => {}
        }
    }
    None
}

/// Une commande de shell mentionne-t-elle un port local réservé aux connecteurs ?
/// Heuristique de défense en profondeur : Seatbelt ne peut pas exprimer « localhost sauf ces
/// ports » sans couper le proxy (voir `sandbox::wrap`).
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

/// `git init` simple lancé par le shell confiné : même exception que pour `run_command`,
/// mais refusée dès que la ligne contient un enchaînement, un pipe ou une redirection.
fn shell_git_init_allowed(command: &str, root: &std::path::Path, cwd: &std::path::Path) -> bool {
    let trimmed = command.trim();
    if trimmed.chars().any(|c| matches!(c, ';' | '&' | '|' | '>' | '<' | '\n' | '\r')) {
        return false;
    }
    let parts: Vec<String> = trimmed
        .split_whitespace()
        .map(|s| s.trim_matches('"').trim_matches('\'').to_string())
        .collect();
    if parts.first().map(|s| s.as_str()) != Some("git") {
        return false;
    }
    crate::sandbox::git_init_allowed("git", &parts[1..], root, cwd)
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
    // Java / Gradle / Maven ignorent HTTPS_PROXY : propriétés JVM lues par toute JVM lancée.
    cmd.env(
        "JAVA_TOOL_OPTIONS",
        format!(
            "-Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort={port} -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort={port} -Dhttp.nonProxyHosts=localhost|127.0.0.1"
        ),
    );
}

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
    approved: Option<bool>,
    network: Option<bool>,
    proxy: Option<bool>,
    proxy_hosts: Option<Vec<String>>,
    direct: Option<bool>,
    shell: Option<bool>,
    shell_command: Option<String>,
    escalated: Option<bool>,
    escalation_reason: Option<String>,
) -> Result<u32, String> {
    validate_id(&id)?;
    // Les hôtes autorisés viennent des réglages gardés par Rust (command_policy), plus de
    // l'interface : une liste envoyée par la webview n'ouvre plus rien.
    let _ = proxy_hosts;
    let policy = crate::command_policy::current(&app);
    let use_shell = shell.unwrap_or(false);
    let escalated = escalated.unwrap_or(false);
    if escalated {
        // Élévation à usage unique : elle n'a de sens que là où une isolation existe,
        // et seulement avec une justification lisible par l'utilisateur.
        if !crate::sandbox::available() {
            return Err("L'élévation n'est disponible que sur un système où l'isolation existe (macOS).".into());
        }
        if escalation_reason.as_deref().unwrap_or("").trim().is_empty() {
            return Err("Élévation refusée : une justification est obligatoire.".into());
        }
    }
    let mut shell_text: Option<String> = None;
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
        if let Some(reason) = forbidden_shell_operation(trimmed) {
            return Err(reason.into());
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
        shell_text = Some(trimmed.to_string());
        ("bash".to_string(), vec!["-c".to_string(), command])
    } else {
        let program = program.trim().to_lowercase();
        if program.contains('/') || program.contains('\\') || !is_valid_program_name(&program) {
            return Err("Programme non autorisé.".into());
        }
        if is_denied_program(&program) {
            return Err(format!("« {program} » est interdit à l'agent, même avec ton accord."));
        }
        // macOS n'a que `python3` / `pip3` : l'agent écrit souvent `python` ou `pip`.
        let program = python3_fallback(program, |p| find_in_path(p).is_some());
        // Programme hors de la liste d'ANZAR : accepté seulement si l'utilisateur l'a autorisé
        // définitivement (réglage gardé par Rust) ou pour cette commande (carte d'accord).
        let known = is_allowed_program(&program);
        if !known && !policy.trusted_programs.contains(&program) && !approved.unwrap_or(false) {
            return Err(format!("« {program} » n'est pas dans la liste d'ANZAR : il faut ton accord (carte d'accord)."));
        }
        validate_args(&program, &args, approved.unwrap_or(false))?;
        (program, args)
    };
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

    // Réseau décidé par Rust (téléchargement, installation acceptée) : seul cas où l'interface
    // peut demander de contourner le relais (outil qui l'ignore, diagnostic `TAG_BYPASS`).
    let install_net = !use_shell
        && crate::sandbox::network_allowed(&program, &args, approved.unwrap_or(false));
    let direct = direct.unwrap_or(false) && install_net;
    // Protection effective : l'interface peut en demander plus, jamais moins que les réglages.
    let eff = crate::command_policy::effective(&policy, sandbox, network, proxy, install_net);
    // Isolation (macOS) : activée sauf si le réglage « Isoler les commandes » est coupé.
    // Une élévation approuvée à usage unique élargit l'écriture pour CET appel seulement,
    // sans relâcher les secrets, les hooks Git ni le filtre réseau.
    let isolated = eff.sandbox && crate::sandbox::available();
    if use_shell && !isolated {
        return Err("Le shell confiné exige l'isolation des commandes : active-la dans les réglages ou utilise run_command.".into());
    }
    if isolated && !use_shell && gradlew_path.is_none() && find_in_path(&program).is_none() {
        return Err(format!("« {program} » est introuvable sur cet ordinateur."));
    }
    // Programme réellement lancé : chemin du script gradlew, ou nom cherché dans le PATH.
    // Windows : `Command::new` n'ajoute que « .exe » ; npm, flutter, yarn… sont des .cmd/.bat.
    let exe: String = if use_shell {
        // Chemin absolu : le shell ne dépend pas d'un PATH modifié par l'utilisateur.
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
    // Réseau : réglage « Réseau des commandes » ouvert, ou commande qui télécharge.
    let net = eff.network;
    // Filtrage : quand il est actif, la commande ne sort que par le proxy (localhost) et le
    // proxy n'ouvre que les hôtes autorisés. S'il ne démarre pas, on garde le comportement
    // précédent plutôt que de bloquer l'utilisateur.
    let proxy_port = if eff.proxy && net && !direct {
        let port = crate::netproxy::ensure();
        // Après ensure() : avant le premier démarrage du proxy, la liste était perdue.
        crate::netproxy::set_extra_hosts(policy.extra_hosts.clone());
        port
    } else {
        None
    };
    let allow_network = net && proxy_port.is_none();
    let wrapped = if isolated {
        let git_init = if use_shell {
            shell_text.as_deref().map(|c| shell_git_init_allowed(c, &root_p, &cwd_p)).unwrap_or(false)
        } else {
            crate::sandbox::git_init_allowed(&program, &args, &root_p, &cwd_p)
        };
        if escalated {
            crate::sandbox::wrap_escalated(&exe, &args, &root_p, allow_network, git_init)
        } else {
            crate::sandbox::wrap(&exe, &args, &root_p, allow_network, git_init)
        }
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
        proxied: proxy_port.is_some(),
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
        } else if let Some(diag) = crate::netproxy::diagnose(
            &crate::netproxy::records_since(proc.blocked_seq),
            proc.proxied,
            code,
            &format!("{stdout}\n{stderr}"),
        ) {
            // Diagnostic lu par l'interface, qui relance seule la commande (voir toolHost).
            stderr.push_str(&format!("\n{diag}"));
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

    fn args(v: &[&str]) -> Vec<String> { v.iter().map(|s| s.to_string()).collect() }

    #[test]
    fn shell_only_allows_simple_git_init() {
        let dir = std::env::temp_dir().join(format!("anzar-shell-gitinit-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(shell_git_init_allowed("git init", &dir, &dir));
        assert!(shell_git_init_allowed("git init -b main", &dir, &dir));
        assert!(shell_git_init_allowed("  git init --initial-branch=main  ", &dir, &dir));
        assert!(!shell_git_init_allowed("git init && rm -rf .", &dir, &dir));
        assert!(!shell_git_init_allowed("git init | cat", &dir, &dir));
        assert!(!shell_git_init_allowed("git init > log", &dir, &dir));
        assert!(!shell_git_init_allowed("cd sous && git init", &dir, &dir));
        assert!(!shell_git_init_allowed("git status", &dir, &dir));
        assert!(!shell_git_init_allowed("git init --separate-git-dir=.gitstore", &dir, &dir));
        assert!(forbidden_shell_operation("git push origin main").is_some());
        assert!(forbidden_shell_operation("git -C . push").is_some());
        assert!(forbidden_shell_operation("git remote add origin x").is_some());
        assert!(forbidden_shell_operation("sudo ls").is_some());
        assert!(forbidden_shell_operation("git reset --hard HEAD").is_some());
        assert!(forbidden_shell_operation("cat .env").is_some());
        assert!(forbidden_shell_operation("cat ./.env.local").is_some());
        assert!(forbidden_shell_operation("cat ~/.ssh/id_rsa").is_some());
        assert!(forbidden_shell_operation("cp certs/client.pem /tmp/x").is_some());
        assert!(forbidden_shell_operation("cat .env.example").is_none());
        assert!(forbidden_shell_operation("git clean -fd").is_some());
        assert!(forbidden_shell_operation("git commit -m 'fix push'").is_none());
        assert!(forbidden_shell_operation("git config --global user.email x").is_some());
        assert!(forbidden_shell_operation("echo x > .git/hooks/pre-commit").is_some());
        assert!(forbidden_shell_operation("git log --grep push").is_none());
        assert!(forbidden_shell_operation("npm test").is_none());
        assert!(forbidden_shell_operation("git status").is_none());
        assert!(mentions_blocked_local_app("nc 127.0.0.1 9876"));
        assert!(mentions_blocked_local_app("curl http://localhost:9877/x"));
        assert!(mentions_blocked_local_app("cat /tmp/audacity_script_pipe.to.x"));
        assert!(!mentions_blocked_local_app("npm test -- --run"));
        assert!(!mentions_blocked_local_app("echo 44550"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_inline_code_and_git_config() {
        assert!(validate_args("node", &args(&["-e", "1"]), false).is_err());
        assert!(validate_args("python3", &args(&["-c", "print(1)"]), false).is_err());
        assert!(validate_args("git", &args(&["config", "core.fsmonitor", "x"]), false).is_err());
        assert!(validate_args("git", &args(&["-c", "core.hooksPath=x", "status"]), false).is_err());
        for bad in [
            &["init", "--separate-git-dir=.gitstore"][..], &["init", "--template="], &["-C", ".", "config", "x", "y"],
            &["--git-dir=autre", "status"], &["--work-tree", "/tmp", "status"], &["init", "--template", "/tmp/t"],
        ] {
            assert!(validate_args("git", &args(bad), true).is_err(), "{bad:?}");
        }
        assert!(validate_args("git", &args(&["init", "-b", "main"]), false).is_ok());
        assert!(validate_args("git", &args(&["log", "--oneline"]), false).is_ok());
        assert!(validate_args("git", &args(&["push"]), false).is_err());
        assert!(validate_args("npm", &args(&["install"]), false).is_err());
        assert!(validate_args("npm", &args(&["install", "react"]), true).is_ok());
        assert!(validate_args("npm", &args(&["publish"]), true).is_err());
        assert!(validate_args("npm", &args(&["exec", "x"]), true).is_err());
        // cargo install : seulement avec l'accord de l'utilisateur (comme npm install).
        assert!(validate_args("cargo", &args(&["install", "x"]), false).is_err());
        assert!(validate_args("cargo", &args(&["install", "x"]), true).is_ok());
        assert!(validate_args("git", &args(&["status"]), false).is_ok());
        assert!(validate_args("npm", &args(&["run", "build"]), false).is_ok());
    }

    #[test]
    fn command_policy_matches_the_shared_manifest() {
        let policy = commands_policy();
        assert_eq!(policy.version, 2);
        assert_eq!(policy.limits.max_args, 24);
        assert_eq!(policy.limits.max_arg_chars, 400);
        for name in ["npm", "node", "git", "cargo", "python", "python3", "pip", "pip3", "ffmpeg", "ffprobe", "rg"] {
            assert!(is_allowed_program(name), "{name} absent de commands.json");
        }
        assert!(!is_allowed_program("curl"));
        // Chaque programme destiné à l'agent doit aussi être autorisé côté Rust.
        assert!(policy.programs.iter().filter(|p| p.agent).all(|p| is_allowed_program(&p.name)));
        // Aucun programme de la liste ne peut être en même temps interdit.
        assert!(policy.programs.iter().all(|p| !is_denied_program(&p.name)), "programme à la fois listé et interdit");
        // Chaque règle de lanceur, d'installation ou de refus est bien formée.
        for p in &policy.programs {
            for r in p.installs.iter().chain(&p.network).chain(&p.launches) {
                assert!(r.is_empty() || r == "<none>" || r.split_whitespace().all(|w| !w.starts_with('-')), "{}: {r}", p.name);
            }
        }
    }

    #[test]
    fn vibecoding_programs_follow_their_rules() {
        // Flutter / Dart : installations avec accord, SDK jamais modifié, pas de publication.
        assert!(is_allowed_program("flutter") && is_allowed_program("dart"));
        // `python` absent mais `python3` présent (macOS) : redirigé ; sinon inchangé.
        let only3 = |p: &str| p == "python3" || p == "pip3";
        if !cfg!(windows) {
            assert_eq!(python3_fallback("python".into(), only3), "python3");
            assert_eq!(python3_fallback("pip".into(), only3), "pip3");
        }
        assert_eq!(python3_fallback("python".into(), |_| true), "python");
        assert_eq!(python3_fallback("node".into(), only3), "node");
        assert!(validate_args("flutter", &args(&["pub", "get"]), false).is_err());
        assert!(validate_args("flutter", &args(&["pub", "get"]), true).is_ok());
        assert!(validate_args("flutter", &args(&["create", "--org", "app.x", "."]), false).is_err());
        assert!(validate_args("flutter", &args(&["create", "--org", "app.x", "."]), true).is_ok());
        assert!(validate_args("flutter", &args(&["analyze"]), false).is_ok());
        assert!(validate_args("flutter", &args(&["build", "apk"]), false).is_ok());
        assert!(validate_args("flutter", &args(&["upgrade"]), true).is_err());
        assert!(validate_args("flutter", &args(&["pub", "publish"]), true).is_err());
        assert!(validate_args("dart", &args(&["pub", "publish"]), true).is_err());
        // Options avant la sous-commande : la règle s'applique quand même.
        assert!(validate_args("flutter", &args(&["--no-color", "pub", "get"]), false).is_err());
        // yarn sans argument = installation.
        assert!(validate_args("yarn", &args(&[]), false).is_err());
        assert!(validate_args("yarn", &args(&["build"]), false).is_ok());
        // npx : toujours avec accord.
        assert!(validate_args("npx", &args(&["create-next-app"]), false).is_err());
        assert!(validate_args("npx", &args(&["create-next-app"]), true).is_ok());
        // Publications refusées même avec accord.
        for (prog, a) in [("pnpm", "publish"), ("gem", "push"), ("cargo", "publish"), ("mvn", "deploy"), ("uv", "publish")] {
            assert!(validate_args(prog, &args(&[a]), true).is_err(), "{prog} {a}");
        }
        // Git : sous-commandes qui exécutent du shell.
        assert!(validate_args("git", &args(&["submodule", "foreach", "ls"]), true).is_err());
        assert!(validate_args("git", &args(&["submodule", "update"]), false).is_ok());
    }

    #[test]
    fn launchers_cannot_start_forbidden_programs() {
        assert!(validate_args("xcrun", &args(&["bash"]), true).is_err());
        assert!(validate_args("xcrun", &args(&["--sdk", "iphoneos", "/bin/sh"]), true).is_err());
        assert!(validate_args("xcrun", &args(&["simctl", "list"]), false).is_ok());
        assert!(validate_args("bundle", &args(&["exec", "sh"]), true).is_err());
        assert!(validate_args("bundle", &args(&["exec", "rspec"]), true).is_ok());
        assert!(validate_args("npx", &args(&["curl"]), true).is_err());
        assert!(validate_args("uv", &args(&["run", "bash"]), true).is_err());
        assert!(validate_args("uv", &args(&["run", "pytest"]), false).is_ok());
        assert!(validate_args("rustup", &args(&["run", "nightly", "cargo"]), true).is_err());
    }

    #[test]
    fn denied_and_unknown_program_names() {
        for name in ["bash", "sh", "sudo", "curl", "ssh", "osascript", "powershell", "cmd.exe", "env", "xargs"] {
            assert!(is_denied_program(name), "{name} devrait être interdit");
        }
        for name in ["flutter", "supabase", "firebase", "my-cli", "node"] {
            assert!(!is_denied_program(name), "{name} ne devrait pas être interdit");
        }
        assert!(is_valid_program_name("supabase") && is_valid_program_name("clang++"));
        assert!(!is_valid_program_name("../x") && !is_valid_program_name("a b") && !is_valid_program_name("-rf"));
        assert!(!is_valid_program_name(""));
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
