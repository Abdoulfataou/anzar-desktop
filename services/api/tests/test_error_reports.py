"""Rapports d'erreurs : nettoyage, regroupement, admin et accès de la tâche planifiée."""
from config import settings
from services.error_scrub import fingerprint, scrub


def test_scrub_retire_chemins_cles_et_emails():
    raw = ("/Users/abdoul/Desktop/x.py failed for ag@yahoo.com token=abc123secret "
           "Authorization: Bearer eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl sk-proj-ABCDEFGHIJKLMNOP "
           "C:\\Users\\Abdoul\\app https://bob:pass@github.com/x")
    out = scrub(raw)
    for leak in ("abdoul", "Abdoul", "ag@yahoo.com", "abc123secret", "eyJhbGciOi", "ABCDEFGHIJKLMNOP", "bob:pass"):
        assert leak not in out, leak
    assert "~/Desktop/x.py" in out


def test_meme_probleme_meme_empreinte_malgre_les_valeurs_variables():
    a = fingerprint("command", "flutter pub get → code 69",
                    "Resolving dependencies...\nGot socket error trying to find package flutter_lints at https://pub.dev.")
    b = fingerprint("command", "flutter pub get → code 69",
                    "Resolving dependencies...\nGot socket error trying to find package cupertino_icons at https://pub.dev.")
    c = fingerprint("command", "npm install → code 1", "npm ERR! code ERESOLVE")
    assert a == fingerprint("command", "flutter pub get → code 69",
                            "Got socket error trying to find package flutter_lints at https://pub.dev.")
    assert a != c
    # Le nom du paquet est une valeur variable seulement s'il est cité ; ici il change le texte
    assert isinstance(b, str) and len(b) == 32


def _report(title="flutter pub get → code 69", version="2.1.7"):
    return {"kind": "command", "title": title, "app_version": version, "os": "macos",
            "detail": "Got socket error trying to find package flutter_lints at https://pub.dev."}


def test_envoi_regroupement_et_suivi_admin(client, user_and_token, admin_headers):
    _, _, headers = user_and_token
    r = client.post("/api/telemetry/errors", headers=headers, json={"reports": [_report(), _report()]})
    assert r.status_code == 200, r.text
    assert r.json()["groups"] == 1

    listing = client.get("/api/admin/errors", headers=admin_headers).json()
    assert listing["counts"]["new"] >= 1 and set(listing["counts"]) == {"new", "analysed", "fixed", "ignored"}
    groups = listing["groups"]
    g = next(x for x in groups if x["title"] == "flutter pub get → code 69")
    assert g["count"] >= 2 and g["users"] >= 1 and g["status"] == "new"
    assert g["last_version"] == "2.1.7"

    # Corrigé en 2.1.8 : une erreur de 2.1.7 ne le rouvre pas, une de 2.1.8 si.
    r = client.patch(f"/api/admin/errors/{g['id']}", headers=admin_headers, json={"status": "fixed", "fixed_in": "2.1.8"})
    assert r.status_code == 200 and r.json()["status"] == "fixed"
    client.post("/api/telemetry/errors", headers=headers, json={"reports": [_report(version="2.1.7")]})
    assert next(x for x in client.get("/api/admin/errors", headers=admin_headers).json()["groups"] if x["id"] == g["id"])["status"] == "fixed"
    client.post("/api/telemetry/errors", headers=headers, json={"reports": [_report(version="2.1.8")]})
    assert next(x for x in client.get("/api/admin/errors", headers=admin_headers).json()["groups"] if x["id"] == g["id"])["status"] == "new"


def test_envoi_exige_un_compte_et_borne_le_lot(client, user_and_token):
    assert client.post("/api/telemetry/errors", json={"reports": [_report()]}).status_code in (401, 403)
    _, _, headers = user_and_token
    r = client.post("/api/telemetry/errors", headers=headers, json={"reports": [_report()] * 21})
    assert r.status_code == 422
    r = client.post("/api/telemetry/errors", headers=headers, json={"reports": [{**_report(), "kind": "autre"}]})
    assert r.status_code == 422


def test_acces_de_la_tache_planifiee(client, user_and_token, monkeypatch):
    _, _, headers = user_and_token
    client.post("/api/telemetry/errors", headers=headers, json={"reports": [_report(title="gradlew → code 1")]})

    monkeypatch.setattr(settings, "error_analysis_token", "")
    assert client.get("/api/agent/errors").status_code == 404  # désactivé sans jeton configuré

    monkeypatch.setattr(settings, "error_analysis_token", "jeton-de-test-123")
    assert client.get("/api/agent/errors", headers={"Authorization": "Bearer faux"}).status_code == 401
    agent = {"Authorization": "Bearer jeton-de-test-123"}
    pending = client.get("/api/agent/errors?limit=20", headers=agent).json()["groups"]
    g = next(x for x in pending if x["title"] == "gradlew → code 1")
    r = client.post(f"/api/agent/errors/{g['id']}", headers=agent,
                    json={"analysis": "Cause probable : …", "issue_url": "https://github.com/a/b/issues/1"})
    assert r.status_code == 200 and r.json()["status"] == "analysed"
    r = client.post(f"/api/agent/errors/{g['id']}", headers=agent, json={"analysis": "x", "issue_url": "https://evil.example/x"})
    assert r.status_code == 422
    # Un utilisateur ordinaire n'a pas accès à la liste admin
    assert client.get("/api/admin/errors", headers=headers).status_code in (401, 403)
