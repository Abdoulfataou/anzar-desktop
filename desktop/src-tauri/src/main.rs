// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::Path;
use std::time::SystemTime;
use serde::{Deserialize, Serialize};

// Structure pour les informations de fichier
#[derive(Debug, Serialize, Deserialize)]
struct FileInfo {
    name: String,
    path: String,
    size: u64,
    is_dir: bool,
    modified: Option<u64>,
    created: Option<u64>,
    extension: Option<String>,
}

// Structure pour le contenu de fichier
#[derive(Debug, Serialize, Deserialize)]
struct FileContent {
    path: String,
    content: String,
    exists: bool,
}

// Structure pour le résultat des opérations
#[derive(Debug, Serialize, Deserialize)]
struct FileOperationResult {
    success: bool,
    message: String,
    path: Option<String>,
}

// Commande pour lister les fichiers d'un répertoire
#[tauri::command]
fn list_files(path: String) -> Result<Vec<FileInfo>, String> {
    let dir_path = Path::new(&path);
    
    if !dir_path.exists() {
        return Err(format!("Le répertoire n'existe pas: {}", path));
    }
    
    if !dir_path.is_dir() {
        return Err(format!("Le chemin n'est pas un répertoire: {}", path));
    }
    
    let mut files = Vec::new();
    
    match fs::read_dir(dir_path) {
        Ok(entries) => {
            for entry in entries {
                if let Ok(entry) = entry {
                    let path = entry.path();
                    let metadata = match entry.metadata() {
                        Ok(md) => md,
                        Err(_) => continue,
                    };
                    
                    let name = match path.file_name() {
                        Some(name) => name.to_string_lossy().to_string(),
                        None => continue,
                    };
                    
                    let extension = path.extension()
                        .map(|ext| ext.to_string_lossy().to_string());
                    
                    let modified = metadata.modified()
                        .ok()
                        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
                        .map(|duration| duration.as_secs());
                    
                    let created = metadata.created()
                        .ok()
                        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
                        .map(|duration| duration.as_secs());
                    
                    files.push(FileInfo {
                        name,
                        path: path.to_string_lossy().to_string(),
                        size: metadata.len(),
                        is_dir: metadata.is_dir(),
                        modified,
                        created,
                        extension,
                    });
                }
            }
            
            // Trier : d'abord les répertoires, puis les fichiers
            files.sort_by(|a, b| {
                if a.is_dir && !b.is_dir {
                    std::cmp::Ordering::Less
                } else if !a.is_dir && b.is_dir {
                    std::cmp::Ordering::Greater
                } else {
                    a.name.to_lowercase().cmp(&b.name.to_lowercase())
                }
            });
            
            Ok(files)
        }
        Err(e) => Err(format!("Erreur lors de la lecture du répertoire: {}", e)),
    }
}

// Commande pour lire un fichier
#[tauri::command]
fn read_file(path: String) -> Result<FileContent, String> {
    let file_path = Path::new(&path);
    
    if !file_path.exists() {
        return Ok(FileContent {
            path: path.clone(),
            content: String::new(),
            exists: false,
        });
    }
    
    if file_path.is_dir() {
        return Err(format!("Le chemin est un répertoire, pas un fichier: {}", path));
    }
    
    match fs::read_to_string(file_path) {
        Ok(content) => Ok(FileContent {
            path: path.clone(),
            content,
            exists: true,
        }),
        Err(e) => Err(format!("Erreur lors de la lecture du fichier: {}", e)),
    }
}

// Commande pour écrire dans un fichier
#[tauri::command]
fn write_file(path: String, content: String) -> Result<FileOperationResult, String> {
    let file_path = Path::new(&path);
    
    // Créer les répertoires parents si nécessaire
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            if let Err(e) = fs::create_dir_all(parent) {
                return Err(format!("Erreur lors de la création des répertoires: {}", e));
            }
        }
    }
    
    match fs::write(file_path, content) {
        Ok(_) => Ok(FileOperationResult {
            success: true,
            message: format!("Fichier écrit avec succès: {}", path),
            path: Some(path),
        }),
        Err(e) => Err(format!("Erreur lors de l'écriture du fichier: {}", e)),
    }
}

// Commande pour créer un nouveau fichier
#[tauri::command]
fn create_file(path: String) -> Result<FileOperationResult, String> {
    let file_path = Path::new(&path);
    
    if file_path.exists() {
        return Err(format!("Le fichier existe déjà: {}", path));
    }
    
    // Créer les répertoires parents si nécessaire
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            if let Err(e) = fs::create_dir_all(parent) {
                return Err(format!("Erreur lors de la création des répertoires: {}", e));
            }
        }
    }
    
    match fs::File::create(file_path) {
        Ok(_) => Ok(FileOperationResult {
            success: true,
            message: format!("Fichier créé avec succès: {}", path),
            path: Some(path),
        }),
        Err(e) => Err(format!("Erreur lors de la création du fichier: {}", e)),
    }
}

// Commande pour supprimer un fichier
#[tauri::command]
fn delete_file(path: String) -> Result<FileOperationResult, String> {
    let file_path = Path::new(&path);
    
    if !file_path.exists() {
        return Err(format!("Le fichier n'existe pas: {}", path));
    }
    
    let metadata = match fs::metadata(file_path) {
        Ok(md) => md,
        Err(e) => return Err(format!("Erreur lors de la récupération des métadonnées: {}", e)),
    };
    
    let result = if metadata.is_dir() {
        fs::remove_dir_all(file_path)
    } else {
        fs::remove_file(file_path)
    };
    
    match result {
        Ok(_) => Ok(FileOperationResult {
            success: true,
            message: format!("{} supprimé avec succès: {}", 
                if metadata.is_dir() { "Répertoire" } else { "Fichier" }, 
                path),
            path: Some(path),
        }),
        Err(e) => Err(format!("Erreur lors de la suppression: {}", e)),
    }
}

// Commande pour obtenir des informations sur un fichier
#[tauri::command]
fn get_file_info(path: String) -> Result<FileInfo, String> {
    let file_path = Path::new(&path);
    
    if !file_path.exists() {
        return Err(format!("Le fichier n'existe pas: {}", path));
    }
    
    let metadata = match fs::metadata(file_path) {
        Ok(md) => md,
        Err(e) => return Err(format!("Erreur lors de la récupération des métadonnées: {}", e)),
    };
    
    let name = match file_path.file_name() {
        Some(name) => name.to_string_lossy().to_string(),
        None => return Err("Impossible d'obtenir le nom du fichier".to_string()),
    };
    
    let extension = file_path.extension()
        .map(|ext| ext.to_string_lossy().to_string());
    
    let modified = metadata.modified()
        .ok()
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs());
    
    let created = metadata.created()
        .ok()
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs());
    
    Ok(FileInfo {
        name,
        path: path.clone(),
        size: metadata.len(),
        is_dir: metadata.is_dir(),
        modified,
        created,
        extension,
    })
}

// Commande pour obtenir le répertoire de base (home, desktop, etc.)
#[tauri::command]
fn get_base_directories() -> Result<serde_json::Value, String> {
    use dirs::*;
    
    let mut dirs = serde_json::Map::new();
    
    if let Some(home) = home_dir() {
        dirs.insert("home".to_string(), home.to_string_lossy().into());
    }
    
    if let Some(desktop) = desktop_dir() {
        dirs.insert("desktop".to_string(), desktop.to_string_lossy().into());
    }
    
    if let Some(documents) = document_dir() {
        dirs.insert("documents".to_string(), documents.to_string_lossy().into());
    }
    
    if let Some(downloads) = download_dir() {
        dirs.insert("downloads".to_string(), downloads.to_string_lossy().into());
    }
    
    if let Some(pictures) = picture_dir() {
        dirs.insert("pictures".to_string(), pictures.to_string_lossy().into());
    }
    
    if let Some(music) = audio_dir() {
        dirs.insert("music".to_string(), music.to_string_lossy().into());
    }
    
    if let Some(videos) = video_dir() {
        dirs.insert("videos".to_string(), videos.to_string_lossy().into());
    }
    
    Ok(serde_json::Value::Object(dirs))
}

// Commande pour obtenir le répertoire courant de l'application
#[tauri::command]
fn get_current_directory() -> Result<String, String> {
    match std::env::current_dir() {
        Ok(path) => Ok(path.to_string_lossy().to_string()),
        Err(e) => Err(format!("Erreur lors de la récupération du répertoire courant: {}", e)),
    }
}

// Structure pour les nœuds d'arborescence de fichiers (récursif)
#[derive(Debug, Serialize, Deserialize)]
struct FileTreeNode {
    id: String,
    name: String,
    path: String,
    node_type: String, // "file" ou "directory"
    extension: Option<String>,
    size: Option<u64>,
    last_modified: Option<u64>,
    children: Option<Vec<FileTreeNode>>,
}

// Commande pour sélectionner un dossier via une boîte de dialogue
#[tauri::command]
async fn select_directory() -> Result<Option<String>, String> {
    use tauri::api::dialog::blocking::FileDialogBuilder;
    
    let dialog = FileDialogBuilder::new().set_directory(std::env::current_dir().unwrap_or_default());
    
    match dialog.pick_folder() {
        Some(path) => Ok(Some(path.to_string_lossy().to_string())),
        None => Ok(None),
    }
}

// Commande pour lire récursivement un dossier et retourner une arborescence
#[tauri::command]
fn read_directory_recursive(path: String) -> Result<FileTreeNode, String> {
    let dir_path = Path::new(&path);
    
    if !dir_path.exists() {
        return Err(format!("Le répertoire n'existe pas: {}", path));
    }
    
    if !dir_path.is_dir() {
        return Err(format!("Le chemin n'est pas un répertoire: {}", path));
    }
    
    // Fonction récursive pour lire un dossier
    fn read_dir_recursive(path: &Path, base_path: &Path) -> Result<FileTreeNode, std::io::Error> {
        let metadata = fs::metadata(path)?;
        let name = path.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        
        let relative_path = if path == base_path {
            name.clone()
        } else {
            path.strip_prefix(base_path)
                .unwrap_or(path)
                .to_string_lossy()
                .to_string()
        };
        
        let mut node = FileTreeNode {
            id: relative_path.replace("/", "_").replace("\\", "_"),
            name: name.clone(),
            path: relative_path,
            node_type: if metadata.is_dir() { "directory".to_string() } else { "file".to_string() },
            extension: path.extension()
                .map(|ext| ext.to_string_lossy().to_string())
                .filter(|ext| !ext.is_empty()),
            size: if metadata.is_dir() { None } else { Some(metadata.len()) },
            last_modified: metadata.modified()
                .ok()
                .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs()),
            children: None,
        };
        
        if metadata.is_dir() {
            let mut children = Vec::new();
            
            match fs::read_dir(path) {
                Ok(entries) => {
                    for entry in entries {
                        match entry {
                            Ok(entry) => {
                                match read_dir_recursive(&entry.path(), base_path) {
                                    Ok(child) => children.push(child),
                                    Err(e) => eprintln!("Erreur lors de la lecture de {:?}: {}", entry.path(), e),
                                }
                            }
                            Err(e) => eprintln!("Erreur lors de la lecture d'une entrée: {}", e),
                        }
                    }
                    
                    // Trier les enfants : dossiers d'abord, puis fichiers par nom
                    children.sort_by(|a, b| {
                        match (a.node_type.as_str(), b.node_type.as_str()) {
                            ("directory", "file") => std::cmp::Ordering::Less,
                            ("file", "directory") => std::cmp::Ordering::Greater,
                            _ => a.name.cmp(&b.name),
                        }
                    });
                    
                    node.children = Some(children);
                }
                Err(e) => return Err(e),
            }
        }
        
        Ok(node)
    }
    
    match read_dir_recursive(dir_path, dir_path) {
        Ok(tree) => Ok(tree),
        Err(e) => Err(format!("Erreur lors de la lecture récursive: {}", e)),
    }
}

// Commande pour uploader un fichier (copier depuis un chemin source vers un chemin destination)
#[tauri::command]
fn upload_file(source_path: String, destination_path: String) -> Result<FileOperationResult, String> {
    let source = Path::new(&source_path);
    let destination = Path::new(&destination_path);
    
    if !source.exists() {
        return Ok(FileOperationResult {
            success: false,
            message: format!("Le fichier source n'existe pas: {}", source_path),
            path: None,
        });
    }
    
    // Créer les répertoires parents si nécessaire
    if let Some(parent) = destination.parent() {
        if !parent.exists() {
            if let Err(e) = fs::create_dir_all(parent) {
                return Ok(FileOperationResult {
                    success: false,
                    message: format!("Erreur lors de la création des répertoires parents: {}", e),
                    path: None,
                });
            }
        }
    }
    
    // Copier le fichier
    match fs::copy(source, destination) {
        Ok(_) => Ok(FileOperationResult {
            success: true,
            message: format!("Fichier uploadé avec succès: {}", destination_path),
            path: Some(destination_path),
        }),
        Err(e) => Ok(FileOperationResult {
            success: false,
            message: format!("Erreur lors de la copie du fichier: {}", e),
            path: None,
        }),
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_files,
            read_file,
            write_file,
            create_file,
            delete_file,
            get_file_info,
            get_base_directories,
            get_current_directory,
            select_directory,
            read_directory_recursive,
            upload_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}