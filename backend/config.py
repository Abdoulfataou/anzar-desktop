"""
Configuration sécurisée pour le backend ANZAR.
Les clés API sont stockées UNIQUEMENT ici côté serveur.
Compatible Railway (PORT dynamique), Docker, et local.
"""
import os
from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings from environment variables."""

    # ─── API Keys (SERVER ONLY — never sent to client) ───
    deepseek_api_key: str = ""
    kimi_api_key: str = ""
    serper_api_key: str = ""  # Google Search via Serper (2500 free, then $0.30/1000)

    # ─── API Base URLs ───
    deepseek_base_url: str = "https://api.deepseek.com"
    kimi_base_url: str = "https://api.moonshot.cn"

    # ─── Server ───
    server_host: str = "0.0.0.0"
    server_port: int = 8000
    # Railway injecte PORT automatiquement — on le lit en priorité
    port: int = 0  # Railway dynamic port

    @property
    def effective_port(self) -> int:
        """Railway sets PORT env var. Use it if available, otherwise server_port."""
        return self.port if self.port > 0 else self.server_port

    # ─── Email (Brevo SMTP API) ───
    brevo_api_key: str = ""
    sender_email: str = "noreply@anzar.app"
    sender_name: str = "ANZAR"
    otp_expiry_minutes: int = 10
    otp_max_attempts: int = 5  # Max wrong codes before lockout
    # Secret used to hash OTPs at rest (recommended to set in production).
    # If empty, we fallback to jwt_secret.
    otp_secret: str = ""

    # ─── Security ───
    jwt_secret: str = "CHANGE-ME-IN-PRODUCTION-use-openssl-rand-hex-32"
    jwt_expiry_hours: int = 72  # Token valid for 3 days
    cors_origins: str = "http://localhost:1420,http://localhost:5173,tauri://localhost,https://endearing-exploration-production.up.railway.app"
    rate_limit_per_minute: int = 30
    rate_limit_per_day: int = 500

    # ─── Database ───
    # DATABASE_URL (recommandé en prod Postgres). Exemple Railway: postgres://...
    database_url: str = ""
    database_path: str = "./data/anzar.db"

    @property
    def effective_database_url(self) -> str:
        """
        Use DATABASE_URL if provided (Postgres on Railway), otherwise fallback to sqlite file.
        Normalizes postgres:// to SQLAlchemy async format.
        """
        url = (self.database_url or "").strip()
        if url:
            if url.startswith("postgres://"):
                return "postgresql+asyncpg://" + url[len("postgres://"):]
            if url.startswith("postgresql://") and "+asyncpg" not in url:
                return "postgresql+asyncpg://" + url[len("postgresql://"):]
            return url
        # sqlite fallback (local dev)
        path = self.database_path
        # Ensure we have 3 slashes for relative file path
        if path.startswith("./"):
            return f"sqlite+aiosqlite:///{path[2:]}"
        if path.startswith("/"):
            return f"sqlite+aiosqlite:///{path}"
        return f"sqlite+aiosqlite:///{path}"

    # ─── Models (defaults) ───
    deepseek_model: str = "deepseek-chat"
    deepseek_reasoner: str = "deepseek-reasoner"
    kimi_model: str = "moonshot-v1-8k"

    # ─── Pricing — PRIX DE VENTE (FCFA par 1M tokens, facturés aux utilisateurs) ───
    # DeepSeek V4-Flash: coût réel $0.14/$0.28 → 78/157 F. Vente: marge x3.2
    deepseek_input_cost_per_million: float = 250.0
    deepseek_output_cost_per_million: float = 500.0
    # Kimi K2.5: coût réel $0.60/$2.50 → 336/1400 F. Vente: marge x3
    kimi_input_cost_per_million: float = 1000.0
    kimi_output_cost_per_million: float = 4000.0
    # USD to FCFA exchange rate (avril 2026)
    usd_to_fcfa: float = 560.0

    # ─── Recharge Packs & Bonus ───
    # Bonus progressif appliqué automatiquement selon le montant rechargé
    # Format: [(seuil_min_fcfa, bonus_pourcentage), ...]
    # Ex: recharge 5000 F → +15% = 5750 F crédités
    recharge_bonus_tiers: str = "5000:15,15000:25,50000:35"

    # ─── Growth / Freemium ───
    # Bonus de bienvenue crédité à la création de compte (en FCFA)
    welcome_bonus_fcfa: float = 1000.0
    # Quota gratuit quotidien (quand solde = 0) — nombre de requêtes chat (fenêtre 24h)
    free_daily_chat_requests: int = 10

    # Aliases used by deepseek_client.py
    @property
    def chat_model(self) -> str:
        return self.deepseek_model

    @property
    def reasoner_model(self) -> str:
        return self.deepseek_reasoner

    @property
    def is_production(self) -> bool:
        """True if JWT secret has been changed from the default."""
        return self.jwt_secret != "CHANGE-ME-IN-PRODUCTION-use-openssl-rand-hex-32"

    def get_recharge_bonus_percent(self, amount_fcfa: float) -> int:
        """Return the bonus percentage for a given recharge amount.

        Parses recharge_bonus_tiers (e.g. '5000:15,15000:25,50000:35').
        Returns the highest matching tier's bonus, or 0 if below all thresholds.
        """
        bonus = 0
        try:
            for tier in self.recharge_bonus_tiers.split(","):
                tier = tier.strip()
                if not tier:
                    continue
                threshold, pct = tier.split(":")
                if amount_fcfa >= float(threshold):
                    bonus = int(pct)
        except (ValueError, AttributeError):
            return 0
        return bonus

    @property
    def effective_otp_secret(self) -> str:
        """OTP secret used for hashing OTP codes at rest."""
        return self.otp_secret or self.jwt_secret

    # ─── Admin Panel ───
    admin_default_email: str = "admin@anzar.app"
    admin_default_password: str = "Anzar2024!"
    admin_jwt_expiry_hours: int = 24

    # ─── App ───
    app_version: str = "1.3.0"
    log_level: str = "info"
    debug: bool = False

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()

# Ensure data directory exists (only for sqlite fallback)
if settings.effective_database_url.startswith("sqlite"):
    Path(settings.database_path).parent.mkdir(parents=True, exist_ok=True)
