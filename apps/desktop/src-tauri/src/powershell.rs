//! PowerShell : le shell de l'agent sous Windows (l'équivalent de `bash -c` sur macOS).
//!
//! La ligne de l'agent est passée en `-EncodedCommand` (UTF-16LE en base64) : aucune règle
//! de guillemets de la ligne de commande Windows ne peut la déformer. Un court prélude
//! force la sortie en UTF-8 et coupe les barres de progression ; un épilogue rend le code
//! de sortie du dernier programme, comme bash (sinon PowerShell rend 0 ou 1 seulement).
//!
//! Tant que Windows n'a pas d'isolation des commandes, `tool_spawn` ne lance PowerShell
//! qu'en Accès complet ou après l'accord de l'utilisateur pour cette commande.

// Hors Windows, seuls la limite de taille et les tests s'en servent.
#![cfg_attr(not(windows), allow(dead_code))]

/// Taille maximale d'une commande : une fois encodée, elle doit tenir dans la ligne de
/// commande Windows (32 767 caractères), prélude compris.
pub const MAX_COMMAND_CHARS: usize = 10_000;

/// Script complet exécuté par PowerShell : prélude, commande de l'agent, code de sortie.
pub fn script(command: &str) -> String {
    format!(
        "$ProgressPreference = 'SilentlyContinue'\n\
         [Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n\
         $OutputEncoding = [System.Text.Encoding]::UTF8\n\
         {command}\n\
         $__anzarOk = $?; $__anzarCode = $LASTEXITCODE\n\
         if ($null -ne $__anzarCode -and $__anzarCode -ne 0) {{ exit $__anzarCode }}\n\
         if (-not $__anzarOk) {{ exit 1 }}\n\
         exit 0\n"
    )
}

/// Arguments de l'interpréteur : sans profil, sans question, sortie texte.
pub fn args(command: &str) -> Vec<String> {
    vec![
        "-NoLogo".into(),
        "-NoProfile".into(),
        "-NonInteractive".into(),
        "-ExecutionPolicy".into(),
        "Bypass".into(),
        "-OutputFormat".into(),
        "Text".into(),
        "-EncodedCommand".into(),
        encode(&script(command)),
    ]
}

/// Format attendu par `-EncodedCommand` : UTF-16 petit-boutiste, puis base64.
pub fn encode(text: &str) -> String {
    let bytes: Vec<u8> = text.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    base64(&bytes)
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Interpréteur à utiliser : PowerShell 7 (`pwsh`) s'il est installé, sinon Windows
/// PowerShell 5.1, présent sur tous les Windows 10 et 11.
#[cfg(windows)]
pub fn interpreter(path: &str) -> Option<std::path::PathBuf> {
    if let Some(p) = crate::tool_runner::resolve_with_exts("pwsh", path, &[".exe"]) {
        return Some(p);
    }
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let builtin = std::path::Path::new(&root).join("System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    if builtin.is_file() {
        return Some(builtin);
    }
    crate::tool_runner::resolve_with_exts("powershell", path, &[".exe"])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_reference_values() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn encoded_command_is_utf16le_base64() {
        // Valeur donnée par [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('dir'))
        assert_eq!(encode("dir"), "ZABpAHIA");
        // Les accents passent sans déformation (é = U+00E9 → E9 00).
        assert_eq!(encode("é"), "6QA=");
    }

    #[test]
    fn script_keeps_the_command_and_returns_its_exit_code() {
        let s = script("npm test; echo \"fini\"");
        assert!(s.contains("\nnpm test; echo \"fini\"\n"));
        assert!(s.starts_with("$ProgressPreference = 'SilentlyContinue'"));
        assert!(s.contains("exit $__anzarCode"));
        assert!(s.trim_end().ends_with("exit 0"));
    }

    #[test]
    fn args_never_load_a_profile_or_wait_for_input() {
        let a = args("Get-ChildItem");
        for flag in ["-NoProfile", "-NonInteractive", "-NoLogo", "-EncodedCommand"] {
            assert!(a.iter().any(|x| x == flag), "{flag} manquant");
        }
        assert_eq!(a.last().unwrap(), &encode(&script("Get-ChildItem")));
    }

    /// Vraie exécution, sur les runners Windows de la CI (job « Desktop Rust (Windows) »).
    #[cfg(windows)]
    fn run(command: &str) -> (i32, String, String) {
        let interp = interpreter(&std::env::var("PATH").unwrap_or_default()).expect("PowerShell introuvable");
        let out = std::process::Command::new(interp).args(args(command)).output().unwrap();
        (
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stdout).into_owned(),
            String::from_utf8_lossy(&out.stderr).into_owned(),
        )
    }

    #[cfg(windows)]
    #[test]
    fn real_powershell_returns_the_last_program_exit_code() {
        let (code, stdout, _) = run("Write-Output 'début'; cmd /c exit 3");
        assert_eq!(code, 3);
        assert!(stdout.contains("début"), "sortie : {stdout}");
        let (code, _, _) = run("cmd /c exit 0");
        assert_eq!(code, 0);
    }

    #[cfg(windows)]
    #[test]
    fn real_powershell_reports_cmdlet_errors_and_keeps_utf8() {
        let (code, _, stderr) = run("Get-Item 'C:\\nexiste\\pas-du-tout'");
        assert_eq!(code, 1, "stderr : {stderr}");
        let (code, stdout, _) = run("$x = 'é à ç ✓'; Write-Output $x");
        assert_eq!(code, 0);
        assert!(stdout.contains("é à ç ✓"), "sortie : {stdout}");
    }

    #[cfg(windows)]
    #[test]
    fn real_powershell_never_waits_for_input() {
        // Read-Host sans console : erreur immédiate (-NonInteractive), jamais d'attente.
        let start = std::time::Instant::now();
        let (code, _, _) = run("Read-Host 'question'");
        assert_ne!(code, 0);
        assert!(start.elapsed() < std::time::Duration::from_secs(30));
    }

    #[test]
    fn longest_command_fits_the_windows_command_line() {
        let longest = "x".repeat(MAX_COMMAND_CHARS);
        let line: usize = args(&longest).iter().map(|a| a.len() + 1).sum();
        assert!(line + 200 < 32_767, "ligne de commande trop longue : {line}");
    }
}
