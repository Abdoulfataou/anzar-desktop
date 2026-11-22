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
    serper_api_key: str = ""  # Google Search via Serper (2500 free, then $0.30/1000)

    # ─── API Base URLs ───
    deepseek_base_url: str = "https://api.deepseek.com"


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
    jwt_expiry_hours: int = 24  # Court : le client refresh toutes les 6h
    refresh_grace_days: int = 7  # Un jeton expiré peut encore être rafraîchi pendant cette fenêtre
    refresh_max_age_days: int = 30  # Durée de vie absolue d'une session, même si elle est rafraîchie
    cors_origins: str = "http://localhost:1420,http://localhost:5173,tauri://localhost,https://tauri.localhost,https://anzar-admin.issalanhub.com"
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
    # DeepSeek : deepseek-flash (V4.1-Flash), 1M de contexte, réflexion réglable par requête.
    # deepseek-chat / deepseek-reasoner / deepseek-v4-flash sont retirés (convertis côté proxy).
    deepseek_model: str = "deepseek-flash"
    deepseek_pro_model: str = "deepseek-v4-pro"  # Pour projets complexes (optionnel)
    deepseek_reasoner: str = "deepseek-flash"  # la réflexion se règle par paramètre

    # ─── Pricing DeepSeek — COÛT RÉEL (USD par 1M tokens, tarif HEURES PLEINES) ───
    # Source : api-docs.deepseek.com/quick_start/pricing (novembre 2026).
    # Heures creuses = ce tarif × deepseek_offpeak_factor. Prix de vente = coût × deepseek_margin.
    deepseek_flash_hit_usd: float = 0.006    # entrée servie par le cache
    deepseek_flash_miss_usd: float = 0.30    # entrée hors cache
    deepseek_flash_output_usd: float = 1.20
    deepseek_pro_hit_usd: float = 0.044
    deepseek_pro_miss_usd: float = 1.32
    deepseek_pro_output_usd: float = 3.96
    deepseek_offpeak_factor: float = 0.5
    # Heures pleines DeepSeek (UTC, lundi→vendredi) : 01:00–04:00 et 06:00–10:00
    deepseek_peak_windows_utc: str = "1-4,6-10"
    # Marge appliquée au coût réel pour le prix de vente
    deepseek_margin: float = 3.0
    # Search / Fetch DeepSeek : 0,75 $ les 1 000 appels réussis
    deepseek_web_tool_usd_per_call: float = 0.00075
    # USD to FCFA exchange rate (avril 2026)
    usd_to_fcfa: float = 560.0

    # ─── Recharge Packs & Bonus ───
    # Bonus progressif appliqué automatiquement selon le montant rechargé
    # Format: [(seuil_min_fcfa, bonus_pourcentage), ...]
    # Ex: recharge 5000 F → +15% = 5750 F crédités
    recharge_bonus_tiers: str = "5000:15,15000:25,50000:35"

    # ─── Accès payant uniquement ───
    # Bonus de bienvenue à la création de compte (FCFA). 0 : personne n'utilise l'IA sans crédit
    # (un bonus > 0 permettrait de créer des comptes jetables pour consommer gratuitement).
    welcome_bonus_fcfa: float = 0.0
    # Requêtes IA simultanées max par utilisateur (chaque requête réserve son coût maximal).
    # Plafond **par processus** : le compteur est local (les réservations, elles, sont en
    # base). Avec N workers, la limite effective par utilisateur est N × cette valeur.
    # À garder en tête en montant le nombre de workers.
    max_concurrent_ai_per_user: int = 4
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

    # ─── Paiements automatiques ───
    # URL publique de l'API (retour après paiement, webhooks déclarés chez les fournisseurs)
    public_api_url: str = "https://anzar-api.issalanhub.com"
    # Demandes « manuelles » (validées par un admin) : restent possibles en secours
    manual_payments_enabled: bool = True
    # FedaPay — mobile money Afrique de l'Ouest (Niger, Bénin, Côte d'Ivoire, Sénégal, Togo, Mali, Guinée)
    fedapay_secret_key: str = ""          # sk_sandbox_… ou sk_live_…
    fedapay_environment: str = "sandbox"  # sandbox | live
    fedapay_webhook_secret: str = ""      # wh_sandbox_… ou wh_live_…
    # Stripe — cartes du monde entier (compte de la LLC américaine)
    stripe_secret_key: str = ""           # sk_test_… ou sk_live_…
    stripe_webhook_secret: str = ""       # whsec_…
    stripe_currency: str = "usd"          # usd | eur | xof
    # FCFA pour 1 unité de la devise Stripe. 0 = valeur par défaut (usd 600, eur 655.957 fixe, xof 1)
    stripe_fcfa_per_unit: float = 0.0

    @property
    def effective_stripe_rate(self) -> float:
        if self.stripe_fcfa_per_unit and self.stripe_fcfa_per_unit > 0:
            return float(self.stripe_fcfa_per_unit)
        cur = (self.stripe_currency or "usd").lower()
        return {"eur": 655.957, "xof": 1.0}.get(cur, 600.0)

    # ─── Admin Panel ───
    admin_default_email: str = "admin@anzar.app"
    admin_default_password: str = ""  # Fourni via ADMIN_DEFAULT_PASSWORD (env) uniquement
    admin_jwt_expiry_hours: int = 24
    admin_require_mfa: bool = False  # Passer à true après enrôlement des admins
    admin_mfa_key: str = ""          # Clé indépendante de JWT_SECRET pour chiffrer les secrets TOTP
    admin_allowed_ips: str = ""     # Ex. "203.0.113.0/24,10.0.0.0/8" ; vide = pas de restriction
    enable_community_skills: bool = False  # Hub communautaire inutilisé par le desktop

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
