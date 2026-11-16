// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod mcp;

fn main() {
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
        .invoke_handler(tauri::generate_handler![mcp::mcp_spawn, mcp::mcp_send, mcp::mcp_stop, mcp::mcp_http])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            // Aucun serveur MCP ne doit survivre à l'app
            mcp::stop_all(handle);
        }
    });
}
