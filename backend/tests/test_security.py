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


# ── Coût exact : usage réel du fournisseur, cache DeepSeek ──

def test_usage_tokens_reads_deepseek_cache():
    from security import usage_tokens
    assert usage_tokens({"prompt_tokens": 1000, "completion_tokens": 200, "prompt_cache_hit_tokens": 800}) == (1000, 200, 800)
    assert usage_tokens({"prompt_tokens": 100, "completion_tokens": 5, "prompt_tokens_details": {"cached_tokens": 40}}) == (100, 5, 40)
    assert usage_tokens(None) == (0, 0, 0)
    # Un cache supérieur à l'entrée est borné
    assert usage_tokens({"prompt_tokens": 10, "prompt_cache_hit_tokens": 50})[2] == 10


def test_cache_hit_tokens_billed_at_reduced_ratio():
    from config import settings
    from security import calculate_cost_fcfa
    _, full = calculate_cost_fcfa("deepseek", 1_000_000, 0, model="deepseek-chat")
    _, cached = calculate_cost_fcfa("deepseek", 1_000_000, 0, model="deepseek-chat", cached_input_tokens=1_000_000)
    assert full == settings.deepseek_input_cost_per_million
    assert cached == round(settings.deepseek_input_cost_per_million * settings.deepseek_cache_hit_ratio, 2)


def test_pro_model_uses_pro_pricing():
    from config import settings
    from security import calculate_cost_fcfa
    _, cost = calculate_cost_fcfa("deepseek", 0, 1_000_000, model="deepseek-v4-pro")
    assert cost == settings.deepseek_pro_output_cost_per_million
