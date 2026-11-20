// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use sqlx::{SqlitePool, sqlite::SqlitePoolOptions};
use std::path::PathBuf;

// Structure pour la base de données
struct AppState {
    db_pool: SqlitePool,
}

// Initialisation de la base de données
async fn init_database(app_handle: &tauri::AppHandle) -> Result<SqlitePool, sqlx::Error> {
    let app_dir = app_handle.path_resolver().app_data_dir().expect("Failed to get app data dir");
    std::fs::create_dir_all(&app_dir).expect("Failed to create app data directory");
    
    let db_path = app_dir.join("issalan_admin.db");
    let database_url = format!("sqlite:{}", db_path.display());
    
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;
    
    // Création des tables
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            country TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'active',
            projects_count INTEGER DEFAULT 0
        )
        "#
    ).execute(&pool).await?;
    
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            name TEXT NOT NULL,
            description TEXT,
            language TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            file_path TEXT,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
        "#
    ).execute(&pool).await?;
    
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS system_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            level TEXT NOT NULL,
            source TEXT NOT NULL,
            message TEXT NOT NULL,
            user_id INTEGER,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
        "#
    ).execute(&pool).await?;
    
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        "#
    ).execute(&pool).await?;
    
    Ok(pool)
}

// Commande pour obtenir les utilisateurs
#[tauri::command]
async fn get_users(state: tauri::State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let users = sqlx::query_as::<_, (i64, String, String, Option<String>, String, String, i64)>(
        "SELECT id, name, email, country, created_at, status, projects_count FROM users ORDER BY created_at DESC LIMIT 100"
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| e.to_string())?;
    
    let result = users.into_iter().map(|(id, name, email, country, created_at, status, projects_count)| {
        serde_json::json!({
            "id": id,
            "name": name,
            "email": email,
            "country": country.unwrap_or_default(),
            "created_at": created_at,
            "status": status,
            "projects_count": projects_count
        })
    }).collect();
    
    Ok(result)
}

// Commande pour obtenir les statistiques
#[tauri::command]
async fn get_statistics(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let total_users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&state.db_pool)
        .await
        .map_err(|e| e.to_string())?;
    
    let active_users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE status = 'active'")
        .fetch_one(&state.db_pool)
        .await
        .map_err(|e| e.to_string())?;
    
    let total_projects: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects")
        .fetch_one(&state.db_pool)
        .await
        .map_err(|e| e.to_string())?;
    
    let completed_projects: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE status = 'completed'")
        .fetch_one(&state.db_pool)
        .await
        .map_err(|e| e.to_string())?;
    
    Ok(serde_json::json!({
        "total_users": total_users,
        "active_users": active_users,
        "total_projects": total_projects,
        "completed_projects": completed_projects,
        "completion_rate": if total_projects > 0 {
            (completed_projects as f64 / total_projects as f64 * 100.0).round() as i64
        } else {
            0
        }
    }))
}

// Commande pour sauvegarder les paramètres
#[tauri::command]
async fn save_setting(state: tauri::State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    sqlx::query(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
    )
    .bind(&key)
    .bind(&value)
    .execute(&state.db_pool)
    .await
    .map_err(|e| e.to_string())?;
    
    Ok(())
}

// Commande pour obtenir les paramètres
#[tauri::command]
async fn get_settings(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let settings = sqlx::query_as::<_, (String, String)>(
        "SELECT key, value FROM settings"
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| e.to_string())?;
    
    let mut result = serde_json::Map::new();
    for (key, value) in settings {
        result.insert(key, serde_json::Value::String(value));
    }
    
    Ok(serde_json::Value::Object(result))
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle();
            
            tauri::async_runtime::block_on(async move {
                match init_database(&app_handle).await {
                    Ok(db_pool) => {
                        app_handle.manage(AppState { db_pool });
                        println!("Database initialized successfully");
                    }
                    Err(e) => {
                        eprintln!("Failed to initialize database: {}", e);
                    }
                }
            });
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_users,
            get_statistics,
            save_setting,
            get_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}