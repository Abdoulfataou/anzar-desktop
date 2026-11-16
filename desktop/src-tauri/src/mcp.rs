//! Transport des serveurs MCP (Model Context Protocol) et des serveurs de langage (LSP).
//!
//! Deux cadrages sur stdio : « line » (MCP, une ligne JSON par message) et « lsp »
//! (en-tête Content-Length puis le corps JSON, utilisé par les diagnostics de code).
//!
//! L'app parle le protocole (JSON-RPC) ; ce module ne fait que le transport :
//! - stdio : lance le serveur (npx, uvx, docker…), écrit une ligne JSON sur son entrée,
//!   relaie chaque ligne de sa sortie dans l'évènement `mcp://message`
//! - HTTP (« Streamable HTTP ») : POST d'un message, réponse JSON ou flux SSE renvoyé brut
//!
//! Sécurité : seuls des lanceurs connus sont acceptés, l'environnement transmis est
//! celui de l'app plus les variables du serveur (jamais affichées), et tous les
//! processus sont arrêtés à la fermeture de l'app.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

/// Lanceurs autorisés pour un serveur local. Un chemin absolu vers l'un d'eux est accepté.
const LAUNCHERS: &[&str] = &[
    "npx", "node", "bunx", "bun", "deno", "uvx", "uv", "pipx", "python", "python3", "docker",
];
const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;
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

#[tauri::command]
pub fn mcp_spawn(
    app: AppHandle,
    state: State<'_, McpState>,
    id: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    cwd: Option<String>,
    framing: Option<String>,
) -> Result<(), String> {
    let lsp = framing.as_deref() == Some("lsp");
    if !LAUNCHERS.contains(&launcher_name(&command).as_str()) {
        return Err(format!(
            "Lanceur « {command} » non autorisé. Utilise : {}.",
            LAUNCHERS.join(", ")
        ));
    }
    stop_proc(&state.procs, &id);

    let mut cmd = build_command(&command, &args);
    cmd.env("PATH", enriched_path())
        .envs(&env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
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
        let _ = app_out.emit_all("mcp://message", MessageEvent { id: id_out.clone(), line });
    };
    if lsp { pump_lsp(stdout, emit) } else { pump_lines(stdout, emit) }
    let (app_err, id_err) = (app.clone(), id.clone());
    let procs_exit = procs.clone();
    let app_exit = app.clone();
    let id_exit = id.clone();
    pump_lines(stderr, move |line| {
        let _ = app_err.emit_all("mcp://log", LogEvent { id: id_err.clone(), line });
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
                let _ = app_exit.emit_all("mcp://exit", ExitEvent { id: id_exit.clone(), code: status.code() });
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
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    method: Option<String>,
) -> Result<HttpResponse, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Adresse invalide".to_string())?;
    let local = matches!(parsed.host_str(), Some("localhost") | Some("127.0.0.1") | Some("[::1]"));
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && local) {
        return Err("Seules les adresses https:// sont acceptées (http:// uniquement en local).".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
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
