"""
Service d'envoi d'emails via l'API Brevo (ex-Sendinblue).
Utilise l'API HTTP v3 — pas besoin de dépendance SMTP.
httpx est déjà dans requirements.txt.
"""
import logging
from typing import Optional

import httpx

from config import settings

logger = logging.getLogger("anzar.email")

BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"


async def send_otp_email(to_email: str, code: str, user_name: str = "") -> bool:
    """
    Envoie un code de vérification par email via Brevo.

    Args:
        to_email: Adresse email du destinataire
        code: Code OTP 6 chiffres
        user_name: Nom de l'utilisateur (optionnel)

    Returns:
        True si l'email a été envoyé, False sinon
    """
    if not settings.brevo_api_key:
        logger.error("BREVO_API_KEY non configurée — impossible d'envoyer l'email")
        return False

    display_name = user_name or to_email.split("@")[0]

    payload = {
        "sender": {
            "name": settings.sender_name,
            "email": settings.sender_email,
        },
        "to": [
            {"email": to_email, "name": display_name}
        ],
        "subject": f"ANZAR — Votre code de connexion : {code}",
        "htmlContent": _build_otp_html(code, display_name),
        "textContent": f"Votre code de connexion ANZAR est : {code}\n\nCe code expire dans {settings.otp_expiry_minutes} minutes.\n\nSi vous n'avez pas demandé ce code, ignorez ce message.",
    }

    headers = {
        "api-key": settings.brevo_api_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(BREVO_API_URL, json=payload, headers=headers)

        if response.status_code in (200, 201):
            logger.info(f"OTP email envoyé à {to_email}")
            return True
        else:
            logger.error(f"Brevo error {response.status_code}: {response.text[:300]}")
            return False

    except httpx.TimeoutException:
        logger.error(f"Brevo timeout pour {to_email}")
        return False
    except Exception as e:
        logger.error(f"Erreur envoi email: {e}")
        return False


def _build_otp_html(code: str, name: str) -> str:
    """Construit le HTML de l'email OTP — design propre et responsive."""
    return f"""<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0f0f13;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f13;padding:40px 20px;">
<tr><td align="center">
<table width="100%" style="max-width:460px;background-color:#1a1a24;border-radius:16px;overflow:hidden;border:1px solid #2a2a3a;">

  <!-- Header with logo -->
  <tr><td style="padding:32px 32px 20px;text-align:center;">
    <table cellpadding="0" cellspacing="0" style="display:inline-block;">
    <tr><td style="width:52px;height:52px;background-color:#141432;border-radius:13px;border:1px solid #2a2a5a;text-align:center;vertical-align:middle;">
      <span style="font-size:28px;font-weight:900;color:#ffffff;font-family:Arial,sans-serif;letter-spacing:-1px;">A</span>
    </td></tr>
    </table>
    <h1 style="margin:14px 0 0;font-size:22px;font-weight:700;color:#f0f0f5;letter-spacing:2px;">ANZAR</h1>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:0 32px 12px;">
    <p style="color:#a0a0b8;font-size:15px;line-height:1.6;margin:0;">
      Salut <strong style="color:#f0f0f5;">{name}</strong>,
    </p>
    <p style="color:#a0a0b8;font-size:15px;line-height:1.6;margin:12px 0 0;">
      Voici ton code de connexion :
    </p>
  </td></tr>

  <!-- Code -->
  <tr><td style="padding:8px 32px 20px;text-align:center;">
    <div style="display:inline-block;background:#0f0f13;border:2px solid #6366f1;border-radius:12px;padding:16px 40px;letter-spacing:12px;font-size:32px;font-weight:800;color:#f0f0f5;font-family:'Courier New',monospace;">
      {code}
    </div>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:0 32px 32px;">
    <p style="color:#6b6b80;font-size:13px;line-height:1.5;margin:0;">
      Ce code expire dans <strong>{settings.otp_expiry_minutes} minutes</strong>.<br>
      Si tu n'as pas demandé ce code, ignore ce message.
    </p>
  </td></tr>

  <!-- Bottom bar -->
  <tr><td style="background:#14141e;padding:16px 32px;text-align:center;border-top:1px solid #2a2a3a;">
    <p style="color:#4a4a5c;font-size:11px;margin:0;">
      ANZAR — Vibecoding &amp; Data Analysis pour l'Afrique
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>"""
