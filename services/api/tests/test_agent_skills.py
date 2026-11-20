"""Skills servies par le serveur : réservées aux comptes connectés, ETag, contenu valide."""
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
    assert {"design-interface", "motion-design", "visuels-reseaux"} <= names
    for s in data["skills"]:
        assert s["description"] and s["markdown"].startswith("---")
    etag = r.headers["etag"]
    again = client.get("/api/agent/skills", headers={**h, "If-None-Match": etag})
    assert again.status_code == 304


def test_load_skills_is_stable():
    a, e1 = load_skills()
    b, e2 = load_skills()
    assert e1 == e2 and [s["name"] for s in a] == [s["name"] for s in b]


def test_has_images():
    assert has_images([{"role": "user", "content": [{"type": "text", "text": "x"},
                                                    {"type": "image_url", "image_url": {"url": "data:"}}]}])
    assert not has_images([{"role": "user", "content": "texte"}, {"role": "tool", "content": "ok"}])
