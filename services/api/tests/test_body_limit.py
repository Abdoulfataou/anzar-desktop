"""Le plafond de corps doit refuser avant que la route ne lise la requête (P0 audit)."""
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from body_limit import BodyLimitMiddleware


def build_app(limit: int = 16):
    app = FastAPI()
    app.add_middleware(BodyLimitMiddleware, max_bytes=limit)

    @app.post("/echo")
    async def echo(request: Request):
        raw = await request.body()
        return {"len": len(raw)}

    return app


def test_rejects_oversized_declared_body():
    client = TestClient(build_app(limit=16))
    response = client.post("/echo", content=b"x" * 17)
    assert response.status_code == 413
    assert "trop volumineuse" in response.json()["detail"]


def test_accepts_body_under_the_limit():
    client = TestClient(build_app(limit=16))
    response = client.post("/echo", content=b"x" * 16)
    assert response.status_code == 200
    assert response.json() == {"len": 16}
