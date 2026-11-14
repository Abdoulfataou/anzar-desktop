"""Tests unitaires security.py — JWT pyjwt (alg épinglé, audience, grâce refresh)."""
import time

import jwt as pyjwt

from security import create_token, verify_token


def _secret():
    from config import settings

    return settings.jwt_secret


def test_create_verify_roundtrip():
    t = create_token(user_id="u@test.local", extra_claims={"is_admin": False})
    p = verify_token(t)
    assert p is not None
    assert p["sub"] == "u@test.local"
    assert p["aud"] == "anzar-api"
    assert len(p["jti"]) == 32  # 16 bytes hex


def test_wrong_secret_rejected():
    forged = pyjwt.encode(
        {"sub": "x", "exp": time.time() + 3600, "aud": "anzar-api"},
        "wrong-secret", algorithm="HS256",
    )
    assert verify_token(forged) is None


def test_alg_none_rejected():
    forged = pyjwt.encode(
        {"sub": "x", "exp": time.time() + 3600, "aud": "anzar-api"},
        key=None, algorithm="none",
    )
    assert verify_token(forged) is None


def test_wrong_audience_rejected():
    forged = pyjwt.encode(
        {"sub": "x", "exp": time.time() + 3600, "aud": "other-api"},
        _secret(), algorithm="HS256",
    )
    assert verify_token(forged) is None


def test_expired_rejected_but_grace_window_allows_decode():
    t = create_token(user_id="u", expires_in=-10)
    assert verify_token(t) is None                     # expiré → refusé
    p = verify_token(t, verify_exp=False)              # grâce refresh → signature OK
    assert p is not None and p["sub"] == "u"


def test_legacy_homebrew_format_rejected():
    assert verify_token("eyJmb28iOiJiYXIifQ.deadbeef") is None
