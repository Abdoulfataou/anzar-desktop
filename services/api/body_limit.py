"""
Plafond de taille des requêtes HTTP.

Le proxy IA lisait `request.json()` avant toute réservation : un compte sans crédit pouvait
envoyer un corps de plusieurs centaines de Mo et faire tomber l'API (un seul process, 1 Go de
RAM). Le plafond est appliqué par un middleware ASGI, avant que la route ne lise le corps :
- refus immédiat quand `Content-Length` dépasse la limite ;
- compteur sur le flux réel, pour les corps sans longueur déclarée (chunked).

8 Mio par défaut : une demande de l'agent peut joindre plusieurs captures d'écran encodées en
base64 ; en dessous, on casserait des tours légitimes.
"""
from __future__ import annotations

import json
import os

MAX_REQUEST_BYTES = int(os.getenv("MAX_REQUEST_BYTES", str(8 * 1024 * 1024)))

_BODY = json.dumps(
    {"detail": "Requête trop volumineuse. Réduis les pièces jointes ou découpe la demande."},
    ensure_ascii=False,
).encode("utf-8")

_HEADERS = [
    (b"content-type", b"application/json; charset=utf-8"),
    (b"content-length", str(len(_BODY)).encode()),
    (b"connection", b"close"),
]


class BodyTooLarge(Exception):
    """Le flux dépasse le plafond (corps sans Content-Length)."""


class BodyLimitMiddleware:
    def __init__(self, app, max_bytes: int = MAX_REQUEST_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Refus immédiat si la longueur est annoncée.
        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    if int(value) > self.max_bytes:
                        await self._too_large(send)
                        return
                except ValueError:
                    pass

        total = 0
        started = False

        async def send_wrapper(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        async def receive_limited():
            nonlocal total
            message = await receive()
            if message["type"] == "http.request":
                total += len(message.get("body", b""))
                if total > self.max_bytes:
                    raise BodyTooLarge()
            return message

        try:
            await self.app(scope, receive_limited, send_wrapper)
        except BodyTooLarge:
            # La route n'a pas encore répondu : on renvoie un 413 propre.
            if not started:
                await self._too_large(send)

    @staticmethod
    async def _too_large(send) -> None:
        await send({"type": "http.response.start", "status": 413, "headers": _HEADERS})
        await send({"type": "http.response.body", "body": _BODY})
