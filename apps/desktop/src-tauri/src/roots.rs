//! Dossiers de projet autorisés : liste tenue par Rust.
//!
//! La webview n'a qu'un périmètre fichiers étroit (données de l'app, Documents/ANZAR,
//! dossiers de skills). Un dossier de projet n'y entre que par une action de l'utilisateur
//! dans un sélecteur natif lancé par Rust (`project_pick_folder`, `project_create_folder`),
//! ou une fois, à la mise à jour, pour les projets déjà connus (`project_import_roots`).
//! La liste est enregistrée dans le dossier de données de l'app et ré-autorisée au démarrage.
//! Les commandes de l'agent (tool_spawn) n'acceptent un dossier que s'il est dans cette liste.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

const REGISTRY_FILE: &str = "allowed_roots.json";
const MAX_ROOTS: usize = 500;
/// Premiers dossiers sous le dossier personnel qui ne peuvent pas être un projet.
const SENSITIVE: &[&str] = &[".ssh", ".aws", ".gnupg", ".kube", ".docker", ".config", ".local", "Library", "AppData"];

#[derive(Default)]
pub struct RootsState {
    roots: Mutex<Vec<PathBuf>>,
    /// La liste existe sur le disque (migration déjà faite ou nouvelle installation).
    initialized: Mutex<bool>,
}

/// Vérifie qu'un chemin peut devenir un projet ; renvoie sa forme canonique.
pub fn validate_root(path: &Path, home: &Path) -> Result<PathBuf, String> {
    let p = std::fs::canonicalize(path).map_err(|_| "Dossier introuvable.".to_string())?;
    if !p.is_dir() {
        return Err("Ce n'est pas un dossier.".into());
    }
    if !p.starts_with(home) || p == home {
        return Err("Choisis un dossier à l'intérieur de ton dossier personnel (pas le dossier personnel lui-même).".into());
    }
    if let Some(first) = p.strip_prefix(home).ok().and_then(|r| r.components().next()) {
        let name = first.as_os_str().to_string_lossy();
        if SENSITIVE.iter().any(|s| name.eq_ignore_ascii_case(s)) {
            return Err("Dossier système ou de secrets : il ne peut pas être ouvert comme projet.".into());
        }
    }
    Ok(p)
}

/// `path` est-il dans un des dossiers `roots` (ou égal) ?
pub fn within_any(path: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|r| path.starts_with(r))
}

/// Répertoire utilisateur canonique. À utiliser pour toute comparaison avec un chemin passé par
/// `canonicalize` : sous Windows celui-ci renvoie la forme étendue `\\?\C:\…`, que `home_dir()`
/// brut ne préfixe jamais (le test `starts_with` échouerait toujours).
pub(crate) fn home() -> Result<PathBuf, String> {
    dirs::home_dir()
        .and_then(|h| std::fs::canonicalize(h).ok())
        .ok_or_else(|| "Répertoire utilisateur introuvable.".to_string())
}

fn registry_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(REGISTRY_FILE))
}

/// Dossiers toujours autorisés : Documents/ANZAR (espace ANZAR, worktrees) et données de l'app.
fn fixed_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(d) = app.path().document_dir() {
        if let Ok(p) = std::fs::canonicalize(d.join("ANZAR")) { out.push(p); }
    }
    if let Ok(d) = app.path().app_data_dir() {
        if let Ok(p) = std::fs::canonicalize(d) { out.push(p); }
    }
    out
}

fn persist(app: &AppHandle, roots: &[PathBuf]) -> Result<(), String> {
    let file = registry_file(app).ok_or("Dossier de données introuvable.")?;
    if let Some(dir) = file.parent() { std::fs::create_dir_all(dir).map_err(|e| e.to_string())?; }
    let list: Vec<String> = roots.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn allow_in_scope(app: &AppHandle, root: &Path) {
    if let Some(scope) = app.try_fs_scope() {
        let _ = scope.allow_directory(root, true);
    }
}

/// Au démarrage : relit la liste et ré-autorise chaque dossier encore présent.
pub fn restore(app: &AppHandle) {
    let state = app.state::<RootsState>();
    let Some(file) = registry_file(app) else { return };
    let Ok(text) = std::fs::read_to_string(&file) else { return };
    let saved: Vec<String> = serde_json::from_str(&text).unwrap_or_default();
    let Ok(home) = home() else { return };
    let mut roots = Vec::new();
    for s in saved {
        // Un dossier déplacé ou supprimé reste dans la liste : il revient s'il réapparaît.
        match validate_root(Path::new(&s), &home) {
            Ok(p) => { allow_in_scope(app, &p); roots.push(p); }
            Err(_) => roots.push(PathBuf::from(s)),
        }
    }
    *state.roots.lock().unwrap() = roots;
    *state.initialized.lock().unwrap() = true;
}

/// Ajoute un dossier à la liste (et au périmètre de la webview) ; renvoie sa forme canonique.
fn grant(app: &AppHandle, path: &Path) -> Result<PathBuf, String> {
    let p = validate_root(path, &home()?)?;
    allow_in_scope(app, &p);
    let state = app.state::<RootsState>();
    let snapshot = {
        let mut roots = state.roots.lock().unwrap();
        if !roots.contains(&p) {
            roots.push(p.clone());
            if roots.len() > MAX_ROOTS { let excess = roots.len() - MAX_ROOTS; roots.drain(0..excess); }
        }
        roots.clone()
    };
    persist(app, &snapshot)?;
    *state.initialized.lock().unwrap() = true;
    Ok(p)
}

/// Un dossier de travail (déjà canonique) est-il autorisé pour les commandes de l'agent ?
pub fn is_allowed_root(app: &AppHandle, root: &Path) -> bool {
    let state = app.state::<RootsState>();
    let roots = state.roots.lock().unwrap().clone();
    within_any(root, &roots) || within_any(root, &fixed_roots(app))
}

/// Fichiers déposés dans la fenêtre : lisibles par la webview (pièces jointes).
pub fn allow_dropped(app: &AppHandle, paths: &[PathBuf]) {
    let Ok(home) = home() else { return };
    let Some(scope) = app.try_fs_scope() else { return };
    for path in paths.iter().take(16) {
        let Ok(p) = std::fs::canonicalize(path) else { continue };
        let sensitive = p.strip_prefix(&home).ok()
            .and_then(|r| r.components().next())
            .map(|c| SENSITIVE.iter().any(|s| c.as_os_str().to_string_lossy().eq_ignore_ascii_case(s)))
            .unwrap_or(false);
        if sensitive || !p.is_file() { continue; }
        let _ = scope.allow_file(&p);
    }
}

#[tauri::command]
pub async fn project_pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app.dialog().file().set_title("Ouvrir un dossier de travail").blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    Ok(Some(grant(&app, &path)?.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn project_create_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app.dialog().file().set_title("Nouveau projet — choisir un emplacement").blocking_save_file() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&path).map_err(|e| format!("Création du dossier impossible : {e}"))?;
    Ok(Some(grant(&app, &path)?.to_string_lossy().into_owned()))
}

/// Migration unique : les projets déjà connus de l'app avant la liste Rust.
/// Sans effet une fois la liste créée (la webview ne peut plus rien y ajouter seule).
#[tauri::command]
pub fn project_import_roots(app: AppHandle, paths: Vec<String>) -> Result<u32, String> {
    let state = app.state::<RootsState>();
    if *state.initialized.lock().unwrap() {
        return Ok(0);
    }
    let home = home()?;
    let mut imported = 0;
    let snapshot = {
        let mut roots = state.roots.lock().unwrap();
        for s in paths.iter().take(MAX_ROOTS) {
            if let Ok(p) = validate_root(Path::new(s), &home) {
                allow_in_scope(&app, &p);
                if !roots.contains(&p) { roots.push(p); imported += 1; }
            }
        }
        roots.clone()
    };
    persist(&app, &snapshot)?;
    *state.initialized.lock().unwrap() = true;
    Ok(imported)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_home() -> PathBuf {
        let h = std::env::temp_dir().join(format!("anzar-roots-{}-{}", std::process::id(), rand_suffix()));
        std::fs::create_dir_all(&h).unwrap();
        std::fs::canonicalize(h).unwrap()
    }
    fn rand_suffix() -> u128 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos() }

    #[test]
    fn accepts_a_project_inside_home() {
        let home = tmp_home();
        std::fs::create_dir_all(home.join("Desktop/ANZAR")).unwrap();
        assert_eq!(validate_root(&home.join("Desktop/ANZAR"), &home).unwrap(), home.join("Desktop/ANZAR"));
    }

    #[test]
    fn refuses_home_itself_and_outside() {
        let home = tmp_home();
        assert!(validate_root(&home, &home).is_err());
        assert!(validate_root(Path::new("/"), &home).is_err());
    }

    #[test]
    fn refuses_secret_and_system_dirs() {
        let home = tmp_home();
        for d in [".ssh/keys", "Library/Application Support", ".aws"] {
            std::fs::create_dir_all(home.join(d)).unwrap();
            assert!(validate_root(&home.join(d), &home).is_err(), "{d} devrait être refusé");
        }
    }

    #[test]
    fn refuses_files_and_missing_paths() {
        let home = tmp_home();
        std::fs::write(home.join("note.txt"), "x").unwrap();
        assert!(validate_root(&home.join("note.txt"), &home).is_err());
        assert!(validate_root(&home.join("absent"), &home).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_is_resolved_before_checks() {
        let home = tmp_home();
        std::fs::create_dir_all(home.join(".ssh")).unwrap();
        std::os::unix::fs::symlink(home.join(".ssh"), home.join("projet")).unwrap();
        assert!(validate_root(&home.join("projet"), &home).is_err());
    }

    #[test]
    fn within_any_matches_subfolders_only() {
        let roots = vec![PathBuf::from("/u/a/projet")];
        assert!(within_any(Path::new("/u/a/projet/src"), &roots));
        assert!(within_any(Path::new("/u/a/projet"), &roots));
        assert!(!within_any(Path::new("/u/a/projet-2"), &roots));
    }
}
