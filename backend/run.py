"""
Script pour lancer le serveur backend ANZAR en dev.
En production (Railway), le Procfile lance uvicorn directement.
"""

import uvicorn
from config import settings

if __name__ == "__main__":
    print(f"""
╔════════════════════════════════════════════════════════════════╗
║              ANZAR Backend — AI Proxy + Agents                 ║
║                       Version {settings.app_version:<10}                      ║
╚════════════════════════════════════════════════════════════════╝

Configuration:
  - Serveur:     {settings.server_host}:{settings.effective_port}
  - DeepSeek:    {'✓' if settings.deepseek_api_key else '✗'} {settings.deepseek_base_url}
  - Kimi:        {'✓' if settings.kimi_api_key else '✗'} {settings.kimi_base_url}
  - Database:    {settings.database_path}
  - JWT Secret:  {'✓ custom' if settings.is_production else '⚠ default (dev only)'}
  - Debug:       {settings.debug}

Démarrage...
""")

    uvicorn.run(
        "main:app",
        host=settings.server_host,
        port=settings.effective_port,
        reload=settings.debug,
        log_level=settings.log_level.lower(),
    )
