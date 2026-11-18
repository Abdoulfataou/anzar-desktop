//! Programmes dont ANZAR a besoin : détection, et installation quand ANZAR peut la faire.
//!
//! - Node.js : géré par node_runtime (téléchargé dans les fichiers d'ANZAR).
//! - Git : sur Windows, ANZAR télécharge MinGit (Git portable officiel de Git for Windows,
//!   empreinte vérifiée) ; sur Mac, Git vient des outils développeur d'Apple, qu'ANZAR peut
//!   faire proposer par macOS (xcode-select --install).
//! - Python, Rust, Docker… : détectés seulement ; l'app explique comment les installer.
//!
//! Attention sur Mac : /usr/bin/git et /usr/bin/python3 existent même sans les outils
//! développeur ; les lancer ouvre une fenêtre d'Apple. On ne les lance donc jamais pour les
//! détecter si ces outils sont absents.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const IDENTIFIER: &str = "com.anzar.desktop";

#[derive(Serialize, Clone)]
pub struct Program {
    id: &'static str,
    name: &'static str,
    /// « ok » ou « missing »
    status: &'static str,
    version: Option<String>,
    path: Option<String>,
    /// « auto » : ANZAR l'installe ; « apple » : outils développeur d'Apple ; « manual » : à installer soi-même
    install: &'static str,
    note: Option<String>,
}

fn sep() -> &'static str { if cfg!(windows) { ";" } else { ":" } }

/// Cherche un exécutable dans le PATH du processus.
pub fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var("PATH").unwrap_or_default();
    let exts: &[&str] = if cfg!(windows) { &[".exe", ".cmd", ".bat", ""] } else { &[""] };
    for dir in path.split(sep()).filter(|d| !d.is_empty()) {
        for ext in exts {
            let p = Path::new(dir).join(format!("{name}{ext}"));
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// Lance « <programme> <args> » et rend la première ligne, sans jamais attendre plus de 5 s.
fn first_line(exe: &Path, args: &[&str]) -> Option<String> {
    let mut c = Command::new(exe);
    c.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    let mut child = c.spawn().ok()?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() < Duration::from_secs(5) => std::thread::sleep(Duration::from_millis(30)),
            _ => { let _ = child.kill(); return None; }
        }
    }
    let out = child.wait_with_output().ok()?;
    let text = if out.stdout.is_empty() { out.stderr } else { out.stdout };
    String::from_utf8_lossy(&text).lines().next().map(|l| l.trim().to_string()).filter(|l| !l.is_empty())
}

/// Mac : outils développeur d'Apple installés ?
pub fn apple_dev_tools() -> bool {
    if !cfg!(target_os = "macos") { return true; }
    Command::new("/usr/bin/xcode-select").arg("-p").stdout(Stdio::null()).stderr(Stdio::null())
        .status().map(|s| s.success()).unwrap_or(false)
}

/// Faux programme : stub Apple sans outils développeur, ou raccourci Microsoft Store (python.exe).
fn is_stub(p: &Path, dev_tools: bool) -> bool {
    let s = p.to_string_lossy();
    (cfg!(target_os = "macos") && !dev_tools && (s == "/usr/bin/git" || s == "/usr/bin/python3"))
        || (cfg!(windows) && s.contains("WindowsApps"))
}

fn detect(id: &'static str, name: &'static str, exe_names: &[&str], args: &[&str], install: &'static str, dev_tools: bool) -> Program {
    for n in exe_names {
        if let Some(p) = which(n) {
            if is_stub(&p, dev_tools) { continue; }
            if let Some(v) = first_line(&p, args) {
                return Program { id, name, status: "ok", version: Some(v), path: Some(p.to_string_lossy().into()), install, note: None };
            }
        }
    }
    Program { id, name, status: "missing", version: None, path: None, install, note: None }
}

fn chrome_present() -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if cfg!(target_os = "macos") {
        candidates.push("/Applications/Google Chrome.app".into());
        if let Some(h) = dirs::home_dir() { candidates.push(h.join("Applications/Google Chrome.app")); }
    } else if cfg!(windows) {
        for var in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
            if let Ok(d) = std::env::var(var) { candidates.push(Path::new(&d).join("Google/Chrome/Application/chrome.exe")); }
        }
    } else {
        candidates.push("/usr/bin/google-chrome".into());
    }
    if let Some(p) = candidates.into_iter().find(|p| p.exists()) {
        return Some(format!("Google Chrome ({})", p.to_string_lossy()));
    }
    // Chromium téléchargé par Playwright (navigateur intégré d'ANZAR)
    let cache = if cfg!(target_os = "macos") { dirs::home_dir().map(|h| h.join("Library/Caches/ms-playwright")) }
        else if cfg!(windows) { std::env::var("LOCALAPPDATA").ok().map(|d| Path::new(&d).join("ms-playwright")) }
        else { dirs::home_dir().map(|h| h.join(".cache/ms-playwright")) };
    let dir = cache?;
    std::fs::read_dir(&dir).ok()?.flatten()
        .find(|e| e.file_name().to_string_lossy().starts_with("chromium"))
        .map(|_| "Chromium (téléchargé par ANZAR)".to_string())
}

fn status_now() -> Vec<Program> {
    let dev = apple_dev_tools();
    let mut list = Vec::new();

    let mut node = detect("node", "Node.js", &["node"], &["--version"], "auto", dev);
    if node.status == "ok" {
        if let Some((v, bin)) = crate::node_runtime::managed() {
            if node.path.as_deref().map(|p| p.starts_with(&*bin.to_string_lossy())).unwrap_or(false) {
                node.note = Some(format!("version d'ANZAR ({v})"));
            }
        }
    }
    list.push(node);

    let mut git = detect("git", "Git", &["git"], &["--version"], if cfg!(windows) { "auto" } else if cfg!(target_os = "macos") { "apple" } else { "manual" }, dev);
    if git.status == "ok" {
        if let Some(root) = managed_git_dir() {
            if git.path.as_deref().map(|p| p.starts_with(&*root.to_string_lossy())).unwrap_or(false) {
                git.note = Some("version d'ANZAR".into());
            }
        }
    }
    list.push(git);

    let py_names: &[&str] = if cfg!(windows) { &["python", "python3", "py"] } else { &["python3", "python"] };
    list.push(detect("python", "Python", py_names, &["--version"], if cfg!(target_os = "macos") { "apple" } else { "manual" }, dev));

    let chrome = chrome_present();
    list.push(Program {
        id: "chrome", name: "Navigateur (Chrome ou Chromium)",
        status: if chrome.is_some() { "ok" } else { "missing" },
        version: chrome, path: None, install: "auto",
        note: Some("Chromium est téléchargé automatiquement au premier besoin si Chrome est absent".into()),
    });

    for (id, name, exe) in [("uv", "uv (Python)", "uv"), ("cargo", "Rust (cargo)", "cargo"), ("docker", "Docker", "docker"), ("bun", "Bun", "bun"), ("deno", "Deno", "deno")] {
        list.push(detect(id, name, &[exe], &["--version"], "manual", dev));
    }
    list
}

#[tauri::command]
pub async fn programs_status() -> Vec<Program> {
    tauri::async_runtime::spawn_blocking(status_now).await.unwrap_or_default()
}

/// Mac : fait proposer par macOS l'installation des outils développeur d'Apple (Git, Python…).
#[tauri::command]
pub fn apple_dev_tools_install() -> Result<(), String> {
    if !cfg!(target_os = "macos") { return Err("réservé au Mac".into()); }
    if apple_dev_tools() { return Ok(()); }
    Command::new("/usr/bin/xcode-select").arg("--install").spawn().map_err(|e| e.to_string())?;
    Ok(())
}

// ── Git géré par ANZAR (Windows) ─────────────────────────────────────────────

fn git_root() -> Option<PathBuf> { dirs::data_dir().map(|d| d.join(IDENTIFIER).join("git")) }

/// Dossier de la version gérée de Git, si elle est installée.
pub fn managed_git_dir() -> Option<PathBuf> {
    let root = git_root()?;
    let v = std::fs::read_to_string(root.join("current")).ok()?.trim().to_string();
    if v.is_empty() || v.contains('/') || v.contains('\\') || v.contains("..") { return None; }
    let dir = root.join(v);
    dir.join("cmd").join("git.exe").exists().then_some(dir)
}

/// Ajoute le Git d'ANZAR au PATH si le système n'en a pas.
pub fn path_with_git(base: String) -> String {
    let Some(dir) = managed_git_dir() else { return base };
    let cmd = dir.join("cmd").to_string_lossy().to_string();
    let cleaned: Vec<&str> = base.split(sep()).filter(|p| !p.is_empty() && *p != cmd).collect();
    let cleaned = cleaned.join(sep());
    let system = cleaned.split(sep()).any(|d| Path::new(d).join("git.exe").is_file() && !d.contains("WindowsApps"));
    if system { cleaned } else { format!("{cmd}{}{cleaned}", sep()) }
}

#[derive(Clone, Serialize)]
struct Progress { received: u64, total: Option<u64>, step: &'static str }

#[tauri::command]
pub async fn git_install(app: AppHandle) -> Result<String, String> {
    if !cfg!(windows) {
        return Err(if cfg!(target_os = "macos") { "Sur Mac, Git vient des outils développeur d'Apple".into() } else { "installe Git avec le gestionnaire de paquets".into() });
    }
    let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "64-bit" };
    let client = reqwest::Client::builder().user_agent("ANZAR").build().map_err(|e| e.to_string())?;
    let _ = app.emit_all("git://progress", Progress { received: 0, total: None, step: "version" });
    let rel: serde_json::Value = client.get("https://api.github.com/repos/git-for-windows/git/releases/latest")
        .header("Accept", "application/vnd.github+json").send().await
        .map_err(|e| format!("GitHub injoignable : {e}"))?
        .json().await.map_err(|e| format!("réponse de GitHub illisible : {e}"))?;
    let tag = rel["tag_name"].as_str().ok_or("version introuvable")?.to_string();
    let assets = rel["assets"].as_array().ok_or("fichiers introuvables")?;
    let asset = assets.iter().find(|a| {
        let n = a["name"].as_str().unwrap_or("");
        n.starts_with("MinGit-") && n.ends_with(&format!("-{arch}.zip")) && !n.contains("busybox")
    }).ok_or("MinGit introuvable dans la dernière version")?;
    let name = asset["name"].as_str().unwrap_or_default().to_string();
    let url = asset["browser_download_url"].as_str().ok_or("lien introuvable")?.to_string();
    // Empreinte : champ « digest » de GitHub, sinon le tableau des empreintes des notes de version
    let expected = asset["digest"].as_str().and_then(|d| d.strip_prefix("sha256:")).map(|s| s.to_lowercase())
        .or_else(|| rel["body"].as_str().and_then(|body| body.lines().filter(|l| l.contains(&name))
            .flat_map(|l| l.split(|c: char| !c.is_ascii_hexdigit()).map(String::from).collect::<Vec<_>>())
            .find(|t| t.len() == 64).map(|t| t.to_lowercase())))
        .ok_or("empreinte officielle introuvable : installation annulée")?;

    let mut res = client.get(&url).send().await.map_err(|e| format!("téléchargement impossible : {e}"))?;
    if !res.status().is_success() { return Err(format!("téléchargement refusé ({})", res.status())); }
    let total = res.content_length();
    let mut data: Vec<u8> = Vec::new();
    let mut last = 0u64;
    while let Some(chunk) = res.chunk().await.map_err(|e| format!("connexion coupée : {e}"))? {
        data.extend_from_slice(&chunk);
        let r = data.len() as u64;
        if r - last > 512 * 1024 { last = r; let _ = app.emit_all("git://progress", Progress { received: r, total, step: "download" }); }
    }
    if format!("{:x}", Sha256::digest(&data)) != expected {
        return Err("fichier téléchargé corrompu (empreinte différente) : réessaie".into());
    }
    let _ = app.emit_all("git://progress", Progress { received: data.len() as u64, total, step: "extract" });
    let root = git_root().ok_or("dossier de données introuvable")?;
    let dest = root.join(&tag);
    let tmp = root.join(format!("{tag}.partial"));
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(data)).map_err(|e| format!("archive illisible : {e}"))?;
        zip.extract(&tmp).map_err(|e| format!("décompression impossible : {e}"))?;
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())??;
    std::fs::write(root.join("current"), &tag).map_err(|e| e.to_string())?;
    crate::node_runtime::apply_path_with(&app);
    let _ = app.emit_all("git://progress", Progress { received: 0, total: None, step: "done" });
    Ok(tag)
}
