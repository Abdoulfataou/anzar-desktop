//! Isolation des commandes de l'agent (macOS : Seatbelt via `sandbox-exec`).
//!
//! Une commande lancée par l'agent ne peut écrire que dans le dossier du projet, le
//! dossier git du dépôt (worktrees des tickets), les dossiers temporaires et les caches
//! des outils (npm, cargo…). Les hooks et la config git restent en lecture seule, et
//! les dossiers de secrets (~/.ssh, ~/.aws, ~/.gnupg, ~/.kube, ~/.netrc,
//! ~/.git-credentials) sont illisibles. Le réseau n'est pas restreint (serveurs de dev).
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
pub fn wrap(program: &str, args: &[String], root: &Path) -> Wrapped {
    if !available() {
        return Wrapped { program: program.to_string(), args: args.to_vec() };
    }
    let home = dirs::home_dir()
        .and_then(|h| std::fs::canonicalize(h).ok())
        .unwrap_or_else(|| PathBuf::from("/var/empty"));
    let tmp = std::fs::canonicalize(std::env::temp_dir()).unwrap_or_else(|_| PathBuf::from("/private/tmp"));
    let mut out = vec!["-p".to_string(), PROFILE.to_string()];
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
