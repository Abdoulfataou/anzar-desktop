"""
STUDENT ASSISTANT routes — /api/student/*
Write, correct, research, plagiarism, flashcards, translate, exercises, projects CRUD.
"""
import json
import uuid
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from config import settings
from security import rate_limiter, get_client_ip, get_current_user, calculate_cost_fcfa
from database import (
    has_credits, deduct_credits, record_usage,
    create_student_project, get_student_project, get_user_student_projects,
    update_student_project, delete_student_project,
)
from agents import StudentWriterAgent, StudentCorrectorAgent, StudentResearcherAgent
from services.student_plagiarism import PlagiarismService
from services.student_flashcards import FlashcardService
from services.student_translator import AcademicTranslatorService
from services.student_exercises import ExerciseGeneratorService

logger = logging.getLogger("anzar")
security = HTTPBearer()

router = APIRouter(prefix="/api/student", tags=["student"])


# ── Models ──

class StudentWriteRequest(BaseModel):
    document_type: str = Field(..., description="memoire|rapport|expose|plan")
    user_prompt: str = Field(..., min_length=1)
    project_id: Optional[str] = None
    context: Optional[dict] = None
    messages: Optional[list] = None


class StudentCorrectRequest(BaseModel):
    text: str = Field(..., min_length=10)
    correction_type: str = Field(default="tout", description="langue|reformulation|academique|tout")
    level: Optional[str] = None


class StudentResearchRequest(BaseModel):
    query: str = Field(..., min_length=5)
    depth: str = Field(default="detailed", description="basic|detailed|exhaustive")
    citation_style: str = Field(default="apa", description="apa|mla|chicago|harvard")
    language: str = Field(default="fr")


class StudentPlagiarismRequest(BaseModel):
    text: str = Field(..., min_length=50)
    sensitivity: str = Field(default="medium", description="low|medium|high")


class StudentFlashcardsRequest(BaseModel):
    content: Optional[str] = None
    topic: Optional[str] = None
    level: str = Field(default="university")
    count: int = Field(default=20, ge=5, le=50)
    difficulty: str = Field(default="medium")


class StudentTranslateRequest(BaseModel):
    text: str = Field(..., min_length=10)
    source_lang: str = Field(default="fr", description="fr|en|ar")
    target_lang: str = Field(default="en", description="fr|en|ar")
    domain: str = Field(default="general")


class StudentExercisesRequest(BaseModel):
    subject: Optional[str] = None
    content: Optional[str] = None
    level: str = Field(default="L3")
    exercise_types: list = Field(default=["qcm", "vrai_faux", "reponse_courte"])
    count: int = Field(default=10, ge=3, le=30)
    difficulty: str = Field(default="medium")


# ── Projects CRUD ──

@router.get("/projects")
async def list_student_projects(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    user = await get_current_user(credentials)
    projects = await get_user_student_projects(user["email"])
    return {"projects": projects}


@router.get("/projects/{project_id}")
async def get_student_project_detail(
    project_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    user = await get_current_user(credentials)
    project = await get_student_project(project_id)
    if not project or project["user_email"] != user["email"]:
        raise HTTPException(404, "Projet non trouve")
    return project


@router.delete("/projects/{project_id}")
async def delete_student_project_route(
    project_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    user = await get_current_user(credentials)
    project = await get_student_project(project_id)
    if not project or project["user_email"] != user["email"]:
        raise HTTPException(404, "Projet non trouve")
    await delete_student_project(project_id)
    return {"ok": True}


# ── Agent: Academic Writer ──

@router.post("/write")
async def student_write(
    body: StudentWriteRequest,
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    user = await get_current_user(credentials)
    email = user["email"]
    client_ip = get_client_ip(request)
    await rate_limiter(client_ip, "student_write", 20, 60)

    if not await has_credits(email):
        raise HTTPException(402, "Credits insuffisants")

    agent = StudentWriterAgent()

    project_id = body.project_id or uuid.uuid4().hex
    existing = await get_student_project(project_id)
    if not existing:
        await create_student_project(
            user_email=email,
            project_id=project_id,
            project_type=body.document_type,
            title=body.user_prompt[:200],
        )

    context = body.context or {}
    if existing:
        context.setdefault("subject", existing.get("subject", ""))
        context.setdefault("outline", json.dumps(existing.get("outline", {})))
        context.setdefault("sections_done", existing.get("sections", []))

    result = await agent.execute({
        "user_prompt": body.user_prompt,
        "document_type": body.document_type,
        "context": context,
        "messages": body.messages or [],
    })

    await update_student_project(
        project_id,
        content=result.get("content", ""),
        outline=result.get("outline", {}),
        sections=result.get("sections", []),
        tokens_used=(existing or {}).get("tokens_used", 0) + result.get("tokens_used", 0),
        status="in_progress",
        subject=result.get("metadata", {}).get("subject", ""),
        level=result.get("metadata", {}).get("level", ""),
    )

    tokens = result.get("tokens_used", 500)
    cost_usd, cost_fcfa = calculate_cost_fcfa("deepseek", tokens, tokens // 2)
    await deduct_credits(email, cost_fcfa, "Student: redaction", "deepseek", settings.deepseek_model)
    await record_usage(email, "deepseek", settings.deepseek_model, tokens, tokens // 2, cost_usd, cost_fcfa, 0, "student_write")

    result["project_id"] = project_id
    return result


# ── Agent: Smart Corrector ──

@router.post("/correct")
async def student_correct(
    body: StudentCorrectRequest,
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    user = await get_current_user(credentials)
    email = user["email"]
    client_ip = get_client_ip(request)
    await rate_limiter(client_ip, "student_correct", 20, 60)

    if not await has_credits(email):
        raise HTTPException(402, "Credits insuffisants")

    agent = StudentCorrectorAgent()
    result = await agent.execute({
        "text": body.text,
        "correction_type": body.correction_type,
        "level": body.level or "",
        "messages": [],
    })

    tokens = result.get("tokens_used", 300)
    cost_usd, cost_fcfa = calculate_cost_fcfa("deepseek", tokens, tokens // 2)
    await deduct_credits(email, cost_fcfa, "Student: correction", "deepseek", settings.deepseek_model)
    await record_usage(email, "deepseek", settings.deepseek_model, tokens, tokens // 2, cost_usd, cost_fcfa, 0, "student_correct")

    return result


# ── Agent: Documentary Researcher ──

@router.post("/research")
async def student_research(
    body: StudentResearchRequest,
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    user = await get_current_user(credentials)
    email = user["email"]
    client_ip = get_client_ip(request)
    await rate_limiter(client_ip, "student_research", 15, 60)

    if not await has_credits(email):
        raise HTTPException(402, "Credits insuffisants")

    agent = StudentResearcherAgent()
    result = await agent.execute({
        "query": body.query,
        "depth": body.depth,
        "citation_style": body.citation_style,
        "language": body.language,
        "messages": [],
    })

    tokens = result.get("tokens_used", 500)
    cost_usd, cost_fcfa = calculate_cost_fcfa("deepseek", tokens, tokens // 2)
    await deduct_credits(email, cost_fcfa, "Student: recherche", "deepseek", settings.deepseek_model)
    await record_usage(email, "deepseek", settings.deepseek_model, tokens, tokens // 2, cost_usd, cost_fcfa, 0, "student_research")

    return result


# ── Skill: Anti-Plagiarism ──

@router.post("/plagiarism")
async def student_plagiarism(
    body: StudentPlagiarismRequest,
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    user = await get_current_user(credentials)
    email = user["email"]
    client_ip = get_client_ip(request)
    await rate_limiter(client_ip, "student_plagiarism", 10, 60)

    if not await has_credits(email):
        raise HTTPException(402, "Credits insuffisants")

    service = PlagiarismService()
    result = await service.analyze(body.text, body.sensitivity)

    in_tok, out_tok = len(body.text) // 4, 500
    cost_usd, cost_fcfa = calculate_cost_fcfa("deepseek", in_tok, out_tok)
    await deduct_credits(email, cost_fcfa, "Student: anti-plagiat", "deepseek", settings.deepseek_model)
    await record_usage(email, "deepseek", settings.deepseek_model, in_tok, out_tok, cost_usd, cost_fcfa, 0, "student_plagiarism")

    return result


# ── Skill: Flashcards ──

@router.post("/flashcards")
async def student_flashcards(
    body: StudentFlashcardsRequest,
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    user = await get_current_user(credentials)
    email = user["email"]
    client_ip = get_client_ip(request)
    await rate_limiter(client_ip, "student_flashcards", 15, 60)

    if not await has_credits(email):
        raise HTTPException(402, "Credits insuffisants")

    service = FlashcardService()
    if body.content:
        result = await service.generate(body.content, body.count, body.difficulty)
    elif body.topic:
        result = await service.generate_from_topic(body.topic, body.level, body.count)
    else:
        raise HTTPException(400, "Fournis 'content' ou 'topic'")

    cost_usd, cost_fcfa = calculate_cost_fcfa("deepseek", 500, 1000)
    await deduct_credits(email, cost_fcfa, "Student: flashcards", "deepseek", settings.deepseek_model)
    await record_usage(email, "deepseek", settings.deepseek_model, 500, 1000, cost_usd, cost_fcfa, 0, "student_flashcards")

    return result


# ── Skill: Academic Translator ──

@router.post("/translate")
async def student_translate(
    body: StudentTranslateRequest,
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    user = await get_current_user(credentials)
    email = user["email"]
    client_ip = get_client_ip(request)
    await rate_limiter(client_ip, "student_translate", 20, 60)

    if not await has_credits(email):
        raise HTTPException(402, "Credits insuffisants")

    if body.source_lang == body.target_lang:
        raise HTTPException(400, "Langues source et cible identiques")

    service = AcademicTranslatorService()
    result = await service.translate(body.text, body.source_lang, body.target_lang, body.domain)

    in_tok, out_tok = len(body.text) // 4, len(body.text) // 3
    cost_usd, cost_fcfa = calculate_cost_fcfa("deepseek", in_tok, out_tok)
    await deduct_credits(email, cost_fcfa, "Student: traduction", "deepseek", settings.deepseek_model)
    await record_usage(email, "deepseek", settings.deepseek_model, in_tok, out_tok, cost_usd, cost_fcfa, 0, "student_translate")

    return result


# ── Skill: Exercise Generator ──

@router.post("/exercises")
async def student_exercises(
    body: StudentExercisesRequest,
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    user = await get_current_user(credentials)
    email = user["email"]
    client_ip = get_client_ip(request)
    await rate_limiter(client_ip, "student_exercises", 15, 60)

    if not await has_credits(email):
        raise HTTPException(402, "Credits insuffisants")

    service = ExerciseGeneratorService()
    if body.content:
        result = await service.generate_from_content(body.content, body.exercise_types, body.count)
    elif body.subject:
        result = await service.generate(body.subject, body.level, body.exercise_types, body.count, body.difficulty)
    else:
        raise HTTPException(400, "Fournis 'subject' ou 'content'")

    cost_usd, cost_fcfa = calculate_cost_fcfa("deepseek", 500, 1500)
    await deduct_credits(email, cost_fcfa, "Student: exercices", "deepseek", settings.deepseek_model)
    await record_usage(email, "deepseek", settings.deepseek_model, 500, 1500, cost_usd, cost_fcfa, 0, "student_exercises")

    return result
