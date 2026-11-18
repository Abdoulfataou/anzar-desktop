//! Outils binaires curés d'ANZAR (même modèle que Node géré) :
//! téléchargés une fois depuis une source officielle, empreinte SHA-256
//! ÉPINGLÉE (vérifiée à l'installation), rangés dans les fichiers de l'app,
//! exécutables — jamais installés sur le système.
//!
//! Catalogue :
//! - ffmpeg (ffmpeg-static b6.0, GPL) : encodage vidéo rapide, GIF→MP4,
//!   compression WhatsApp — utilisé par les skills et le terminal.
//! - ripgrep 14.1.1 : recherche instantanée dans le code.
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

// ============================================================================
// CATALOGUE (URL + empreinte vérifiées le 2026-11-17)
// ============================================================================

struct Artifact {
    url: &'static str,
    sha256: &'static str,
    /// « binary » : fichier exécutable direct ; « tar_gz » : archive contenant bin_member
    kind: &'static str,
    /// Chemin du binaire DANS l'archive (tar_gz)
    bin_member: &'static str,
}

struct CuratedTool {
    name: &'static str,
    version: &'static str,
    label: &'static str,
    size_mb: u32,
    darwin_arm64: Option<Artifact>,
    darwin_x64: Option<Artifact>,
}

const TOOLS: &[CuratedTool] = &[
    CuratedTool {
        name: "ffmpeg",
        version: "6.0",
        label: "FFmpeg — encodage vidéo rapide (MP4/GIF, compression WhatsApp)",
        size_mb: 46,
        darwin_arm64: Some(Artifact {
            url: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-darwin-arm64",
            sha256: "a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584",
            kind: "binary",
            bin_member: "",
        }),
        darwin_x64: Some(Artifact {
            url: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-darwin-x64",
            sha256: "cfe20936c83ecf5d68e424b87e8cc45b24dd6be81787810123bb964a0df686f9",
            kind: "binary",
            bin_member: "",
        }),
    },
    CuratedTool {
        name: "ripgrep",
        version: "14.1.1",
        label: "ripgrep — recherche instantanée dans le code (rg)",
        size_mb: 2,
        darwin_arm64: Some(Artifact {
            url: "https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-aarch64-apple-darwin.tar.gz",
            sha256: "24ad76777745fbff131c8fbc466742b011f925bfa4fffa2ded6def23b5b937be",
            kind: "tar_gz",
            bin_member: "ripgrep-14.1.1-aarch64-apple-darwin/rg",
        }),
        darwin_x64: Some(Artifact {
            url: "https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-apple-darwin.tar.gz",
            sha256: "fc87e78f7cb3fea12d69072e7ef3b21509754717b746368fd40d88963630e2b3",
            kind: "tar_gz",
            bin_member: "ripgrep-14.1.1-x86_64-apple-darwin/rg",
        }),
    },
];

fn find_tool(name: &str) -> Option<&'static CuratedTool> {
    TOOLS.iter().find(|t| t.name == name)
}

fn artifact_for(tool: &'static CuratedTool) -> Result<&'static Artifact, String> {
    let a = if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
        tool.darwin_arm64.as_ref()
    } else if cfg!(target_os = "macos") {
        tool.darwin_x64.as_ref()
    } else {
        None
    };
    match a {
        Some(a) => Ok(a),
        None => Err(format!("{} n'est pas encore disponible pour cette plateforme (macOS uniquement pour l'instant).", tool.name)),
    }
}

// ============================================================================
// ÉTAT
// ============================================================================

fn tools_root(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path_resolver().app_data_dir().map(|d| d.join("tools"))
}


#[derive(Clone, Serialize)]
pub struct ToolInfo {
    pub name: String,
    pub label: String,
    pub installed: bool,
    pub version: Option<String>,
    pub size_mb: u32,
    pub available: bool,
}

#[tauri::command]
pub fn tools_catalog(app: AppHandle) -> Vec<ToolInfo> {
    let root = tools_root(&app);
    TOOLS.iter()
        .map(|t| {
            let installed = root
                .as_ref()
                .map(|r| r.join(t.name).join("current").exists())
                .unwrap_or(false);
            let available = artifact_for(t).is_ok();
            ToolInfo {
                name: t.name.into(),
                label: t.label.into(),
                installed,
                version: installed.then(|| t.version.into()),
                size_mb: t.size_mb,
                available,
            }
        })
        .collect()
}

/// Dossier bin des outils installés (pour le PATH). Vide si rien d'installé.
pub fn installed_bins(app: &AppHandle) -> Vec<std::path::PathBuf> {
    let Some(root) = tools_root(app).and_then(|r| std::fs::read_dir(&r).ok().map(|_| r)) else { return vec![] };
    let mut out = vec![];
    for tool in TOOLS {
        let cur = root.join(tool.name).join("current");
        if cur.is_dir() {
            out.push(cur);
        }
    }
    out
}

// ============================================================================
// INSTALLATION
// ============================================================================

#[derive(Clone, Serialize)]
struct Progress { tool: String, received: u64, total: Option<u64>, step: &'static str }

fn set_executable(path: &std::path::Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut p = std::fs::metadata(path).map_err(|e| e.to_string())?.permissions();
        p.set_mode(0o755);
        std::fs::set_permissions(path, p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Installe un outil du catalogue : téléchargement, vérification SHA-256
/// épinglée, extraction, exécutable. Retourne la version installée.
#[tauri::command]
pub async fn tool_install(app: AppHandle, name: String) -> Result<String, String> {
    let tool = find_tool(&name).ok_or_else(|| format!("Outil inconnu : {name}. Catalogue : {}", TOOLS.iter().map(|t| t.name).collect::<Vec<_>>().join(", ")))?;
    let artifact = artifact_for(tool)?;
    let root = tools_root(&app).ok_or("dossier de données introuvable")?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let emit = |received: u64, total: Option<u64>, step: &'static str| {
        let _ = app.emit_all("tool://progress", Progress { tool: tool.name.into(), received, total, step });
    };

    emit(0, None, "download");
    let client = reqwest::Client::builder().user_agent("ANZAR").build().map_err(|e| e.to_string())?;
    let mut res = client.get(artifact.url).send().await.map_err(|e| format!("téléchargement impossible : {e}"))?;
    if !res.status().is_success() {
        return Err(format!("téléchargement refusé ({})", res.status()));
    }
    let total = res.content_length();
    let mut data: Vec<u8> = Vec::with_capacity(total.unwrap_or((tool.size_mb as u64) << 20) as usize);
    let mut last = 0u64;
    while let Some(chunk) = res.chunk().await.map_err(|e| format!("connexion coupée : {e}"))? {
        data.extend_from_slice(&chunk);
        let received = data.len() as u64;
        if received - last > 512 * 1024 {
            last = received;
            emit(received, total, "download");
        }
    }

    // Empreinte ÉPINGLÉE : toute substitution côté serveur est refusée
    emit(data.len() as u64, total, "verify");
    let got = format!("{:x}", Sha256::digest(&data));
    if got != artifact.sha256 {
        return Err("fichier téléchargé ne correspond pas à l'empreinte vérifiée : téléchargement annulé".into());
    }

    emit(data.len() as u64, total, "extract");
    let dest = root.join(tool.name).join(tool.version);
    let _ = std::fs::remove_dir_all(&dest);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let bin_name = if cfg!(windows) { format!("{}.exe", tool.name) } else { tool.name.into() };
    let bin_path = dest.join(&bin_name);

    if artifact.kind == "binary" {
        std::fs::write(&bin_path, &data).map_err(|e| e.to_string())?;
        set_executable(&bin_path)?;
    } else {
        // tar.gz : extraire uniquement le membre binaire (pas de unpack complet)
        let gz = flate2::read::GzDecoder::new(&data[..]);
        let mut tar = tar::Archive::new(gz);
        let mut found = false;
        for entry in tar.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path().map_err(|e| e.to_string())?.to_path_buf();
            if path.to_string_lossy() == artifact.bin_member {
                let mut out = Vec::new();
                std::io::Read::read_to_end(&mut entry, &mut out).map_err(|e| e.to_string())?;
                std::fs::write(&bin_path, &out).map_err(|e| e.to_string())?;
                set_executable(&bin_path)?;
                found = true;
                break;
            }
        }
        if !found {
            return Err("archive inattendue (binaire introuvable)".into());
        }
    }

    std::fs::write(root.join(tool.name).join("current-version"), tool.version).map_err(|e| e.to_string())?;
    // « current » doit être un DOSSIER (installed_bins le joint) : symlink stable
    let cur = root.join(tool.name).join("current");
    let _ = std::fs::remove_dir_all(&cur);
    #[cfg(unix)]
    { std::os::unix::fs::symlink(&dest, &cur).or_else(|_| std::fs::rename(&dest, &cur)).map_err(|e: std::io::Error| e.to_string())?; }
    #[cfg(not(unix))]
    { std::fs::rename(&dest, &cur).map_err(|e| e.to_string())?; }

    // Rend l'outil immédiatement disponible dans le PATH de l'app
    crate::node_runtime::apply_path_with(&app);
    emit(0, None, "done");
    Ok(tool.version.into())
}
