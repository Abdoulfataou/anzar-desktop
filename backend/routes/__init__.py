"""
ANZAR Backend — Route modules.
Each module exposes an APIRouter that main.py includes.
"""
from fastapi import FastAPI

from routes.auth import router as auth_router
from routes.user import router as user_router
from routes.credits import router as credits_router
from routes.chat import router as chat_router
from routes.projects import router as projects_router
from routes.admin import router as admin_router
from routes.memory import router as memory_router
from routes.skills import router as skills_router


def include_routers(app: FastAPI) -> None:
    """Register all route modules on the FastAPI app."""
    app.include_router(auth_router)
    app.include_router(user_router)
    app.include_router(credits_router)
    app.include_router(chat_router)
    app.include_router(projects_router)
    app.include_router(admin_router)
    app.include_router(memory_router)
    app.include_router(skills_router)
