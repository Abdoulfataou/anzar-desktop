"""Réduction de surface : Skills Hub communautaire désactivé, webhooks bornés."""
from routes.payments import MAX_WEBHOOK_BYTES


def test_community_skills_hub_is_disabled(client):
    assert client.get("/api/skills/hub").status_code == 404


def test_webhook_body_is_capped_before_processing(client):
    r = client.post("/api/payments/webhook/inconnu", content=b"x" * (MAX_WEBHOOK_BYTES + 1))
    assert r.status_code == 413
