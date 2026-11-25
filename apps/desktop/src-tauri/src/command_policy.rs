//! Réglage d'isolation des commandes, gardé côté Rust.
//!
//! Il ne reste qu'un bouton : isoler les écritures (Seatbelt macOS) ou non.
//! L'interface peut le changer, mais tout affaiblissement passe par une confirmation
//! native du système. Les réseaux, hôtes et programmes ne sont plus des réglages :
//! Harness ne les restreint pas.

use std::path::PathBuf;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

const POLICY_FILE: &str = "command-policy.json";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CommandPolicy {
    /// Isoler les écritures (macOS : Seatbelt). Ignoré là où l'isolation n'existe pas.
    pub sandbox: bool,
}

impl Default for CommandPolicy {
    fn default() -> Self {
        Self { sandbox: true }
    }
}

#[derive(Default)]
pub struct PolicyState(RwLock<CommandPolicy>);

fn policy_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(POLICY_FILE))
}

/// Au démarrage : relit le réglage enregistré (isolation active sinon).
pub fn load(app: &AppHandle) {
    let Some(file) = policy_file(app) else { return };
    let Ok(text) = std::fs::read_to_string(&file) else { return };
    let Ok(saved) = serde_json::from_str::<CommandPolicy>(&text) else { return };
    *app.state::<PolicyState>().0.write().unwrap() = saved;
}

fn persist(app: &AppHandle, policy: &CommandPolicy) -> Result<(), String> {
    let file = policy_file(app).ok_or("Dossier de données introuvable.")?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(policy).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn current(app: &AppHandle) -> CommandPolicy {
    app.state::<PolicyState>().0.read().unwrap().clone()
}

pub fn weakenings(old: &CommandPolicy, new: &CommandPolicy) -> Vec<String> {
    if old.sandbox && !new.sandbox {
        vec!["désactiver l'isolation des écritures (les commandes pourront écrire hors du projet)".into()]
    } else {
        Vec::new()
    }
}

#[tauri::command]
pub fn command_policy_get(state: State<'_, PolicyState>) -> CommandPolicy {
    state.0.read().unwrap().clone()
}

/// Enregistre le réglage. Couper l'isolation demande une confirmation native.
#[tauri::command]
pub async fn command_policy_set(app: AppHandle, policy: CommandPolicy) -> Result<CommandPolicy, String> {
    let next = policy;
    let old = current(&app);
    if next == old {
        return Ok(next);
    }
    let weak = weakenings(&old, &next);
    if !weak.is_empty() {
        use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
        let text = format!(
            "ANZAR va :\n\n• {}\n\nCela réduit la protection de ton ordinateur contre les commandes lancées par l'agent. \
             Confirme seulement si c'est toi qui viens de faire ce changement.",
            weak.join("\n• ")
        );
        let ok = app
            .dialog()
            .message(text)
            .title("Confirmer le changement de sécurité")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom("Confirmer".into(), "Annuler".into()))
            .blocking_show();
        if !ok {
            return Err("Changement annulé : la protection reste en place.".into());
        }
    }
    persist(&app, &next)?;
    *app.state::<PolicyState>().0.write().unwrap() = next.clone();
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_disabling_sandbox_is_a_weakening() {
        let on = CommandPolicy { sandbox: true };
        let off = CommandPolicy { sandbox: false };
        assert!(weakenings(&on, &off).iter().any(|l| l.contains("isolation")));
        assert!(weakenings(&off, &on).is_empty());
        assert!(weakenings(&on, &on).is_empty());
    }
}
