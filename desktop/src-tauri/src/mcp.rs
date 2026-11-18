//! Transport des serveurs MCP (Model Context Protocol) et des serveurs de langage (LSP).
//!
//! Deux cadrages sur stdio : « line » (MCP, une ligne JSON par message) et « lsp »
//! (en-tête Content-Length puis le corps JSON, utilisé par les diagnostics de code).
//!
//! L'app parle le protocole (JSON-RPC) ; ce module ne fait que le transport :
//! - stdio : lance le serveur (npx, python…), écrit une ligne JSON sur son entrée,
//!   relaie chaque ligne de sa sortie dans l'évènement `mcp://message`
//! - HTTP (« Streamable HTTP ») : POST d'un message, réponse JSON ou flux SSE renvoyé brut
//!
//! Sécurité : seuls des lanceurs connus sont acceptés, l'environnement transmis est
//! celui de l'app plus les variables du serveur (jamais affichées), et tous les
//! processus sont arrêtés à la fermeture de l'app.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// Lanceurs autorisés pour un serveur local. Le nom seul est accepté, jamais un chemin.
const LAUNCHERS: &[&str] = &[
    "npx", "python", "python3",
];
const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;

/// Variables d'environnement de base recopiées dans un serveur MCP.
/// Tout le reste doit être explicitement fourni par la configuration du connecteur.
const BASE_ENV: &[&str] = &[
    "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP",
    "LANG", "LC_ALL", "TERM", "TZ",
    "SYSTEMROOT", "WINDIR", "ComSpec", "PATHEXT", "USERPROFILE",
    "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMDATA",
];

/// Variables qui permettent d'injecter du code dans un lanceur légitime.
fn env_key_allowed(key: &str) -> bool {
    if key.is_empty() || key.len() > 128 { return false; }
    if !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') { return false; }
    let k = key.to_ascii_uppercase();
    if k == "PATH" { return false; }
    if k.starts_with("LD_") || k.starts_with("DYLD_") || k.starts_with("PYTHON") {
        return false;
    }
    !matches!(k.as_str(),
        "NODE_OPTIONS" | "BASH_ENV" | "ENV" | "GIT_CONFIG" | "GIT_CONFIG_GLOBAL" |
        "GIT_CONFIG_SYSTEM" | "GIT_SSH" | "GIT_SSH_COMMAND" | "SSH_AUTH_SOCK" |
        "ELECTRON_RUN_AS_NODE" | "NODE_PATH" | "PERL5LIB" | "RUBYOPT" | "JAVA_TOOL_OPTIONS" |
        "_JAVA_OPTIONS" | "CLASSPATH" | "DOCKER_HOST" | "CONDA_PREFIX" | "VIRTUAL_ENV"
    )
}

/// Commande de lancement : uniquement un nom de la liste blanche, jamais un chemin.
fn validate_launcher(command: &str) -> Result<(), String> {
    if command.is_empty() || command.contains('/') || command.contains('\\') || command.contains("..") {
        return Err("Lanceur invalide : indique un nom de programme (node, npx, python…), pas un chemin.".into());
    }
    if !LAUNCHERS.contains(&launcher_name(command).as_str()) {
        return Err(format!(
            "Lanceur « {command} » non autorisé. Utilise : {}.",
            LAUNCHERS.join(", ")
        ));
    }
    Ok(())
}

/// Paquets npx autorisés pour les serveurs MCP internes/connus.
/// Les connecteurs personnalisés doivent utiliser un paquet de cette liste.
const ALLOWED_NPX: &[&str] = &[
    "@playwright/mcp", "playwright-core", "typescript-language-server",
    "typescript", "pyright", "@modelcontextprotocol/",
];
const ALLOWED_NPX_BIN: &[&str] = &[
    "playwright", "typescript-language-server", "pyright-langserver", "node",
];

fn package_allowed(pkg: &str) -> bool {
    let base = pkg.split('@').take(2).collect::<Vec<_>>().join("@");
    let name = if pkg.starts_with('@') { base } else { pkg.split('@').next().unwrap_or(pkg).to_string() };
    ALLOWED_NPX.iter().any(|p| name == *p || (p.ends_with('/') && name.starts_with(p)))
}

fn validate_npx_args(args: &[String]) -> Result<(), String> {
    let mut expect_pkg = false;
    let mut seen_bin = false;
    for arg in args {
        if arg == "-p" || arg == "--package" { expect_pkg = true; continue; }
        if arg.starts_with('-') { continue; }
        if expect_pkg {
            if !package_allowed(arg) { return Err(format!("Paquet npx non autorisé : {arg}.")); }
            expect_pkg = false;
            continue;
        }
        if !seen_bin {
            if package_allowed(arg) || ALLOWED_NPX_BIN.contains(&arg.as_str()) {
                seen_bin = true;
                continue;
            }
            return Err(format!("Paquet npx non autorisé : {arg}."));
        }
    }
    if expect_pkg { return Err("Option -p sans paquet npx.".into()); }
    Ok(())
}

/// Options qui transforment un lanceur en shell ou en évaluateur de code.
fn validate_args(launcher: &str, args: &[String]) -> Result<(), String> {
    if launcher == "npx" { validate_npx_args(args)?; }
    if args.len() > 32 { return Err("Trop d'arguments pour un serveur MCP.".into()); }
    for arg in args {
        if arg.contains('\n') || arg.contains('\r') || arg.len() > 4000 {
            return Err("Argument MCP invalide (retour à la ligne ou trop long).".into());
        }
        let a = arg.to_ascii_lowercase();
        let inline = match launcher {
            "npx" | "bunx" | "pipx" | "uvx" => matches!(a.as_str(), "-c" | "--call" | "--shell"),
            "node" | "bun" | "deno" => matches!(a.as_str(), "-e" | "--eval" | "-p" | "--print"),
            "python" | "python3" | "uv" => a == "-c" || a == "--command",
            "docker" => a == "--privileged",
            _ => false,
        };
        if inline {
            return Err(format!("Option « {arg} » interdite pour un serveur MCP."));
        }
    }
    Ok(())
}

fn private_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_private() || v4.is_loopback() || v4.is_link_local() || v4.is_unspecified()
                || v4.is_broadcast() || v4.is_multicast()
                || v4.octets()[0] == 0 || v4.octets()[0] >= 224
        }
        std::net::IpAddr::V6(v6) => {
            v6.is_loopback() || v6.is_unspecified() || v6.is_multicast()
                || v6.is_unique_local() || v6.is_unicast_link_local()
        }
    }
}

async fn ensure_public_host(host: String, port: u16) -> Result<(), String> {
    let resolved = tauri::async_runtime::spawn_blocking(move || {
        use std::net::ToSocketAddrs;
        (host.as_str(), port).to_socket_addrs().map(|it| it.map(|a| a.ip()).collect::<Vec<_>>())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Résolution DNS impossible : {e}"))?;
    if resolved.is_empty() {
        return Err("Hôte MCP introuvable.".into());
    }
    if resolved.iter().any(|ip| private_ip(*ip)) {
        return Err("Hôte MCP résolu vers une adresse privée refusée.".into());
    }
    Ok(())
}

fn validate_backend_url(url: &reqwest::Url) -> Result<(), String> {
    let scheme = url.scheme();
    let host = url.host_str().ok_or("Adresse MCP sans hôte.")?;
    if scheme != "https" {
        return Err("Seules les adresses https:// sont acceptées pour un connecteur HTTP.".into());
    }
    if host.eq_ignore_ascii_case("localhost") {
        return Err("Les connecteurs HTTP locaux sont refusés : utilise un connecteur stdio.".into());
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        if private_ip(ip) {
            return Err("Adresse MCP privée refusée.".into());
        }
    }
    Ok(())
}
const MAX_HTTP_BODY: usize = 16 * 1024 * 1024;

struct Proc {
    child: Child,
    stdin: Option<ChildStdin>,
    lsp: bool,
}

#[derive(Default)]
pub struct McpState {
    procs: Arc<Mutex<HashMap<String, Proc>>>,
}

#[derive(Clone, Serialize)]
struct MessageEvent {
    id: String,
    line: String,
}

#[derive(Clone, Serialize)]
struct LogEvent {
    id: String,
    line: String,
}

#[derive(Clone, Serialize)]
struct ExitEvent {
    id: String,
    code: Option<i32>,
}

fn launcher_name(command: &str) -> String {
    let base = command.rsplit(['/', '\\']).next().unwrap_or(command).to_lowercase();
    base.trim_end_matches(".exe").trim_end_matches(".cmd").to_string()
}

/// Les apps lancées depuis le Finder ne reçoivent pas le PATH du terminal :
/// on ajoute les emplacements usuels de Node, Python et Docker.
pub fn enriched_path() -> String {
    let sep = if cfg!(windows) { ";" } else { ":" };
    let mut parts: Vec<String> = std::env::var("PATH")
        .unwrap_or_default()
        .split(sep)
        .filter(|p| !p.is_empty())
        .map(String::from)
        .collect();
    let mut extra: Vec<String> = Vec::new();
    if let Some(home) = dirs::home_dir() {
        let h = home.to_string_lossy().to_string();
        if cfg!(windows) {
            extra.push(format!("{h}\\AppData\\Roaming\\npm"));
            extra.push(format!("{h}\\.local\\bin"));
        } else {
            for p in [".local/bin", ".cargo/bin", ".volta/bin", ".bun/bin", ".deno/bin", ".npm-global/bin", ".asdf/shims", ".pyenv/shims", "Library/pnpm"] {
                extra.push(format!("{h}/{p}"));
            }
            // nvm : la version de Node la plus récente installée
            if let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) {
                let mut versions: Vec<_> = entries.flatten().map(|e| e.path()).collect();
                versions.sort();
                if let Some(latest) = versions.last() {
                    extra.push(latest.join("bin").to_string_lossy().to_string());
                }
            }
        }
    }
    if !cfg!(windows) {
        for p in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
            extra.push(p.to_string());
        }
    }
    for p in extra {
        if !parts.contains(&p) {
            parts.push(p);
        }
    }
    parts.join(sep)
}

fn build_command(command: &str, args: &[String]) -> Command {
    // Sous Windows, npx/bunx sont des scripts .cmd : ils passent par cmd /C
    if cfg!(windows) && matches!(launcher_name(command).as_str(), "npx" | "bunx" | "pipx" | "uvx") {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(command).args(args);
        c
    } else {
        let mut c = Command::new(command);
        c.args(args);
        c
    }
}

#[cfg(windows)]
fn hide_window(c: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    c.creation_flags(CREATE_NO_WINDOW);
}
#[cfg(not(windows))]
fn hide_window(c: &mut Command) {
    use std::os::unix::process::CommandExt;
    // Groupe de processus à part : on peut arrêter le serveur ET ses enfants (npx → node)
    c.process_group(0);
}

/// Lit des messages LSP : « Content-Length: N » puis une ligne vide, puis N octets de JSON.
fn pump_lsp<R: std::io::Read + Send + 'static>(reader: R, mut on_message: impl FnMut(String) + Send + 'static) {
    std::thread::spawn(move || {
        let mut reader = BufReader::with_capacity(64 * 1024, reader);
        loop {
            let mut length: Option<usize> = None;
            let mut header = String::new();
            loop {
                header.clear();
                match reader.read_line(&mut header) {
                    Ok(0) | Err(_) => return,
                    Ok(_) => {}
                }
                let h = header.trim_end();
                if h.is_empty() {
                    if length.is_some() { break; }
                    continue;
                }
                if let Some(v) = h.strip_prefix("Content-Length:").or_else(|| h.strip_prefix("content-length:")) {
                    length = v.trim().parse().ok();
                }
            }
            let n = length.unwrap_or(0);
            if n > MAX_LINE_BYTES {
                // Message trop gros : lu puis ignoré, pour garder le flux aligné
                if std::io::copy(&mut std::io::Read::take(&mut reader, n as u64), &mut std::io::sink()).is_err() { return; }
                continue;
            }
            let mut body = vec![0u8; n];
            if std::io::Read::read_exact(&mut reader, &mut body).is_err() { return; }
            on_message(String::from_utf8_lossy(&body).to_string());
        }
    });
}

/// Lit des lignes sans limite de taille du tampon système, mais coupe au-delà de MAX_LINE_BYTES.
fn pump_lines<R: std::io::Read + Send + 'static>(reader: R, mut on_line: impl FnMut(String) + Send + 'static) {
    std::thread::spawn(move || {
        let mut reader = BufReader::with_capacity(64 * 1024, reader);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if buf.len() > MAX_LINE_BYTES {
                        continue;
                    }
                    let line = String::from_utf8_lossy(&buf).trim_end_matches(['\r', '\n']).to_string();
                    if !line.is_empty() {
                        on_line(line);
                    }
                }
            }
        }
    });
}

#[derive(Clone, Serialize, Deserialize)]
pub struct StoredServer {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub transport: String,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub enabled: bool,
    #[serde(rename = "alwaysAsk", default)]
    pub always_ask: Option<bool>,
    #[serde(default)]
    pub preset: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
struct McpConfigFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    servers: Vec<StoredServer>,
}

fn config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("store").join("mcp.json"))
}

fn read_config(app: &AppHandle) -> Result<McpConfigFile, String> {
    let path = config_path(app)?;
    if !path.exists() { return Ok(McpConfigFile::default()); }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("Configuration MCP illisible : {e}"))
}

fn write_config(app: &AppHandle, config: &McpConfigFile) -> Result<(), String> {
    let path = config_path(app)?;
    let dir = path.parent().ok_or("Dossier MCP introuvable")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut p = std::fs::metadata(&path).map_err(|e| e.to_string())?.permissions();
        p.set_mode(0o600);
        let _ = std::fs::set_permissions(&path, p);
    }
    Ok(())
}

fn redact_server(mut server: StoredServer) -> StoredServer {
    for value in server.env.values_mut() { *value = "••••".into(); }
    for value in server.headers.values_mut() { *value = "••••".into(); }
    server
}

fn merge_secrets(incoming: &mut StoredServer, existing: &StoredServer) {
    // Le renderer ne reçoit que des valeurs masquées : on conserve les secrets
    // existants quand il renvoie une valeur masquée ou vide.
    for (k, v) in &existing.env {
        let keep = incoming.env.get(k).map(|x| x.is_empty() || x.contains("••••")).unwrap_or(true);
        if keep { incoming.env.insert(k.clone(), v.clone()); }
    }
    for (k, v) in &existing.headers {
        let keep = incoming.headers.get(k).map(|x| x.is_empty() || x.contains("••••")).unwrap_or(true);
        if keep { incoming.headers.insert(k.clone(), v.clone()); }
    }
}

fn validate_stored_server(server: &StoredServer) -> Result<(), String> {
    if server.id.is_empty() || server.id.len() > 64 || !server.id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
        return Err("Identifiant de serveur MCP invalide.".into());
    }
    if server.transport == "stdio" {
        let command = server.command.as_deref().ok_or("Commande MCP manquante.")?;
        validate_launcher(command)?;
        validate_args(&launcher_name(command), &server.args)?;
        for key in server.env.keys() {
            if !env_key_allowed(key) { return Err(format!("Variable MCP refusée : {key}.")); }
        }
    } else if server.transport == "http" {
        let url = reqwest::Url::parse(server.url.as_deref().ok_or("URL MCP manquante.")?).map_err(|_| "URL MCP invalide.".to_string())?;
        validate_backend_url(&url)?;
        for key in server.headers.keys() {
            if matches!(key.to_ascii_lowercase().as_str(), "host" | "content-length" | "transfer-encoding") {
                return Err(format!("En-tête MCP refusé : {key}."));
            }
        }
    } else {
        return Err("Transport MCP inconnu.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn mcp_config_load(app: AppHandle) -> Result<Vec<StoredServer>, String> {
    Ok(read_config(&app)?.servers.into_iter().map(redact_server).collect())
}

#[tauri::command]
pub fn mcp_config_save(app: AppHandle, servers: Vec<StoredServer>) -> Result<(), String> {
    let existing = read_config(&app)?;
    let mut out = Vec::with_capacity(servers.len());
    for mut server in servers {
        if let Some(old) = existing.servers.iter().find(|s| s.id == server.id) {
            merge_secrets(&mut server, old);
        }
        validate_stored_server(&server)?;
        out.push(server);
    }
    write_config(&app, &McpConfigFile { version: 1, servers: out })
}

#[tauri::command]
pub fn mcp_spawn(
    app: AppHandle,
    state: State<'_, McpState>,
    id: String,
    server_id: Option<String>,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    cwd: Option<String>,
    framing: Option<String>,
) -> Result<(), String> {
    let lsp = framing.as_deref() == Some("lsp");
    let (command, args, env) = if let Some(sid) = server_id {
        let cfg = read_config(&app)?;
        let server = cfg.servers.into_iter().find(|s| s.id == sid).ok_or("Connecteur MCP inconnu.")?;
        if !server.enabled { return Err("Connecteur MCP désactivé.".into()); }
        if server.transport != "stdio" { return Err("Ce connecteur n'est pas un serveur stdio.".into()); }
        (server.command.unwrap_or_default(), server.args, server.env)
    } else {
        (command, args, env)
    };
    validate_launcher(&command)?;
    validate_args(&launcher_name(&command), &args)?;
    if id.is_empty() || id.len() > 128 || !id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
        return Err("Identifiant de serveur MCP invalide.".into());
    }

    // Le dossier de travail doit rester sous le répertoire utilisateur.
    let canonical_cwd = if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
        let p = std::fs::canonicalize(&dir).map_err(|_| "Dossier de travail MCP introuvable.".to_string())?;
        let home = dirs::home_dir().ok_or("Répertoire utilisateur introuvable.")?;
        if !p.starts_with(&home) {
            return Err("Dossier de travail MCP hors du répertoire utilisateur.".into());
        }
        Some(p)
    } else {
        None
    };

    // Vérifie toutes les variables avant de lancer quoi que ce soit.
    for key in env.keys() {
        if !env_key_allowed(key) {
            return Err(format!("Variable d'environnement MCP refusée : {key}."));
        }
    }

    stop_proc(&state.procs, &id);

    let mut cmd = build_command(&command, &args);
    cmd.env_clear();
    for key in BASE_ENV {
        if let Ok(v) = std::env::var(key) { cmd.env(key, v); }
    }
    cmd.env("PATH", enriched_path());
    for (k, v) in &env { cmd.env(k, v); }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = canonical_cwd {
        cmd.current_dir(dir);
    }
    hide_window(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!("« {command} » est introuvable sur cet ordinateur. Installe-le (Node.js pour npx, uv pour uvx), puis réessaie.")
        } else {
            format!("Lancement impossible : {e}")
        }
    })?;

    let stdout = child.stdout.take().ok_or("sortie indisponible")?;
    let stderr = child.stderr.take().ok_or("sortie d'erreur indisponible")?;
    let stdin = child.stdin.take();

    let (app_out, id_out) = (app.clone(), id.clone());
    let procs = state.procs.clone();
    let emit = move |line: String| {
        let _ = app_out.emit("mcp://message", MessageEvent { id: id_out.clone(), line });
    };
    if lsp { pump_lsp(stdout, emit) } else { pump_lines(stdout, emit) }
    let (app_err, id_err) = (app.clone(), id.clone());
    let procs_exit = procs.clone();
    let app_exit = app.clone();
    let id_exit = id.clone();
    pump_lines(stderr, move |line| {
        let _ = app_err.emit("mcp://log", LogEvent { id: id_err.clone(), line });
    });
    // Enregistré AVANT de surveiller la fin du processus
    procs.lock().unwrap().insert(id, Proc { child, stdin, lsp });
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(500));
        let mut map = procs_exit.lock().unwrap();
        let Some(p) = map.get_mut(&id_exit) else { break };
        match p.child.try_wait() {
            Ok(Some(status)) => {
                map.remove(&id_exit);
                let _ = app_exit.emit("mcp://exit", ExitEvent { id: id_exit.clone(), code: status.code() });
                break;
            }
            Ok(None) => {}
            Err(_) => break,
        }
    });

    Ok(())
}

#[tauri::command]
pub fn mcp_send(state: State<'_, McpState>, id: String, line: String) -> Result<(), String> {
    let mut map = state.procs.lock().unwrap();
    let p = map.get_mut(&id).ok_or("Serveur arrêté")?;
    let stdin = p.stdin.as_mut().ok_or("Entrée du serveur fermée")?;
    let result = if p.lsp {
        let body = line.as_bytes();
        stdin
            .write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes())
            .and_then(|_| stdin.write_all(body))
            .and_then(|_| stdin.flush())
    } else {
        let clean = line.replace(['\r', '\n'], " ");
        stdin
            .write_all(clean.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
    };
    result.map_err(|e| format!("Envoi impossible : {e}"))
}

fn stop_proc(procs: &Arc<Mutex<HashMap<String, Proc>>>, id: &str) {
    let Some(mut p) = procs.lock().unwrap().remove(id) else { return };
    // Spécification MCP : fermer l'entrée, laisser le serveur sortir, puis forcer
    drop(p.stdin.take());
    std::thread::spawn(move || {
        for _ in 0..20 {
            if matches!(p.child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        #[cfg(unix)]
        {
            let pgid = p.child.id().to_string();
            let _ = Command::new("kill").args(["-TERM", &format!("-{pgid}")]).status();
            std::thread::sleep(Duration::from_millis(500));
        }
        let _ = p.child.kill();
        let _ = p.child.wait();
    });
}

#[tauri::command]
pub fn mcp_stop(state: State<'_, McpState>, id: String) {
    stop_proc(&state.procs, &id);
}

/// Arrête tous les serveurs (fermeture de l'app).
pub fn stop_all(app: &AppHandle) {
    let state = app.state::<McpState>();
    let ids: Vec<String> = state.procs.lock().unwrap().keys().cloned().collect();
    for id in ids {
        stop_proc(&state.procs, &id);
    }
    std::thread::sleep(Duration::from_millis(300));
}

#[derive(Serialize)]
pub struct HttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

/// Un message MCP par HTTP. La réponse (JSON ou SSE) est renvoyée telle quelle à l'app.
#[tauri::command]
pub async fn mcp_http(
    app: AppHandle,
    server_id: Option<String>,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    method: Option<String>,
) -> Result<HttpResponse, String> {
    let (url, mut merged_headers) = if let Some(sid) = server_id {
        let cfg = read_config(&app)?;
        let server = cfg.servers.into_iter().find(|s| s.id == sid).ok_or("Connecteur MCP inconnu.")?;
        if !server.enabled { return Err("Connecteur MCP désactivé.".into()); }
        if server.transport != "http" { return Err("Ce connecteur n'est pas un serveur HTTP.".into()); }
        (server.url.unwrap_or_default(), server.headers)
    } else {
        (url, HashMap::new())
    };
    // Les en-têtes de session (Mcp-Session-Id, MCP-Protocol-Version) viennent du
    // transport ; les en-têtes du connecteur (dont Authorization) restent côté Rust.
    for (k, v) in headers { merged_headers.insert(k, v); }
    let headers = merged_headers;
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Adresse invalide".to_string())?;
    validate_backend_url(&parsed)?;
    ensure_public_host(parsed.host_str().unwrap_or_default().to_string(), parsed.port_or_known_default().unwrap_or(443)).await?;
    for key in headers.keys() {
        if matches!(key.to_ascii_lowercase().as_str(), "host" | "content-length" | "transfer-encoding") {
            return Err(format!("En-tête MCP refusé : {key}."));
        }
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let method = match method.as_deref() {
        Some("DELETE") => reqwest::Method::DELETE,
        Some("GET") => reqwest::Method::GET,
        _ => reqwest::Method::POST,
    };
    let mut req = client.request(method, parsed);
    for (k, v) in &headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.header("Content-Type", "application/json").body(b);
    }
    let res = req.send().await.map_err(|e| {
        if e.is_timeout() { "Le serveur n'a pas répondu à temps.".to_string() }
        else if e.is_connect() { "Connexion au serveur impossible.".to_string() }
        else { format!("Erreur réseau : {e}") }
    })?;
    let status = res.status().as_u16();
    let headers = res
        .headers()
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.as_str().to_lowercase(), v.to_string())))
        .collect();
    let bytes = res.bytes().await.map_err(|e| format!("Lecture de la réponse impossible : {e}"))?;
    if bytes.len() > MAX_HTTP_BODY {
        return Err("Réponse trop volumineuse.".into());
    }
    Ok(HttpResponse { status, headers, body: String::from_utf8_lossy(&bytes).to_string() })
}

#[cfg(test)]
mod security_tests {
    use super::*;

    #[test]
    fn refuses_absolute_or_traversal_launchers() {
        assert!(validate_launcher("/tmp/evil/node").is_err());
        assert!(validate_launcher("..\\\\node").is_err());
        assert!(validate_launcher("bash").is_err());
        assert!(validate_launcher("node").is_err());
        assert!(validate_launcher("npx").is_ok());
    }

    #[test]
    fn refuses_inline_code_options() {
        assert!(validate_args("npx", &["-c".into(), "node --eval 1".into()]).is_err());
        assert!(validate_args("node", &["--eval".into(), "1".into()]).is_err());
        assert!(validate_args("python3", &["-c".into(), "print(1)".into()]).is_err());
        assert!(validate_args("node", &["server.js".into()]).is_ok());
        assert!(validate_args("npx", &["-y".into(), "@playwright/mcp@0.0.85".into()]).is_ok());
        assert!(validate_args("npx", &["-y".into(), "evil-package".into()]).is_err());
        assert!(validate_args("npx", &["-y".into(), "-p".into(), "typescript-language-server@4".into(), "-p".into(), "typescript@5".into(), "typescript-language-server".into(), "--stdio".into()]).is_ok());
        assert!(validate_args("npx", &["-y".into(), "-p".into(), "playwright-core".into(), "node".into(), "script.mjs".into()]).is_ok());
    }

    #[test]
    fn refuses_dangerous_environment() {
        assert!(!env_key_allowed("NODE_OPTIONS"));
        assert!(!env_key_allowed("LD_PRELOAD"));
        assert!(!env_key_allowed("DYLD_INSERT_LIBRARIES"));
        assert!(!env_key_allowed("PATH"));
        assert!(!env_key_allowed("pythonpath"));
        assert!(env_key_allowed("GITHUB_TOKEN"));
        assert!(env_key_allowed("CONTEXT7_API_KEY"));
    }

    #[test]
    fn redacts_and_merges_mcp_secrets() {
        let mut env = HashMap::new();
        env.insert("GITHUB_TOKEN".to_string(), "ghp_secret".to_string());
        let mut headers = HashMap::new();
        headers.insert("Authorization".to_string(), "Bearer secret".to_string());
        let server = StoredServer {
            id: "github".into(), name: "GitHub".into(), transport: "http".into(),
            command: None, args: vec![], env, url: Some("https://example.com/mcp".into()),
            headers, enabled: true, always_ask: Some(true), preset: None,
        };
        let redacted = redact_server(server.clone());
        assert_eq!(redacted.env["GITHUB_TOKEN"], "••••");
        assert_eq!(redacted.headers["Authorization"], "••••");

        let mut incoming = redacted;
        merge_secrets(&mut incoming, &server);
        assert_eq!(incoming.env["GITHUB_TOKEN"], "ghp_secret");
        assert_eq!(incoming.headers["Authorization"], "Bearer secret");
    }

    #[test]
    fn rejects_unsafe_saved_mcp_config() {
        let mut server = StoredServer {
            id: "x".into(), name: "X".into(), transport: "stdio".into(),
            command: Some("node".into()), args: vec!["script.js".into()], env: HashMap::new(),
            url: None, headers: HashMap::new(), enabled: true, always_ask: Some(true), preset: None,
        };
        assert!(validate_stored_server(&server).is_err());
        server.command = Some("npx".into());
        server.args = vec!["evil-package".into()];
        assert!(validate_stored_server(&server).is_err());
    }

    #[test]
    fn refuses_private_mcp_http_targets() {
        assert!(validate_backend_url(&reqwest::Url::parse("https://127.0.0.1/mcp").unwrap()).is_err());
        assert!(validate_backend_url(&reqwest::Url::parse("https://localhost/mcp").unwrap()).is_err());
        assert!(validate_backend_url(&reqwest::Url::parse("http://example.com/mcp").unwrap()).is_err());
        assert!(validate_backend_url(&reqwest::Url::parse("https://example.com/mcp").unwrap()).is_ok());
    }
}
