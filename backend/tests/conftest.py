"""
Fixtures pytest — backend ANZAR.

DB SQLite isolée par session (tmp), JWT secret de test, admin avec mot de
passe connu. Le TestClient est session-scoped : l'engine SQLAlchemy étant
global, créer une boucle d'event par test provoquerait des erreurs de pool.
"""
import os
import sys
import pathlib
import uuid

# Env de test AVANT tout import du backend (pydantic-settings lit l'env au chargement)
_TMP = os.environ.get("ANZAR_TEST_DB_DIR", "/tmp/anzar-tests")
pathlib.Path(_TMP).mkdir(parents=True, exist_ok=True)
os.environ["DATABASE_PATH"] = f"{_TMP}/test.db"
os.environ["DATABASE_URL"] = ""
os.environ["JWT_SECRET"] = "test-secret-0123456789abcdef0123456789abcdef"  # ≥ 32 chars
os.environ["ADMIN_DEFAULT_PASSWORD"] = "TestAdminPass1234"
os.environ["ADMIN_DEFAULT_EMAIL"] = "admin@test.local"
os.environ["DEBUG"] = "true"
os.environ["RATE_LIMIT_PER_MINUTE"] = "500"
os.environ["RATE_LIMIT_PER_DAY"] = "5000"
os.environ["BREVO_API_KEY"] = ""  # pas d'envoi d'email en test
os.environ["DEEPSEEK_API_KEY"] = ""

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Base neuve à chaque session de tests (sinon les utilisateurs des runs
# précédents provoquent des 409 sur /register)
_db_file = f"{_TMP}/test.db"
if os.path.exists(_db_file):
    os.remove(_db_file)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    """Client HTTP unique pour toute la session (lifespan complet : init_db, admin)."""
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    """Le rate limiter est en base — purge entre les tests pour l'isolation.

    Purge en sqlite3 synchrone direct (le fichier appartient à la boucle d'event
    du TestClient ; on n'y touche pas depuis une autre boucle).
    """
    import sqlite3

    def _purge():
        conn = sqlite3.connect(_db_file)
        try:
            conn.execute("DELETE FROM rate_limits")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # base pas encore créée
        finally:
            conn.close()

    _purge()
    from security import rate_limiter
    rate_limiter.reset()
    yield
    _purge()
    rate_limiter.reset()


@pytest.fixture()
def user_and_token(client):
    """Crée un utilisateur unique via /register → (email, token, headers)."""
    email = f"user-{uuid.uuid4().hex[:8]}@test.local"
    res = client.post("/api/auth/register", json={"email": email, "password": "password123"})
    assert res.status_code == 200, res.text
    token = res.json()["token"]
    return email, token, {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def admin_headers(client):
    """Login admin (cache session — la levée de must_change_password n'a lieu qu'une fois)."""
    res = client.post(
        "/api/admin/login",
        json={"email": "admin@test.local", "password": "TestAdminPass1234"},
    )
    assert res.status_code == 200, res.text
    headers = {"Authorization": f"Bearer {res.json()['token']}"}
    # L'admin par défaut est créé avec must_change_password=True → on le lève
    # immédiatement pour débloquer les autres endpoints admin.
    if res.json()["user"].get("must_change_password"):
        res = client.post(
            "/api/admin/change-password",
            headers=headers,
            json={"current_password": "TestAdminPass1234", "new_password": "TestAdminPass1234x"},
        )
        assert res.status_code == 200, res.text
        # Le changement de mot de passe incrémente token_version : l'ancien
        # jeton est désormais révoqué, on en redemande un.
        res = client.post(
            "/api/admin/login",
            json={"email": "admin@test.local", "password": "TestAdminPass1234x"},
        )
        assert res.status_code == 200, res.text
        headers = {"Authorization": f"Bearer {res.json()['token']}"}
    return headers
