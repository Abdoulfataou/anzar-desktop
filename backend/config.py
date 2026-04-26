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

    # ─── Security ───
    jwt_secret: str = "CHANGE-ME-IN-PRODUCTION-use-openssl-rand-hex-32"
    jwt_expiry_hours: int = 72  # Token valid for 3 days
    cors_origins: str = "http://localhost:1420,http://localhost:5173,tauri://localhost"
    rate_limit_per_minute: int = 30
    rate_limit_per_day: int = 500

    # ─── Database ───
    database_path: str = "./data/anzar.db"

    # ─── Models (defaults) ───
    deepseek_model: str = "deepseek-chat"
    deepseek_reasoner: str = "deepseek-reasoner"
    kimi_model: str = "moonshot-v1-8k"

    # ─── Pricing (FCFA per 1M tokens) ───
    # DeepSeek V3: $0.27 input / $1.10 output → ~166 FCFA / ~677 FCFA per 1M tokens
    deepseek_input_cost_per_million: float = 166.0
    deepseek_output_cost_per_million: float = 677.0
    # Kimi (Moonshot): $1.00 input / $2.00 output → ~615 FCFA / ~1230 FCFA per 1M tokens
    kimi_input_cost_per_million: float = 615.0
    kimi_output_cost_per_million: float = 1230.0
    # USD to FCFA exchange rate
    usd_to_fcfa: float = 615.0

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

# Ensure data directory exists
Path(settings.database_path).parent.mkdir(parents=True, exist_ok=True)
