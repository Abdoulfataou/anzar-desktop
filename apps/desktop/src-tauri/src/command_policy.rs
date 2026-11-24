//! Réglages de sécurité des commandes de l'agent, gardés côté Rust.
//!
//! Avant (audit du 23/11/2026, point #3), `tool_spawn` croyait l'interface sur parole :
//! `sandbox: false`, `proxy: false` ou une liste d'hôtes envoyés par la webview suffisaient à
//! lancer une commande sans isolation ni filtrage. Un script injecté dans l'interface aurait
//! donc pu tout désactiver en silence.
//!
//! Désormais la référence est ici :
//! - l'interface peut seulement **renforcer** la protection d'une commande, jamais l'affaiblir ;
//! - tout affaiblissement d'un réglage passe par une **fenêtre native** du système, que la
//!   webview ne peut ni afficher à la place de Rust ni valider elle-même ;
//! - le fichier est rangé à la racine des données de l'app, hors du périmètre `$APPDATA/store`
//!   que la webview peut écrire.

use std::path::PathBuf;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

const POLICY_FILE: &str = "command-policy.json";
const MAX_EXTRA_HOSTS: usize = 100;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CommandPolicy {
    /// Isoler les commandes (macOS : Seatbelt). Ignoré là où l'isolation n'existe pas.
    pub sandbox: bool,
    /// Réseau des commandes ouvert (sinon : seulement installations acceptées, git, localhost).
    pub network: bool,
    /// Filtrage réseau par le proxy local (liste d'hôtes autorisés).
    pub proxy: bool,
    /// Hôtes autorisés en plus des valeurs par défaut du proxy.
    pub extra_hosts: Vec<String>,
}

impl Default for CommandPolicy {
    /// Mêmes valeurs par défaut que les réglages de l'interface.
    fn default() -> Self {
        Self { sandbox: true, network: true, proxy: true, extra_hosts: Vec::new() }
    }
}

impl CommandPolicy {
    fn normalized(mut self) -> Self {
        let mut hosts: Vec<String> = Vec::new();
        for h in self.extra_hosts.iter().map(|h| crate::netproxy::normalize(h)) {
            if !h.is_empty() && !hosts.contains(&h) {
                hosts.push(h);
            }
        }
        hosts.truncate(MAX_EXTRA_HOSTS);
        self.extra_hosts = hosts;
        self
    }
}

#[derive(Default)]
pub struct PolicyState(RwLock<CommandPolicy>);

fn policy_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(POLICY_FILE))
}

/// Au démarrage : relit les réglages enregistrés (valeurs par défaut sinon).
pub fn load(app: &AppHandle) {
    let Some(file) = policy_file(app) else { return };
    let Ok(text) = std::fs::read_to_string(&file) else { return };
    // Fichier illisible : on garde les valeurs par défaut, qui sont les plus protectrices.
    let Ok(saved) = serde_json::from_str::<CommandPolicy>(&text) else { return };
    *app.state::<PolicyState>().0.write().unwrap() = saved.normalized();
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

/// Réglages en vigueur (copie).
pub fn current(app: &AppHandle) -> CommandPolicy {
    app.state::<PolicyState>().0.read().unwrap().clone()
}

/// Ce que le changement affaiblit, en clair, pour la fenêtre de confirmation.
pub fn weakenings(old: &CommandPolicy, new: &CommandPolicy) -> Vec<String> {
    let mut out = Vec::new();
    if old.sandbox && !new.sandbox {
        out.push("désactiver l'isolation des commandes (elles pourront écrire partout dans ton compte)".into());
    }
    if !old.network && new.network {
        out.push("ouvrir internet aux commandes de l'agent".into());
    }
    if old.proxy && !new.proxy {
        out.push("couper le filtrage réseau (toutes les adresses deviennent joignables)".into());
    }
    let added: Vec<&str> = new
        .extra_hosts
        .iter()
        .filter(|h| !old.extra_hosts.contains(h))
        .map(|h| h.as_str())
        .collect();
    if !added.is_empty() {
        out.push(format!("autoriser ces adresses pour les commandes : {}", added.join(", ")));
    }
    out
}

#[tauri::command]
pub fn command_policy_get(state: State<'_, PolicyState>) -> CommandPolicy {
    state.0.read().unwrap().clone()
}

/// Enregistre les réglages. Un affaiblissement demande d'abord une confirmation native.
/// Commande asynchrone : la fenêtre bloquante ne doit pas tourner sur le thread principal.
#[tauri::command]
pub async fn command_policy_set(app: AppHandle, policy: CommandPolicy) -> Result<CommandPolicy, String> {
    let next = policy.normalized();
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

/// Protection effective d'une commande : l'interface peut seulement en demander plus.
#[derive(Debug, PartialEq, Eq)]
pub struct Effective {
    pub sandbox: bool,
    pub network: bool,
    pub proxy: bool,
}

/// `requested_*` viennent de l'interface (non fiable) ; `install_net` du contrôle Rust des
/// installations acceptées (`sandbox::network_allowed`).
pub fn effective(
    policy: &CommandPolicy,
    requested_sandbox: Option<bool>,
    requested_network: Option<bool>,
    requested_proxy: Option<bool>,
    install_net: bool,
) -> Effective {
    let renderer_net = requested_network.unwrap_or(false);
    Effective {
        sandbox: policy.sandbox || requested_sandbox.unwrap_or(true),
        network: renderer_net || install_net,
        // Si le réseau n'est ouvert que parce que l'interface le demande (réglage « Coupé »),
        // il passe obligatoirement par le filtrage.
        proxy: policy.proxy || requested_proxy.unwrap_or(false) || (renderer_net && !policy.network),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(sandbox: bool, network: bool, proxy: bool, hosts: &[&str]) -> CommandPolicy {
        CommandPolicy { sandbox, network, proxy, extra_hosts: hosts.iter().map(|s| s.to_string()).collect() }
    }

    #[test]
    fn renderer_cannot_disable_sandbox_or_proxy() {
        let pol = CommandPolicy::default();
        let e = effective(&pol, Some(false), Some(true), Some(false), false);
        assert!(e.sandbox, "sandbox:false venu de l'interface doit être ignoré");
        assert!(e.proxy, "proxy:false venu de l'interface doit être ignoré");
    }

    #[test]
    fn renderer_can_strengthen() {
        let pol = p(false, true, false, &[]);
        let e = effective(&pol, Some(true), Some(false), Some(true), false);
        assert_eq!(e, Effective { sandbox: true, network: false, proxy: true });
    }

    #[test]
    fn network_closed_forces_proxy_for_renderer_requests() {
        let pol = p(true, false, false, &[]);
        let e = effective(&pol, None, Some(true), Some(false), false);
        assert!(e.network && e.proxy);
        // Installation acceptée (contrôle Rust) : pas de proxy imposé par ce seul motif.
        let e = effective(&pol, None, Some(false), Some(false), true);
        assert!(e.network && !e.proxy);
    }

    #[test]
    fn user_choice_respected_when_policy_allows() {
        let pol = p(false, true, false, &[]);
        let e = effective(&pol, Some(false), Some(true), Some(false), false);
        assert_eq!(e, Effective { sandbox: false, network: true, proxy: false });
    }

    #[test]
    fn weakenings_detected() {
        let old = CommandPolicy::default();
        assert!(weakenings(&old, &old).is_empty());
        assert_eq!(weakenings(&old, &p(false, true, true, &[])).len(), 1);
        assert_eq!(weakenings(&old, &p(true, true, false, &[])).len(), 1);
        assert_eq!(weakenings(&p(true, false, true, &[]), &old).len(), 1);
        let w = weakenings(&old, &p(true, true, true, &["api.exemple.com"]));
        assert!(w[0].contains("api.exemple.com"));
        // Renforcer ou retirer un hôte ne demande rien.
        assert!(weakenings(&p(false, true, false, &["a.com"]), &p(true, false, true, &[])).is_empty());
    }

    #[test]
    fn hosts_normalized_and_capped() {
        let n = p(true, true, true, &["  API.Exemple.TLD. ", "*.api.exemple.tld", "", "api.exemple.tld"]).normalized();
        assert_eq!(n.extra_hosts, vec!["api.exemple.tld".to_string()]);
        let many: Vec<String> = (0..300).map(|i| format!("h{i}.com")).collect();
        let n = CommandPolicy { extra_hosts: many, ..CommandPolicy::default() }.normalized();
        assert_eq!(n.extra_hosts.len(), MAX_EXTRA_HOSTS);
    }

    #[test]
    fn unknown_or_missing_fields_fall_back_to_safe_defaults() {
        let parsed: CommandPolicy = serde_json::from_str("{\"network\":false}").unwrap();
        assert_eq!(parsed, p(true, false, true, &[]));
    }
}
