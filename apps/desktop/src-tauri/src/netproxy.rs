//! Proxy réseau local avec liste d'hôtes autorisés.
//!
//! Les commandes de l'agent reçoivent `HTTP_PROXY`/`HTTPS_PROXY` pointant vers ce proxy.
//! Sur macOS, le profil Seatbelt ne laisse alors sortir que vers localhost : le proxy est le
//! seul chemin vers l'extérieur, et il refuse tout hôte absent de la liste. Sur Windows et
//! Linux, la même liste s'applique mais n'est qu'une barrière coopérative (variables
//! d'environnement) — voir `docs/desktop/SECURITY.md`.
//!
//! Le proxy parle HTTP/1.1 : `CONNECT host:port` (HTTPS, tunnel brut) et requêtes en forme
//! absolue (`GET http://host/...`). Les requêtes en forme origine sans `CONNECT` sont refusées.
//!
//! Module portable (std uniquement), sans dépendance à Tauri : testable hors application.

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock, RwLock};
use std::time::Duration;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const IO_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_HEAD_BYTES: usize = 16 * 1024;
const MAX_RECORDS: usize = 200;

/// Hôtes autorisés par défaut : gestionnaires de paquets, registres et GitHub.
pub const DEFAULT_HOSTS: &[&str] = &[
    "registry.npmjs.org",
    "registry.npmjs.com",
    "registry.yarnpkg.com",
    "pypi.org",
    "files.pythonhosted.org",
    "crates.io",
    "static.crates.io",
    "index.crates.io",
    "github.com",
    "api.github.com",
    "codeload.github.com",
    "objects.githubusercontent.com",
    "raw.githubusercontent.com",
    "nodejs.org",
    // Flutter / Dart (paquets pub, artefacts du moteur)
    "pub.dev",
    "pub.dartlang.org",
    "storage.googleapis.com",
    // Android / Gradle / Maven
    "maven.google.com",
    "dl.google.com",
    "repo.maven.apache.org",
    "repo1.maven.org",
    "plugins.gradle.org",
    "services.gradle.org",
    "downloads.gradle.org",
    // iOS (CocoaPods), Go, Ruby, PHP, .NET, Deno, Rust, Yarn 2+
    "cdn.cocoapods.org",
    "proxy.golang.org",
    "sum.golang.org",
    "rubygems.org",
    "repo.packagist.org",
    "api.nuget.org",
    "jsr.io",
    "deno.land",
    "static.rust-lang.org",
    "repo.yarnpkg.com",
];

#[derive(Clone, serde::Serialize)]
pub struct Record {
    pub seq: u64,
    pub host: String,
    pub allowed: bool,
    /// Hôte autorisé mais injoignable (erreur de connexion vers l'extérieur).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Marqueurs ajoutés à la sortie d'une commande (lus par l'interface pour réagir seule).
pub const TAG_UNREACHABLE: &str = "[ANZAR] Réseau injoignable";
pub const TAG_BYPASS: &str = "[ANZAR] Relais réseau ignoré";

/// Enregistrements depuis `since` (commande en cours).
pub fn records_since(since: u64) -> Vec<Record> {
    let Some(state) = STATE.get() else { return Vec::new() };
    let records = state.records.lock().unwrap();
    records.iter().filter(|r| r.seq > since).cloned().collect()
}

/// Sortie qui ressemble à un échec réseau (Node, Python, Dart/Flutter, Java, curl…).
pub fn looks_like_network_error(text: &str) -> bool {
    const SIGNES: &[&str] = &[
        "socket error", "socketexception", "failed host lookup", "enotfound", "eai_again",
        "getaddrinfo", "could not resolve", "network is unreachable", "connection refused",
        "econnrefused", "econnreset", "connection reset", "connection timed out", "etimedout",
        "temporary failure in name resolution", "nodename nor servname", "unknownhostexception",
        "connect eperm", "connection failed", "failed to connect", "unable to connect",
        "no route to host", "newconnectionerror", "fetch failed", "could not get resource",
    ];
    let t = text.to_lowercase();
    SIGNES.iter().any(|s| t.contains(s))
}

/// Diagnostic réseau d'une commande terminée en échec, d'après ce que le relais a vu.
/// - un hôte autorisé injoignable : problème de connexion (souvent passager) ;
/// - aucune requête reçue alors que la sortie parle de réseau : l'outil n'utilise pas le
///   relais (il ignore HTTPS_PROXY), et l'isolation coupe sa connexion directe.
///
/// Les hôtes refusés par la liste sont signalés à part (`blocked_hosts_since`).
pub fn diagnose(records: &[Record], proxied: bool, code: i32, output: &str) -> Option<String> {
    if code == 0 {
        return None;
    }
    let mut injoignables: Vec<String> = Vec::new();
    for r in records.iter().filter(|r| r.allowed && r.error.is_some()) {
        let ligne = format!("{} ({})", r.host, r.error.as_deref().unwrap_or(""));
        if !injoignables.contains(&ligne) {
            injoignables.push(ligne);
        }
    }
    if !injoignables.is_empty() {
        return Some(format!(
            "{TAG_UNREACHABLE} : {}. Connexion internet instable ou site indisponible.",
            injoignables.join(", ")
        ));
    }
    if proxied && records.is_empty() && looks_like_network_error(output) {
        return Some(format!(
            "{TAG_BYPASS} : l'outil n'est pas passé par le relais d'ANZAR, sa connexion directe a été coupée."
        ));
    }
    None
}

struct ProxyState {
    port: u16,
    extra: RwLock<Vec<String>>,
    records: Mutex<VecDeque<Record>>,
    seq: AtomicU64,
}

static STATE: OnceLock<ProxyState> = OnceLock::new();

/// Démarre le proxy (une seule fois) et renvoie son port local, ou None si le système refuse.
pub fn ensure() -> Option<u16> {
    let state = STATE.get_or_init(|| {
        let port = bind_port().unwrap_or(0);
        ProxyState {
            port,
            extra: RwLock::new(Vec::new()),
            records: Mutex::new(VecDeque::new()),
            seq: AtomicU64::new(0),
        }
    });
    if state.port == 0 {
        return None;
    }
    Some(state.port)
}

fn bind_port() -> Option<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).ok()?;
    let port = listener.local_addr().ok()?.port();
    std::thread::spawn(move || accept_loop(listener));
    Some(port)
}

/// Hôtes autorisés en plus des valeurs par défaut (réglage utilisateur).
pub fn set_extra_hosts(hosts: Vec<String>) {
    if let Some(state) = STATE.get() {
        let cleaned: Vec<String> = hosts
            .into_iter()
            .map(|h| normalize(&h))
            .filter(|h| !h.is_empty())
            .collect();
        *state.extra.write().unwrap() = cleaned;
    }
}

/// Numéro de séquence courant : à relever avant de lancer une commande.
pub fn blocked_seq() -> u64 {
    STATE.get().map(|s| s.seq.load(Ordering::SeqCst)).unwrap_or(0)
}

/// Hôtes refusés depuis `since` (dédoublonnés, ordre d'apparition).
pub fn blocked_hosts_since(since: u64) -> Vec<String> {
    let Some(state) = STATE.get() else { return Vec::new() };
    let records = state.records.lock().unwrap();
    let mut out: Vec<String> = Vec::new();
    for r in records.iter().filter(|r| r.seq > since && !r.allowed) {
        if !out.contains(&r.host) {
            out.push(r.host.clone());
        }
    }
    out
}

/// Tous les enregistrements récents (diagnostic).
pub fn recent_records() -> Vec<Record> {
    STATE
        .get()
        .map(|s| s.records.lock().unwrap().iter().cloned().collect())
        .unwrap_or_default()
}

pub(crate) fn normalize(host: &str) -> String {
    host.trim()
        .trim_end_matches('.')
        .to_ascii_lowercase()
        .trim_start_matches("*.")
        .to_string()
}

/// Un hôte est-il autorisé ? Localhost l'est toujours (serveurs de dev, tests).
pub fn host_allowed(host: &str) -> bool {
    let h = normalize(host);
    if h.is_empty() {
        return false;
    }
    if h == "localhost" || h == "127.0.0.1" || h == "::1" || h == "[::1]" {
        return true;
    }
    // Sous-domaine d'une entrée autorisée : `x.npmjs.org` si `npmjs.org` est listé.
    let matches = |pattern: &str| h == pattern || h.ends_with(&format!(".{pattern}"));
    if DEFAULT_HOSTS.iter().any(|p| matches(p)) {
        return true;
    }
    let extra = STATE
        .get()
        .map(|s| s.extra.read().unwrap().clone())
        .unwrap_or_default();
    extra.iter().any(|p| matches(p))
}

fn record(host: &str, allowed: bool) {
    record_full(host, allowed, None);
}

fn record_failed(host: &str, error: &std::io::Error) {
    record_full(host, true, Some(error.to_string()));
}

fn record_full(host: &str, allowed: bool, error: Option<String>) {
    let Some(state) = STATE.get() else { return };
    let seq = state.seq.fetch_add(1, Ordering::SeqCst) + 1;
    let mut records = state.records.lock().unwrap();
    records.push_back(Record { seq, host: normalize(host), allowed, error });
    while records.len() > MAX_RECORDS {
        records.pop_front();
    }
}

fn accept_loop(listener: TcpListener) {
    for stream in listener.incoming() {
        match stream {
            Ok(client) => {
                std::thread::spawn(move || handle(client));
            }
            Err(_) => break,
        }
    }
}

/// Analyse `host:port` (port par défaut fourni par l'appelant).
fn parse_authority(target: &str, default_port: u16) -> Option<(String, u16)> {
    let t = target.trim();
    if t.is_empty() {
        return None;
    }
    if let Some(rest) = t.strip_prefix('[') {
        let (host, tail) = rest.split_once(']')?;
        let port = tail
            .strip_prefix(':')
            .and_then(|p| p.parse().ok())
            .unwrap_or(default_port);
        return Some((host.to_string(), port));
    }
    match t.rsplit_once(':') {
        Some((host, port)) if port.chars().all(|c| c.is_ascii_digit()) => {
            Some((host.to_string(), port.parse().ok()?))
        }
        _ => Some((t.to_string(), default_port)),
    }
}

/// URL absolue (`http://host[:port]/chemin`) → hôte, port, forme origine.
fn parse_absolute(url: &str) -> Option<(String, u16, String)> {
    let (scheme, rest) = url.split_once("://")?;
    let default_port = if scheme.eq_ignore_ascii_case("https") { 443 } else { 80 };
    let (authority, path) = match rest.find(['/', '?']) {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let (host, port) = parse_authority(authority, default_port)?;
    let path = if path.starts_with('?') { format!("/{path}") } else { path.to_string() };
    Some((host, port, path))
}

fn respond(client: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = client.write_all(response.as_bytes());
    let _ = client.flush();
}

fn handle(mut client: TcpStream) {
    let _ = client.set_read_timeout(Some(IO_TIMEOUT));

    // En-tête de requête, borné.
    let mut head = Vec::new();
    let mut buf = [0u8; 2048];
    loop {
        match client.read(&mut buf) {
            Ok(0) => return,
            Ok(n) => {
                head.extend_from_slice(&buf[..n]);
                if head.windows(4).any(|w| w == b"\r\n\r\n") || head.len() > MAX_HEAD_BYTES {
                    break;
                }
            }
            Err(_) => return,
        }
    }
    let split = head
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|i| i + 4)
        .unwrap_or(head.len());
    let leftover = head[split..].to_vec();
    let head_text = String::from_utf8_lossy(&head[..split]).to_string();

    let mut lines = head_text.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    if method.is_empty() || target.is_empty() {
        respond(&mut client, "400 Bad Request", "Requête proxy invalide.\n");
        return;
    }

    if method.eq_ignore_ascii_case("CONNECT") {
        let Some((host, port)) = parse_authority(target, 443) else {
            respond(&mut client, "400 Bad Request", "Cible CONNECT invalide.\n");
            return;
        };
        if !host_allowed(&host) {
            record(&host, false);
            respond(
                &mut client,
                "403 Forbidden",
                &format!(
                    "[ANZAR] Hôte non autorisé : {host}\n\
                     Ajoute-le dans Paramètres → Réseau (hôtes autorisés) si c'est légitime.\n"
                ),
            );
            return;
        }
        match connect(&host, port) {
            Ok(upstream) => {
                record(&host, true);
                let _ = client.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n");
                tunnel(client, upstream, &leftover);
            }
            Err(e) => {
                record_failed(&host, &e);
                respond(&mut client, "502 Bad Gateway", &format!("Connexion impossible à {host}:{port} — {e}\n"))
            }
        }
        return;
    }

    let Some((host, port, path)) = parse_absolute(target) else {
        respond(&mut client, "400 Bad Request", "Utilise un proxy HTTP (URL absolue).\n");
        return;
    };
    if !host_allowed(&host) {
        record(&host, false);
        respond(
            &mut client,
            "403 Forbidden",
            &format!(
                "[ANZAR] Hôte non autorisé : {host}\n\
                 Ajoute-le dans Paramètres → Réseau (hôtes autorisés) si c'est légitime.\n"
            ),
        );
        return;
    }
    let mut upstream = match connect(&host, port) {
        Ok(s) => s,
        Err(e) => {
            record_failed(&host, &e);
            respond(&mut client, "502 Bad Gateway", &format!("Connexion impossible à {host}:{port}\n"));
            return;
        }
    };
    record(&host, true);
    // Requête réécrite en forme origine, en retirant les en-têtes propres au proxy.
    let mut out = format!("{method} {path} HTTP/1.1\r\n");
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("proxy-connection:") || lower.starts_with("proxy-authorization:") {
            continue;
        }
        out.push_str(line);
        out.push_str("\r\n");
    }
    out.push_str("\r\n");
    if upstream.write_all(out.as_bytes()).is_err() {
        return;
    }
    tunnel(client, upstream, &leftover);
}

fn connect(host: &str, port: u16) -> std::io::Result<TcpStream> {
    let addrs: Vec<_> = (host, port).to_socket_addrs()?.collect();
    let stream = connect_any(addrs, CONNECT_TIMEOUT)?;
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
    Ok(stream)
}

/// Essaie toutes les adresses en parallèle (IPv4 d'abord) et garde la première qui répond.
/// Avant, elles étaient essayées l'une après l'autre : une adresse IPv6 injoignable sans
/// réponse (réseau sans IPv6) bloquait chaque connexion 20 s, et les gestionnaires de
/// paquets aux délais courts (pub de Flutter) échouaient par intermittence.
fn connect_any(mut addrs: Vec<std::net::SocketAddr>, timeout: Duration) -> std::io::Result<TcpStream> {
    if addrs.is_empty() {
        return Err(std::io::Error::new(std::io::ErrorKind::NotFound, "aucune adresse"));
    }
    addrs.sort_by_key(|a| a.is_ipv6());
    let (tx, rx) = std::sync::mpsc::channel();
    let total = addrs.len();
    for (i, addr) in addrs.into_iter().enumerate() {
        let tx = tx.clone();
        std::thread::spawn(move || {
            // Petite avance donnée à IPv4 (« Happy Eyeballs ») sans bloquer IPv6.
            if addr.is_ipv6() && i > 0 {
                std::thread::sleep(Duration::from_millis(250));
            }
            let _ = tx.send(TcpStream::connect_timeout(&addr, timeout));
        });
    }
    drop(tx);
    let mut last = std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "aucune adresse joignable");
    for _ in 0..total {
        match rx.recv() {
            Ok(Ok(stream)) => return Ok(stream),
            Ok(Err(e)) => last = e,
            Err(_) => break,
        }
    }
    Err(last)
}

/// Copie bidirectionnelle jusqu'à fermeture d'un côté.
fn tunnel(client: TcpStream, upstream: TcpStream, leftover: &[u8]) {
    let mut up_writer = match upstream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    };
    if !leftover.is_empty() && up_writer.write_all(leftover).is_err() {
        return;
    }
    let mut up_reader = upstream;
    let mut client_reader = match client.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    };
    let mut client_writer = client;

    let downstream = std::thread::spawn(move || {
        let _ = std::io::copy(&mut up_reader, &mut client_writer);
        let _ = client_writer.shutdown(std::net::Shutdown::Write);
    });
    let _ = std::io::copy(&mut client_reader, &mut up_writer);
    let _ = up_writer.shutdown(std::net::Shutdown::Write);
    let _ = downstream.join();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn autorise_les_hotes_par_defaut_et_leurs_sous_domaines() {
        assert!(host_allowed("registry.npmjs.org"));
        assert!(host_allowed("cdn.registry.npmjs.org"));
        assert!(host_allowed("REGISTRY.NPMJS.ORG."));
        assert!(host_allowed("localhost"));
        assert!(host_allowed("127.0.0.1"));
        assert!(!host_allowed("exemple-malveillant.tld"));
        assert!(!host_allowed(""));
    }

    #[test]
    fn accepte_un_hote_ajoute_par_l_utilisateur() {
        let _ = ensure();
        set_extra_hosts(vec!["  API.Exemple.TLD ".into(), "*.interne.local".into()]);
        assert!(host_allowed("api.exemple.tld"));
        assert!(host_allowed("app.interne.local"));
        assert!(!host_allowed("exemple.tld"));
        set_extra_hosts(vec![]);
    }

    #[test]
    fn connexion_parallele_garde_la_premiere_adresse_joignable() {
        let ouvert = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let bon = ouvert.local_addr().unwrap();
        // Port fermé : refus immédiat ; l'adresse joignable doit l'emporter quel que soit l'ordre.
        let ferme = TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap();
        let s = connect_any(vec![ferme, bon], Duration::from_secs(2)).expect("connexion");
        assert_eq!(s.peer_addr().unwrap(), bon);
        assert!(connect_any(vec![ferme], Duration::from_secs(2)).is_err());
        assert!(connect_any(vec![], Duration::from_secs(2)).is_err());
    }

    #[test]
    fn diagnostique_les_echecs_reseau() {
        let r = |host: &str, allowed: bool, error: Option<&str>| Record {
            seq: 1, host: host.into(), allowed, error: error.map(String::from),
        };
        let dart = "Got socket error trying to find package flutter_lints at https://pub.dev.";
        // Succès : rien à dire
        assert_eq!(diagnose(&[], true, 0, dart), None);
        // Aucune requête au relais + erreur réseau : outil qui ignore le relais
        assert!(diagnose(&[], true, 69, dart).unwrap().starts_with(TAG_BYPASS));
        // Sans relais (réseau direct ou coupé), pas de conclusion « ignoré »
        assert_eq!(diagnose(&[], false, 69, dart), None);
        // Échec sans rapport avec le réseau
        assert_eq!(diagnose(&[], true, 1, "error: expected `;`"), None);
        // Le relais a vu passer la requête mais n'a pas pu joindre l'hôte
        let d = diagnose(&[r("pub.dev", true, Some("timed out"))], true, 69, dart).unwrap();
        assert!(d.starts_with(TAG_UNREACHABLE) && d.contains("pub.dev"));
        // Requête passée normalement : l'échec vient d'ailleurs
        assert_eq!(diagnose(&[r("pub.dev", true, None)], true, 69, dart), None);
        assert!(looks_like_network_error("SocketException: Failed host lookup: 'pub.dev'"));
        assert!(!looks_like_network_error("Operation not permitted: /etc/hosts"));
    }

    #[test]
    fn analyse_les_cibles() {
        assert_eq!(parse_authority("exemple.tld:8443", 443), Some(("exemple.tld".into(), 8443)));
        assert_eq!(parse_authority("exemple.tld", 443), Some(("exemple.tld".into(), 443)));
        assert_eq!(parse_authority("[::1]:5432", 80), Some(("::1".into(), 5432)));
        assert_eq!(parse_absolute("https://a.tld/x?y=1"), Some(("a.tld".into(), 443, "/x?y=1".into())));
        assert_eq!(parse_absolute("http://b.tld"), Some(("b.tld".into(), 80, "/".into())));
        assert!(parse_absolute("b.tld/x").is_none());
    }

    #[test]
    fn refuse_un_hote_absent_de_la_liste() {
        let port = ensure().expect("proxy démarré");
        let mut client = TcpStream::connect(("127.0.0.1", port)).expect("connexion au proxy");
        client
            .write_all(b"CONNECT exemple-malveillant.tld:443 HTTP/1.1\r\nHost: exemple-malveillant.tld:443\r\n\r\n")
            .expect("écriture");
        let mut response = String::new();
        let _ = client.read_to_string(&mut response);
        assert!(response.starts_with("HTTP/1.1 403"), "{response}");
        assert!(response.contains("[ANZAR] Hôte non autorisé : exemple-malveillant.tld"));
    }

    #[test]
    fn journalise_les_refus_pour_la_commande() {
        let port = ensure().expect("proxy démarré");
        let before = blocked_seq();
        let mut client = TcpStream::connect(("127.0.0.1", port)).expect("connexion");
        client
            .write_all(b"GET http://autre-malveillant.tld/x HTTP/1.1\r\nHost: autre-malveillant.tld\r\n\r\n")
            .expect("écriture");
        let mut response = String::new();
        let _ = client.read_to_string(&mut response);
        assert!(response.starts_with("HTTP/1.1 403"), "{response}");
        // Les tests tournent en parallèle et partagent le journal : on vérifie la présence.
        assert!(blocked_hosts_since(before).contains(&"autre-malveillant.tld".to_string()));
    }
}
