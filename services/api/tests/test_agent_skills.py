"""Skills servies par le serveur : réservées aux comptes connectés, ETag, contenu valide."""
import re

import routes.agent_skills as agent_skills
from routes.agent_skills import load_skills
from routes.chat import has_images


def test_skills_require_login(client):
    assert client.get("/api/agent/skills").status_code in (401, 403)


def test_skills_listed_with_etag(client, user_and_token):
    _, _, h = user_and_token
    r = client.get("/api/agent/skills", headers=h)
    assert r.status_code == 200
    data = r.json()
    names = {s["name"] for s in data["skills"]}
    assert {"design-interface", "motion-design", "visuels-reseaux", "diagrammes"} <= names
    for s in data["skills"]:
        assert s["description"] and s["markdown"].startswith("---")
        assert isinstance(s["files"], dict)
    etag = r.headers["etag"]
    again = client.get("/api/agent/skills", headers={**h, "If-None-Match": etag})
    assert again.status_code == 304


def test_load_skills_is_stable():
    a, e1 = load_skills()
    b, e2 = load_skills()
    assert e1 == e2 and [s["name"] for s in a] == [s["name"] for s in b]


def test_diagrammes_skill_files():
    """La skill diagrammes est servie avec ses fiches, sa licence, et chaque fiche citée existe."""
    skill = next(s for s in load_skills()[0] if s["name"] == "diagrammes")
    files = skill["files"]
    assert "references/style.md" in files and "LICENSE" in files
    assert "Cathryn Lavery" in files["LICENSE"] and "MIT License" in files["LICENSE"]
    cited = set(re.findall(r"`(references/[a-z-]+\.md)`", skill["markdown"]))
    assert len(cited) >= 10 and cited <= set(files)
    # Limites de l'app : corps du SKILL.md (20 000 caractères), fichiers joints (40 000, 60 au plus)
    body = skill["markdown"].split("---", 2)[2]
    assert len(body) < 20_000
    assert len(files) <= 60 and all(len(t) <= 40_000 for t in files.values())
    # Aucune police ni ressource chargée sur le réseau dans le modèle de départ
    assert "fonts.googleapis" not in skill["markdown"] and "<link" not in skill["markdown"]


def test_etag_changes_with_attached_file(tmp_path, monkeypatch):
    """Modifier une fiche jointe change l'ETag (l'app retélécharge) ; les fichiers cachés et binaires sont ignorés."""
    d = tmp_path / "essai"
    (d / "references").mkdir(parents=True)
    (d / "SKILL.md").write_text("---\nname: essai\ndescription: Une skill d'essai\n---\nCorps", encoding="utf-8")
    (d / "references" / "fiche.md").write_text("version 1", encoding="utf-8")
    (d / ".cache.md").write_text("caché", encoding="utf-8")
    (d / "image.png").write_bytes(b"\x89PNG")
    monkeypatch.setattr(agent_skills, "SKILLS_DIR", tmp_path)
    monkeypatch.setattr(agent_skills, "_cache", None)
    skills, e1 = load_skills()
    assert skills[0]["files"] == {"references/fiche.md": "version 1"}
    (d / "references" / "fiche.md").write_text("version 2, plus longue", encoding="utf-8")
    skills, e2 = load_skills()
    assert e1 != e2 and skills[0]["files"]["references/fiche.md"].startswith("version 2")


def test_has_images():
    assert has_images([{"role": "user", "content": [{"type": "text", "text": "x"},
                                                    {"type": "image_url", "image_url": {"url": "data:"}}]}])
    assert not has_images([{"role": "user", "content": "texte"}, {"role": "tool", "content": "ok"}])
