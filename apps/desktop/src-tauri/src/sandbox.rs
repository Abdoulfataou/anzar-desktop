//! Isolation des commandes de l'agent (macOS : Seatbelt via `sandbox-exec`).
//!
//! Une commande lancée par l'agent ne peut écrire que dans le dossier du projet, le
//! dossier git du dépôt (worktrees des tickets), les dossiers temporaires et les caches
//! des outils (npm, cargo…). Les hooks et la config git restent en lecture seule, et
//! les dossiers de secrets (~/.ssh, ~/.aws, ~/.gnupg, ~/.kube, ~/.netrc,
//! ~/.git-credentials) sont illisibles. Le réseau sortant est coupé (sauf localhost : serveurs
//! de dev, bases locales) quand `allow_network` est faux : voir `network_allowed`.
//!
//! Sur Windows et Linux, `wrap` ne change rien pour l'instant : l'isolation repose sur
//! la politique de commandes et les accords (étape suivante : jetons restreints Windows).

use std::path::{Path, PathBuf};

/// Profil Seatbelt (SBPL). Dans un profil SBPL, la dernière règle qui correspond gagne :
/// les interdictions finales l'emportent donc sur les autorisations d'écriture.
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
(deny file-write*
  (subpath (param "ROOT_HOOKS"))
  (literal (param "ROOT_GITCONFIG"))
  (subpath (param "GIT_HOOKS"))
  (literal (param "GIT_CONFIG")))
(deny file-read* file-write*
  (subpath (param "SSH"))
  (subpath (param "AWS"))
  (subpath (param "GNUPG"))
  (subpath (param "KUBE"))
  (literal (param "NETRC"))
  (literal (param "GITCRED")))
"#;

/// Ajouté au profil quand la commande n'a pas droit au réseau : connexions sortantes
/// coupées, sauf vers localhost. Les sockets Unix (résolution DNS du système) ne sont
/// pas concernés ; l'écoute (serveur de dev) non plus.
pub const NETWORK_RULES: &str = r#"
(deny network-outbound (remote ip "*:*"))
(allow network-outbound (remote ip "localhost:*"))
"#;

/// La commande a-t-elle besoin d'internet ? Seules les commandes qui téléchargent des
/// dépendances ou synchronisent un dépôt l'obtiennent ; les installations, seulement
/// après l'accord de l'utilisateur (`approved`).
pub fn network_allowed(program: &str, args: &[String], approved: bool) -> bool {
    let first = args.first().map(|s| s.as_str()).unwrap_or("");
    let legacy = match program {
        "npm" => approved && matches!(first, "install" | "i" | "ci" | "add"),
        "pip" | "pip3" => approved && first == "install",
        "python" | "python3" => approved && first == "-m" && args.get(1).map(|s| s == "pip").unwrap_or(false),
        "cargo" => matches!(first, "build" | "b" | "check" | "c" | "test" | "t" | "fetch" | "update" | "tree"),
        "git" => matches!(first, "clone" | "fetch" | "pull" | "ls-remote" | "submodule"),
        _ => false,
    };
    // Règles de commands.json : téléchargements sans installation (build…), et
    // installations seulement après l'accord de l'utilisateur.
    legacy
        || crate::tool_runner::needs_network(program, args)
        || (approved && crate::tool_runner::is_install(program, args))
}

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
    // SDK Flutter absent : chemin inexistant, la règle ne donne alors accès à rien.
    let flutter = flutter_sdk().unwrap_or_else(|| PathBuf::from("/nonexistent/flutter-sdk"));
    let s = |p: PathBuf| p.to_string_lossy().into_owned();
    vec![
        ("ROOT", s(root.to_path_buf())),
        ("GITDIR", s(git.clone())),
        ("ROOT_HOOKS", s(root.join(".git").join("hooks"))),
        ("ROOT_GITCONFIG", s(root.join(".git").join("config"))),
        ("GIT_HOOKS", s(git.join("hooks"))),
        ("GIT_CONFIG", s(git.join("config"))),
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
        ("SSH", s(home.join(".ssh"))),
        ("AWS", s(home.join(".aws"))),
        ("GNUPG", s(home.join(".gnupg"))),
        ("KUBE", s(home.join(".kube"))),
        ("NETRC", s(home.join(".netrc"))),
        ("GITCRED", s(home.join(".git-credentials"))),
    ]
}

/// L'isolation est-elle disponible sur cet ordinateur ?
pub fn available() -> bool {
    cfg!(target_os = "macos") && Path::new("/usr/bin/sandbox-exec").exists()
}

/// Enveloppe une commande dans le sandbox (macOS). `root` doit être canonicalisé.
pub fn wrap(program: &str, args: &[String], root: &Path, allow_network: bool) -> Wrapped {
    if !available() {
        return Wrapped { program: program.to_string(), args: args.to_vec() };
    }
    let home = dirs::home_dir()
        .and_then(|h| std::fs::canonicalize(h).ok())
        .unwrap_or_else(|| PathBuf::from("/var/empty"));
    let tmp = std::fs::canonicalize(std::env::temp_dir()).unwrap_or_else(|_| PathBuf::from("/private/tmp"));
    let profile = if allow_network { PROFILE.to_string() } else { format!("{PROFILE}{NETWORK_RULES}") };
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

    #[test]
    fn network_only_for_downloads() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(!network_allowed("npm", &a(&["run", "build"]), false));
        assert!(!network_allowed("npm", &a(&["install"]), false));
        assert!(network_allowed("npm", &a(&["install", "react"]), true));
        assert!(!network_allowed("node", &a(&["script.js"]), true));
        assert!(!network_allowed("cargo", &a(&["run"]), false));
        assert!(network_allowed("cargo", &a(&["build"]), false));
        assert!(network_allowed("git", &a(&["pull"]), false));
        assert!(!network_allowed("git", &a(&["status"]), false));
        assert!(NETWORK_RULES.contains("localhost:*"));
        // Règles de commands.json
        assert!(!network_allowed("flutter", &a(&["pub", "get"]), false));
        assert!(network_allowed("flutter", &a(&["pub", "get"]), true));
        assert!(network_allowed("flutter", &a(&["build", "apk"]), false));
        assert!(!network_allowed("flutter", &a(&["format", "."]), false));
        assert!(network_allowed("gradlew", &a(&["assembleDebug"]), false));
        assert!(network_allowed("go", &a(&["build", "./..."]), false));
        assert!(!network_allowed("go", &a(&["get", "x"]), false));
        assert!(network_allowed("go", &a(&["get", "x"]), true));
        assert!(!network_allowed("jq", &a(&["."]), true));
    }

    #[test]
    fn plain_repo_uses_dot_git() {
        let root = PathBuf::from("/nonexistent/projet");
        assert_eq!(git_common_dir(&root), root.join(".git"));
    }

    #[test]
    fn params_cover_every_profile_placeholder() {
        let params = profile_params(Path::new("/p"), Path::new("/h"), Path::new("/t"));
        for (k, _) in &params {
            assert!(PROFILE.contains(&format!("(param \"{k}\")")), "paramètre inutilisé : {k}");
        }
        let names: Vec<&str> = params.iter().map(|(k, _)| *k).collect();
        for cap in PROFILE.split("(param \"").skip(1) {
            let name = cap.split('"').next().unwrap();
            assert!(names.contains(&name), "paramètre manquant : {name}");
        }
    }
}
