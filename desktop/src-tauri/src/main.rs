// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        // Secure storage: Stronghold (encrypted vault)
        .plugin(
            tauri_plugin_stronghold::Builder::new(|password| {
                // Derive a 32-bytes key from the provided password
                // (see plugin docs: you must provide a password-hash function).
                blake3::hash(password.as_bytes()).as_bytes().to_vec()
            })
            .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
