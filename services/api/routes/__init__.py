"""
ANZAR Backend — Route modules.
Each module exposes an APIRouter that main.py includes.
"""
from fastapi import FastAPI

from routes.auth import router as auth_router
from routes.user import router as user_router
from routes.credits import router as credits_router
from routes.payments import router as payments_router
from routes.pricing import router as pricing_router
from routes.agent_skills import router as agent_skills_router
from routes.chat import router as chat_router
from routes.admin import router as admin_router
from routes.memory import router as memory_router
from routes.skills import router as skills_router
from routes.web_tools import router as web_tools_router


def include_routers(app: FastAPI) -> None:
    """Register all route modules on the FastAPI app."""
    app.include_router(auth_router)
    app.include_router(user_router)
    app.include_router(credits_router)
    app.include_router(payments_router)
    app.include_router(pricing_router)
    app.include_router(agent_skills_router)
    app.include_router(chat_router)
    app.include_router(admin_router)
    app.include_router(memory_router)
    from config import settings
    if settings.enable_community_skills:
        app.include_router(skills_router)
    app.include_router(web_tools_router)
