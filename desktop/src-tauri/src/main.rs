// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod mcp;
mod node_runtime;
mod programs;

fn main() {
    // Une app lancée depuis le Finder ou le Dock ne reçoit pas le PATH du terminal
    // (/usr/bin:/bin seulement) : node, npm, python de Homebrew ou nvm seraient
    // introuvables. On relit le PATH du shell de l'utilisateur, puis on complète
    // avec les emplacements usuels. Les commandes lancées par l'app en héritent.
    let _ = fix_path_env::fix();
    std::env::set_var("PATH", mcp::enriched_path());
    // Node.js géré par ANZAR, s'il a été téléchargé et que celui du système manque ou est trop ancien
    node_runtime::apply_path();

    let app = tauri::Builder::default()
        // Secure storage: Stronghold (encrypted vault)
        .plugin(
            tauri_plugin_stronghold::Builder::new(|password| {
                // Derive a 32-bytes key from the provided password
                // (see plugin docs: you must provide a password-hash function).
                blake3::hash(password.as_bytes()).as_bytes().to_vec()
            })
            .build(),
        )
        // Serveurs MCP : transport stdio et HTTP (le protocole est géré par l'app)
        .manage(mcp::McpState::default())
        .invoke_handler(tauri::generate_handler![mcp::mcp_spawn, mcp::mcp_send, mcp::mcp_stop, mcp::mcp_http, open_personal_space, node_runtime::node_status, node_runtime::node_install, programs::programs_status, programs::apple_dev_tools_install, programs::git_install])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            // Aucun serveur MCP ne doit survivre à l'app
            mcp::stop_all(handle);
        }
    });
}

/// Ouvre l'« espace ANZAR » (Documents/ANZAR) dans le Finder ou l'Explorateur.
/// Sans argument : la page ne peut faire ouvrir aucun autre chemin.
#[tauri::command]
fn open_personal_space() -> Result<(), String> {
    let dir = tauri::api::path::document_dir()
        .ok_or_else(|| "Dossier Documents introuvable".to_string())?
        .join("ANZAR");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = std::process::Command::new("explorer");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(&dir).spawn().map_err(|e| e.to_string())?;
    Ok(())
}
