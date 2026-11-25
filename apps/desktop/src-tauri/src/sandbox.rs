//! Isolation des écritures (macOS : Seatbelt via `sandbox-exec`).
//!
//! Aligné sur le modèle de Harness : le mode `workspace-write` autorise les écritures
//! dans le projet, les dossiers temporaires et les caches d'outils. Les lectures, le
//! réseau, les secrets et Git ne sont **pas** protégés : c'est le comportement de
//! Harness. Les seules règles propres à ANZAR qui restent sont les ports des
//! connecteurs (GIMP, Blender, OBS) et le tube d'Audacity.

use std::path::{Path, PathBuf};

/// Profil Seatbelt (SBPL) : écriture limitée au projet et aux zones de travail.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const PROFILE: &str = r#"(version 1)
(allow default)
(deny file-write*)
(allow file-write*
  (subpath (param "ROOT"))
  (subpath (param "GITDIR"))
  (subpath (param "TMP"))
  (subpath "/private/tmp")
  (subpath "/private/var/folders")
  (subpath (param "CACHES"))
  (subpath (param "NPM"))
  (subpath (param "DOTCACHE"))
  (subpath (param "CARGO"))
  (subpath (param "RUSTUP"))
  (subpath (param "PUB"))
  (subpath (param "DART_TOOL"))
  (subpath (param "DART_SERVER"))
  (subpath (param "FLUTTER_HOME"))
  (subpath (param "FLUTTER_SDK_CACHE"))
  (subpath (param "FLUTTER_TOOLS_CACHE"))
  (subpath (param "GRADLE"))
  (subpath (param "M2"))
  (subpath (param "ANDROID"))
  (subpath (param "GOPATH"))
  (subpath (param "COCOAPODS"))
  (subpath (param "XCODE"))
  (subpath (param "GEM"))
  (subpath (param "BUNDLE"))
  (subpath (param "COMPOSER"))
  (subpath (param "NUGET"))
  (subpath (param "DOTNET"))
  (subpath (param "BUN"))
  (subpath (param "YARN"))
  (subpath (param "PNPM"))
  (literal "/dev/null")
  (literal "/dev/zero")
  (literal "/dev/dtracehelper")
  (regex #"^/dev/tty")
  (regex #"^/dev/fd/"))
"#;

/// Ports locaux de logiciels qui exécutent du code sur demande, sans authentification.
/// 9877 : serveur MCP de GIMP ; 9876 : add-on MCP de Blender ; 4455 : obs-websocket.
/// Tube nommé d'Audacity (mod-script-pipe), qui accepte n'importe quelle commande.
/// Seuls les connecteurs d'ANZAR doivent pouvoir leur parler, jamais une commande.
pub const BLOCKED_LOCAL_PORTS: &str = r#"
(deny network-outbound (remote ip "*:9876"))
(deny network-outbound (remote ip "localhost:9876"))
(deny network-outbound (remote ip "*:9877"))
(deny network-outbound (remote ip "localhost:9877"))
(deny network-outbound (remote ip "*:4455"))
(deny network-outbound (remote ip "localhost:4455"))
"#;

/// Tube d'Audacity : règle de fichier, indépendante du réseau.
pub const AUDACITY_PIPE: &str = r#"
(deny file-read* file-write* (regex #"^/(private/)?tmp/audacity_script_pipe\."))
"#;

/// Dossier `bin/cache` du SDK Flutter installé (Flutter y prend un verrou à chaque commande).
fn flutter_sdk() -> Option<PathBuf> {
    let path = crate::mcp::enriched_path();
    let bin = std::env::split_paths(&path).map(|d| d.join("flutter")).find(|p| p.is_file())?;
    let real = std::fs::canonicalize(bin).ok()?;
    real.parent()?.parent().map(|p| p.to_path_buf())
}

pub struct Wrapped {
    pub program: String,
    pub args: Vec<String>,
}

/// Dossier git commun du dépôt. Dans une worktree, `.git` est un fichier
/// « gitdir: <dépôt>/.git/worktrees/<nom> » : on remonte jusqu'à `<dépôt>/.git`.
pub fn git_common_dir(root: &Path) -> PathBuf {
    let dot = root.join(".git");
    if let Ok(text) = std::fs::read_to_string(&dot) {
        if let Some(rest) = text.trim().strip_prefix("gitdir:") {
            let raw = PathBuf::from(rest.trim());
            let gitdir = if raw.is_absolute() { raw } else { root.join(raw) };
            if let Ok(g) = std::fs::canonicalize(&gitdir) {
                let parent = g.parent();
                let in_worktrees = parent
                    .and_then(|p| p.file_name())
                    .map(|n| n == "worktrees")
                    .unwrap_or(false);
                if in_worktrees {
                    if let Some(common) = parent.and_then(|p| p.parent()) {
                        return common.to_path_buf();
                    }
                }
                return g;
            }
        }
    }
    dot
}

/// Paramètres passés au profil (`-D CLÉ=valeur`), chemins réels (canonicalisés).
pub fn profile_params(root: &Path, home: &Path, tmp: &Path) -> Vec<(&'static str, String)> {
    let git = git_common_dir(root);
    let flutter = flutter_sdk().unwrap_or_else(|| PathBuf::from("/nonexistent/flutter-sdk"));
    let s = |p: PathBuf| p.to_string_lossy().into_owned();
    vec![
        ("ROOT", s(root.to_path_buf())),
        ("GITDIR", s(git)),
        ("TMP", s(tmp.to_path_buf())),
        ("CACHES", s(home.join("Library").join("Caches"))),
        ("NPM", s(home.join(".npm"))),
        ("DOTCACHE", s(home.join(".cache"))),
        ("CARGO", s(home.join(".cargo"))),
        ("RUSTUP", s(home.join(".rustup"))),
        ("PUB", s(home.join(".pub-cache"))),
        ("DART_TOOL", s(home.join(".dart-tool"))),
        ("DART_SERVER", s(home.join(".dartServer"))),
        ("FLUTTER_HOME", s(home.join(".flutter"))),
        ("FLUTTER_SDK_CACHE", s(flutter.join("bin").join("cache"))),
        ("FLUTTER_TOOLS_CACHE", s(flutter.join("packages").join("flutter_tools").join(".dart_tool"))),
        ("GRADLE", s(home.join(".gradle"))),
        ("M2", s(home.join(".m2"))),
        ("ANDROID", s(home.join(".android"))),
        ("GOPATH", s(home.join("go"))),
        ("COCOAPODS", s(home.join(".cocoapods"))),
        ("XCODE", s(home.join("Library").join("Developer"))),
        ("GEM", s(home.join(".gem"))),
        ("BUNDLE", s(home.join(".bundle"))),
        ("COMPOSER", s(home.join(".composer"))),
        ("NUGET", s(home.join(".nuget"))),
        ("DOTNET", s(home.join(".dotnet"))),
        ("BUN", s(home.join(".bun"))),
        ("YARN", s(home.join(".yarn"))),
        ("PNPM", s(home.join("Library").join("pnpm"))),
    ]
}

/// L'isolation est-elle disponible sur cet ordinateur ?
pub fn available() -> bool {
    cfg!(target_os = "macos") && Path::new("/usr/bin/sandbox-exec").exists()
}

/// Enveloppe une commande dans le sandbox (macOS). `root` doit être canonicalisé.
pub fn wrap(program: &str, args: &[String], root: &Path) -> Wrapped {
    if !available() {
        return Wrapped { program: program.to_string(), args: args.to_vec() };
    }
    let home = dirs::home_dir()
        .and_then(|h| std::fs::canonicalize(h).ok())
        .unwrap_or_else(|| PathBuf::from("/var/empty"));
    let tmp = std::fs::canonicalize(std::env::temp_dir()).unwrap_or_else(|_| PathBuf::from("/private/tmp"));
    let profile = format!("{PROFILE}{BLOCKED_LOCAL_PORTS}{AUDACITY_PIPE}");
    let mut out = vec!["-p".to_string(), profile];
    for (k, v) in profile_params(root, &home, &tmp) {
        out.push("-D".to_string());
        out.push(format!("{k}={v}"));
    }
    out.push(program.to_string());
    out.extend(args.iter().cloned());
    Wrapped { program: "/usr/bin/sandbox-exec".to_string(), args: out }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worktree_points_to_common_git_dir() {
        let base = std::env::temp_dir().join(format!("anzar-sbx-{}", std::process::id()));
        let repo_git = base.join("repo").join(".git");
        let wt_meta = repo_git.join("worktrees").join("t1");
        let wt = base.join("wt");
        std::fs::create_dir_all(&wt_meta).unwrap();
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::write(wt.join(".git"), format!("gitdir: {}\n", wt_meta.display())).unwrap();
        let common = git_common_dir(&wt);
        assert_eq!(common, std::fs::canonicalize(&repo_git).unwrap());
        let _ = std::fs::remove_dir_all(&base);
    }

    /// Vrai test Seatbelt (macOS) : un port local ordinaire reste joignable, les ports
    /// des connecteurs et le tube Audacity sont bloqués.
    #[test]
    fn app_ports_unreachable_from_agent_commands() {
        use std::net::TcpListener;
        use std::process::Command;
        if !available() || !Path::new("/usr/bin/nc").exists() { return; }
        let Ok(_gimp) = TcpListener::bind("127.0.0.1:9877") else { return };
        let Ok(_blender) = TcpListener::bind("127.0.0.1:9876") else { return };
        let Ok(_obs) = TcpListener::bind("127.0.0.1:4455") else { return };
        let autre = TcpListener::bind("127.0.0.1:0").unwrap();
        let port_ok = autre.local_addr().unwrap().port().to_string();
        let root = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let essai = |port: &str| {
            let args: Vec<String> = ["-z", "-w", "2", "127.0.0.1", port].iter().map(|x| x.to_string()).collect();
            let w = wrap("/usr/bin/nc", &args, &root);
            Command::new(&w.program).args(&w.args).status().unwrap().success()
        };
        assert!(essai(&port_ok), "un port local ordinaire doit rester joignable");
        assert!(!essai("9877"), "le port de GIMP doit être bloqué");
        assert!(!essai("9876"), "le port de Blender doit être bloqué");
        assert!(!essai("4455"), "le port d'OBS doit être bloqué");

        let touche = |chemin: &str| {
            let w = wrap("/usr/bin/touch", &[chemin.to_string()], &root);
            Command::new(&w.program).args(&w.args).status().unwrap().success()
        };
        let ok = format!("/private/tmp/anzar-sbx-ok-{}", std::process::id());
        assert!(touche(&ok), "/tmp doit rester utilisable");
        let _ = std::fs::remove_file(&ok);
        assert!(!touche("/private/tmp/audacity_script_pipe.to.anzartest"), "tube Audacity bloqué");
    }

    /// Vrai test Seatbelt (macOS) : un shell confiné peut écrire dans le projet, pas
    /// dans le dossier personnel.
    #[test]
    fn shell_confiné_écrit_dans_le_projet_pas_dans_le_home() {
        use std::process::Command;
        if !available() { return; }
        let base = std::fs::canonicalize(std::env::temp_dir()).unwrap()
            .join(format!("anzar-sbx-shell-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        let inside = base.join("ok.txt");
        let script = format!("echo ok > '{}'", inside.display());
        let w = wrap("/bin/bash", &["-c".to_string(), script], &base);
        assert!(Command::new(&w.program).args(&w.args).status().unwrap().success());
        assert!(inside.exists(), "écriture dans le projet autorisée");

        let home = dirs::home_dir().unwrap();
        let outside = home.join(format!(".anzar-sbx-shell-{}.txt", std::process::id()));
        let _ = std::fs::remove_file(&outside);
        let script = format!("echo non > '{}'", outside.display());
        let w = wrap("/bin/bash", &["-c".to_string(), script], &base);
        assert!(!Command::new(&w.program).args(&w.args).status().unwrap().success());
        assert!(!outside.exists(), "aucun fichier créé hors projet");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn plain_repo_uses_dot_git() {
        let root = PathBuf::from("/nonexistent/projet");
        assert_eq!(git_common_dir(&root), root.join(".git"));
    }

    #[test]
    fn params_cover_every_profile_placeholder() {
        let params = profile_params(Path::new("/p"), Path::new("/h"), Path::new("/t"));
        let full = PROFILE;
        for (k, _) in &params {
            assert!(full.contains(&format!("(param \"{k}\")")), "paramètre inutilisé : {k}");
        }
        let names: Vec<&str> = params.iter().map(|(k, _)| *k).collect();
        for cap in full.split("(param \"").skip(1) {
            let name = cap.split('"').next().unwrap();
            assert!(names.contains(&name), "paramètre manquant : {name}");
        }
    }
}
