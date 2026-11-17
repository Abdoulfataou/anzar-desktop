//! Node.js géré par ANZAR.
//!
//! Beaucoup d'outils de l'agent (navigateur intégré, captures, export vidéo, vérification du
//! code, connecteurs) ont besoin de Node.js. S'il n'est pas installé (ou trop ancien), ANZAR
//! télécharge une seule fois la version LTS officielle depuis nodejs.org, vérifie son empreinte
//! SHA-256, et la range dans ses propres fichiers : rien n'est installé sur le système, aucun
//! mot de passe administrateur n'est demandé. Le PATH des commandes lancées par l'app la trouve.

use serde::Serialize;
use sha2::{Digest, Sha256};

use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

/// Version minimale acceptée pour un Node déjà installé (Playwright récent l'exige).
pub const MIN_MAJOR: u32 = 20;
const IDENTIFIER: &str = "com.anzar.desktop";
const DIST: &str = "https://nodejs.org/dist";

pub fn runtime_root() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join(IDENTIFIER).join("node"))
}

fn bin_dir(version_dir: &Path) -> PathBuf {
    if cfg!(windows) { version_dir.to_path_buf() } else { version_dir.join("bin") }
}

/// Version gérée active (fichier « current »), si elle est complète sur le disque.
pub fn managed() -> Option<(String, PathBuf)> {
    let root = runtime_root()?;
    let version = std::fs::read_to_string(root.join("current")).ok()?.trim().to_string();
    if version.is_empty() || version.contains('/') || version.contains('\\') || version.contains("..") {
        return None;
    }
    let bin = bin_dir(&root.join(&version));
    let exe = if cfg!(windows) { bin.join("node.exe") } else { bin.join("node") };
    exe.exists().then_some((version, bin))
}

fn node_version_with_path(path: &str) -> Option<String> {
    let mut c = Command::new(if cfg!(windows) { "node.exe" } else { "node" });
    c.arg("--version").env("PATH", path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    let out = c.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    v.starts_with('v').then_some(v)
}

fn major(v: &str) -> u32 {
    v.trim_start_matches('v').split('.').next().and_then(|m| m.parse().ok()).unwrap_or(0)
}

/// Node du système (hors version gérée), s'il existe.
pub fn system_version(path_without_managed: &str) -> Option<String> {
    node_version_with_path(path_without_managed)
}

/// PATH final : le Node du système s'il est assez récent, sinon la version gérée en tête.
pub fn path_with_node(base: String) -> String {
    let sep = if cfg!(windows) { ";" } else { ":" };
    let Some((_, bin)) = managed() else { return base };
    let bin = bin.to_string_lossy().to_string();
    let cleaned: Vec<&str> = base.split(sep).filter(|p| !p.is_empty() && *p != bin).collect();
    let cleaned = cleaned.join(sep);
    match system_version(&cleaned) {
        Some(v) if major(&v) >= MIN_MAJOR => cleaned,
        _ => format!("{bin}{sep}{cleaned}"),
    }
}

/// Recalcule le PATH du processus (au démarrage et après une installation).
pub fn apply_path() {
    std::env::set_var("PATH", crate::programs::path_with_git(path_with_node(crate::mcp::enriched_path())));
}

#[derive(Serialize)]
pub struct NodeStatus {
    /// Version utilisée par les commandes de l'app, si Node est disponible
    active: Option<String>,
    /// « system », « managed » ou « none »
    source: &'static str,
    system: Option<String>,
    managed: Option<String>,
    min_major: u32,
}

#[tauri::command]
pub fn node_status() -> NodeStatus {
    let path = std::env::var("PATH").unwrap_or_default();
    let managed_v = managed();
    let sep = if cfg!(windows) { ";" } else { ":" };
    let without = match &managed_v {
        Some((_, bin)) => {
            let b = bin.to_string_lossy().to_string();
            path.split(sep).filter(|p| *p != b).collect::<Vec<_>>().join(sep)
        }
        None => path.clone(),
    };
    let system = system_version(&without).filter(|v| major(v) >= MIN_MAJOR);
    let active = node_version_with_path(&path).filter(|v| major(v) >= MIN_MAJOR);
    let source = match (&active, &system) {
        (None, _) => "none",
        (Some(a), Some(s)) if a == s => "system",
        _ => "managed",
    };
    NodeStatus { active, source, system, managed: managed_v.map(|m| m.0), min_major: MIN_MAJOR }
}

#[derive(Clone, Serialize)]
struct Progress { received: u64, total: Option<u64>, step: &'static str }

fn platform() -> Result<(&'static str, &'static str, &'static str), String> {
    let os = if cfg!(target_os = "macos") { "darwin" } else if cfg!(windows) { "win" } else if cfg!(target_os = "linux") { "linux" } else {
        return Err("système non pris en charge".into());
    };
    let arch = if cfg!(target_arch = "aarch64") { "arm64" } else if cfg!(target_arch = "x86_64") { "x64" } else {
        return Err("processeur non pris en charge".into());
    };
    let ext = if cfg!(windows) { "zip" } else { "tar.gz" };
    Ok((os, arch, ext))
}

async fn latest_lts(client: &reqwest::Client) -> Result<String, String> {
    let list: Vec<serde_json::Value> = client.get(format!("{DIST}/index.json")).send().await
        .map_err(|e| format!("nodejs.org injoignable : {e}"))?
        .json().await.map_err(|e| format!("liste des versions illisible : {e}"))?;
    list.iter()
        .find(|v| v.get("lts").map(|l| l.is_string()).unwrap_or(false))
        .and_then(|v| v.get("version")).and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| "aucune version LTS trouvée".into())
}

fn extract(archive: &[u8], dest: &Path, top: &str) -> Result<(), String> {
    let tmp = dest.with_extension("partial");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    if cfg!(windows) {
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(archive)).map_err(|e| format!("archive illisible : {e}"))?;
        zip.extract(&tmp).map_err(|e| format!("décompression impossible : {e}"))?;
    } else {
        let gz = flate2::read::GzDecoder::new(archive);
        let mut tar = tar::Archive::new(gz);
        tar.set_preserve_permissions(true);
        tar.unpack(&tmp).map_err(|e| format!("décompression impossible : {e}"))?;
    }
    // L'archive contient un dossier « node-vX-os-arch » : il devient le dossier de la version
    let inner = tmp.join(top);
    if !inner.is_dir() {
        return Err("contenu de l'archive inattendu".into());
    }
    let _ = std::fs::remove_dir_all(dest);
    std::fs::rename(&inner, dest).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&tmp);
    Ok(())
}

/// Télécharge et installe la version LTS de Node dans les fichiers d'ANZAR. Retourne la version.
#[tauri::command]
pub async fn node_install(app: AppHandle) -> Result<String, String> {
    let (os, arch, ext) = platform()?;
    let root = runtime_root().ok_or("dossier de données introuvable")?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder().user_agent("ANZAR").build().map_err(|e| e.to_string())?;
    let _ = app.emit_all("node://progress", Progress { received: 0, total: None, step: "version" });
    let version = latest_lts(&client).await?;
    let top = format!("node-{version}-{os}-{arch}");
    let file = format!("{top}.{ext}");

    // Empreinte officielle
    let sums = client.get(format!("{DIST}/{version}/SHASUMS256.txt")).send().await
        .map_err(|e| format!("nodejs.org injoignable : {e}"))?
        .text().await.map_err(|e| e.to_string())?;
    let expected = sums.lines()
        .find_map(|l| { let mut it = l.split_whitespace(); let h = it.next()?; (it.next()? == file).then(|| h.to_lowercase()) })
        .ok_or_else(|| format!("{file} absent de la liste officielle"))?;

    // Téléchargement avec progression
    let mut res = client.get(format!("{DIST}/{version}/{file}")).send().await
        .map_err(|e| format!("téléchargement impossible : {e}"))?;
    if !res.status().is_success() {
        return Err(format!("téléchargement refusé ({})", res.status()));
    }
    let total = res.content_length();
    let mut data: Vec<u8> = Vec::with_capacity(total.unwrap_or(50 << 20) as usize);
    let mut last = 0u64;
    while let Some(chunk) = res.chunk().await.map_err(|e| format!("connexion coupée : {e}"))? {
        data.extend_from_slice(&chunk);
        let received = data.len() as u64;
        if received - last > 512 * 1024 {
            last = received;
            let _ = app.emit_all("node://progress", Progress { received, total, step: "download" });
        }
    }
    let _ = app.emit_all("node://progress", Progress { received: data.len() as u64, total, step: "verify" });
    let got = format!("{:x}", Sha256::digest(&data));
    if got != expected {
        return Err("fichier téléchargé corrompu (empreinte différente) : réessaie".into());
    }

    let _ = app.emit_all("node://progress", Progress { received: data.len() as u64, total, step: "extract" });
    let dest = root.join(&version);
    let archive = data;
    let dest2 = dest.clone();
    tauri::async_runtime::spawn_blocking(move || extract(&archive, &dest2, &top))
        .await.map_err(|e| e.to_string())??;
    std::fs::write(root.join("current"), &version).map_err(|e| e.to_string())?;
    apply_path();
    let _ = app.emit_all("node://progress", Progress { received: 0, total: None, step: "done" });
    Ok(version)
}

