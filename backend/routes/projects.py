"""
PROJECTS routes — /api/projects/*
Plan, execute, status, download-files, CRUD, cancel.
"""
import json
import re
import uuid
import asyncio
import logging

from typing import Dict, Any, Optional

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field

from config import settings
from security import get_current_user, calculate_cost_fcfa
from database import (
    has_credits, deduct_credits, record_usage,
    create_project, update_project, get_project, get_user_projects, delete_project,
    get_memory_as_profile,
)
from agents import PlannerAgent, CoderAgent, CodeReviewAgent, VisionAgent
from routes._state import (
    _project_states, _cleanup_project_states, _deepseek_client,
)

logger = logging.getLogger("anzar")

router = APIRouter(prefix="/api/projects", tags=["projects"])


# ── Patch parser — applies <<<PATCH ... >>> blocks from AI response ──

def _apply_patches(response_text: str, current_files: Dict[str, str]) -> Dict[str, str]:
    """Parse <<<PATCH ... >>> blocks from AI response and apply them to current files.
    Returns dict of {filepath: new_content} for modified files.
    Returns empty dict if no patches found (caller falls back to code block extraction).
    """
    patch_pattern = re.compile(
        r'<<<PATCH\s*\n'
        r'FILE:\s*(.+?)\s*\n'
        r'SEARCH:\s*\n(.*?)\n'
        r'REPLACE:\s*\n(.*?)\n'
        r'>>>',
        re.DOTALL,
    )
    patches = list(patch_pattern.finditer(response_text))
    if not patches:
        return {}

    patches_by_file: Dict[str, list] = {}
    for m in patches:
        filepath = m.group(1).strip()
        search = m.group(2)
        replace = m.group(3)
        patches_by_file.setdefault(filepath, []).append((search, replace))

    modified: Dict[str, str] = {}
    for filepath, file_patches in patches_by_file.items():
        content = current_files.get(filepath, "")
        if not content:
            logger.warning(f"Patch target not found: {filepath}")
            continue
        for search, replace in file_patches:
            if search in content:
                content = content.replace(search, replace, 1)
            else:
                s = search.strip()
                if s and s in content:
                    content = content.replace(s, replace.strip(), 1)
                else:
                    logger.warning(f"Patch SEARCH not found in {filepath}")
        modified[filepath] = content
    return modified


# ── Models ──

class PlanRequest(BaseModel):
    description: str = Field(..., min_length=1, max_length=10000)
    project_name: str = Field(default="my_project", max_length=128)
    project_type: str = Field(default="other", max_length=50)
    tech_stack: list[str] = Field(default_factory=list)
    requirements: list[str] = Field(default_factory=list)


class ExecuteRequest(BaseModel):
    plan: Dict[str, Any] = Field(...)
    base_dir: Optional[str] = None


class IterateHistoryMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., max_length=5000)

class IterateRequest(BaseModel):
    """Request to modify existing project files via chat iteration."""
    message: str = Field(..., min_length=1, max_length=10000)
    files: Dict[str, str] = Field(default_factory=dict, description="Current files: {path: content}")
    file_focus: Optional[str] = Field(None, description="Specific file to modify")
    history: list[IterateHistoryMessage] = Field(default_factory=list, description="Previous iteration messages for context continuity")
    mode: str = Field("iterate", description="Agent mode: iterate|patch|refactor|debug|test|review")


# ── Routes ──

@router.post("/plan")
async def plan_project(body: PlanRequest, user: dict = Depends(get_current_user)):
    """Plan a project using PlannerAgent."""
    email = user["sub"]

    if not await has_credits(email):
        raise HTTPException(402, "Solde épuisé. Rechargez pour continuer.")

    try:
        # Load developer memory profile for personalized planning
        memory_profile = await get_memory_as_profile(email)

        planner = PlannerAgent(deepseek_client=_deepseek_client)
        planner_result = await planner.execute({
            "project_name": body.project_name,
            "description": body.description,
            "project_type": body.project_type or "other",
            "tech_stack": body.tech_stack or [],
            "requirements": body.requirements or [],
            "user_memory": memory_profile,
        })

        if planner_result.get("status") == "error":
            raise HTTPException(500, planner_result.get("error", "Erreur de planification"))

        # Create project in DB
        project_id = f"proj_{uuid.uuid4().hex[:12]}"
        await create_project(project_id, email, body.project_name, body.description)
        await update_project(project_id, status="planning", plan_json=json.dumps(planner_result))

        # Build response (compatible with frontend PlanResult type)
        result = {
            "project_id": project_id,
            "title": planner_result.get("title", body.project_name),
            "overview": planner_result.get("overview", body.description),
            "files": planner_result.get("files", []),
            "phases": planner_result.get("phases", []),
            "complexity": planner_result.get("complexity", "medium"),
            "notes": planner_result.get("notes", ""),
            "architecture": planner_result.get("architecture", {}),
            "tokens_used": planner_result.get("tokens_used", 0),
        }

        # Billing
        total_tokens = result["tokens_used"]
        if total_tokens > 0:
            plan_model = planner.model_used or settings.deepseek_pro_model
            cost_usd, cost_fcfa = calculate_cost_fcfa("deepseek", total_tokens // 2, total_tokens // 2, model=plan_model)
            try:
                await record_usage(email, "deepseek", plan_model, total_tokens // 2, total_tokens // 2, cost_usd, cost_fcfa, task_type="plan")
                if cost_fcfa > 0:
                    await deduct_credits(email, cost_fcfa, f"Plan: {body.project_name}", "deepseek", plan_model)
            except Exception as e:
                logger.error(f"Plan billing error: {e}")

        return JSONResponse(content=result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Plan project error: {e}", exc_info=True)
        raise HTTPException(500, f"Erreur lors de la planification: {str(e)[:200]}")


@router.post("/{project_id}/execute")
async def execute_project(project_id: str, body: ExecuteRequest, user: dict = Depends(get_current_user)):
    """Execute a project plan. Runs generation as a background task, returns SSE observer stream."""
    email = user["sub"]
    plan = body.plan

    if not await has_credits(email):
        raise HTTPException(402, "Solde épuisé. Rechargez pour continuer.")

    # ── Validate plan has files to generate ──
    architecture = plan.get("architecture", plan)
    files_spec = architecture.get("structure", {}).get("files", [])
    if not files_spec:
        files_spec = plan.get("files", [])
    if not files_spec:
        raise HTTPException(400, "Plan invalide: aucun fichier à générer. Relancez la planification.")

    # Load developer memory profile for personalized code generation
    memory_profile = await get_memory_as_profile(email)

    await update_project(project_id, status="generating")
    _cleanup_project_states()

    _project_states[project_id] = {
        "status": "running",
        "agents": [
            {"name": "planner", "status": "done", "progress": 100, "message": "Plan pret"},
            {"name": "coder", "status": "pending", "progress": 0},
        ],
        "steps_queue": [],
    }

    async def _run_generation():
        """Generate code batch by batch, streaming each file as soon as its batch completes.

        Key improvements over previous version:
        - Files appear in the SSE stream as each batch finishes (not all at once at the end)
        - Partial recovery: if batch N fails, files from batches 1..N-1 are kept
        - Progress updates are granular (per-batch percentage)
        """
        state = _project_states[project_id]
        total_tokens = 0

        def update_agent(name: str, s: str, progress: int, message: str = ""):
            for a in state["agents"]:
                if a["name"] == name:
                    a["status"] = s
                    a["progress"] = progress
                    if message:
                        a["message"] = message

        async def persist_agents():
            try:
                await update_project(project_id, agent_states=json.dumps(state["agents"]))
            except Exception as pe:
                logger.warning(f"Could not persist agent states: {pe}")

        try:
            update_agent("coder", "running", 10, "Generation du code...")
            await persist_agents()

            state["steps_queue"].append({
                "action": "reading",
                "label": "Lecture du plan d'architecture",
                "file": None
            })

            coder = CoderAgent(deepseek_client=_deepseek_client)
            # Inject memory context for personalized code generation
            coder._memory_context = coder.format_memory_context(memory_profile) if memory_profile else ""
            architecture = plan.get("architecture", plan)

            # ── Extract file specs and batch them ──
            files_to_generate = architecture.get("structure", {}).get("files", [])
            if not files_to_generate:
                files_to_generate = plan.get("files", [])

            total_files = len(files_to_generate)
            batch_size = coder.CODE_BATCH_SIZE
            batches = [
                files_to_generate[i:i + batch_size]
                for i in range(0, total_files, batch_size)
            ]

            # Design info for context
            design_info = plan.get("architecture", {}).get("design", {})
            design_context = ""
            if design_info:
                colors = design_info.get("colors", {})
                design_context = (
                    f"\nDesign System:\n"
                    f"- Style: {design_info.get('style', 'moderne et professionnel')}\n"
                    f"- Couleur primaire: {colors.get('primary', '#3B82F6')}\n"
                    f"- Couleur secondaire: {colors.get('secondary', '#8B5CF6')}\n"
                    f"- Couleur accent: {colors.get('accent', '#F59E0B')}\n"
                    f"- Typographie: {design_info.get('fonts', 'Inter, system-ui, sans-serif')}\n"
                )

            arch_summary = str(architecture)[:2000]
            desc_summary = str(plan.get("description", ""))[:1000]
            project_name = plan.get("title", project_id)

            all_files: Dict[str, str] = {}
            state["generated_files"] = all_files

            state["steps_queue"].append({
                "action": "thinking",
                "label": f"Generation de {total_files} fichiers en {len(batches)} batch(es)",
                "file": None
            })

            # ── Batch 1: sequential (establishes base context) ──
            try:
                batch_files = await coder._generate_batch(
                    batch=batches[0],
                    batch_idx=0,
                    total_batches=len(batches),
                    project_name=project_name,
                    design_context=design_context,
                    arch_summary=arch_summary,
                    desc_summary=desc_summary,
                    existing_files_list="",
                )
                all_files.update(batch_files)
                total_tokens = coder.tokens_used

                # Stream files immediately
                for filepath in sorted(batch_files.keys()):
                    state["steps_queue"].append({
                        "action": "writing",
                        "label": f"Generation de {filepath}",
                        "file": filepath
                    })
                    state["steps_queue"].append({
                        "type": "file",
                        "path": filepath,
                        "content": batch_files[filepath],
                    })

                progress = int(20 + (len(all_files) / total_files) * 80)
                update_agent("coder", "running", progress, f"{len(all_files)}/{total_files} fichiers")

            except Exception as e:
                logger.error(f"Batch 1 failed: {e}")
                update_agent("coder", "error", 0, f"Erreur batch 1: {str(e)[:100]}")
                await persist_agents()
                state["status"] = "error"
                await update_project(project_id, status="error")
                return

            # ── Remaining batches: parallel groups ──
            remaining = batches[1:]
            for group_idx, batch in enumerate(remaining):
                existing_files_list = ", ".join(sorted(all_files.keys()))
                try:
                    batch_files = await coder._generate_batch(
                        batch=batch,
                        batch_idx=group_idx + 1,
                        total_batches=len(batches),
                        project_name=project_name,
                        design_context=design_context,
                        arch_summary=arch_summary,
                        desc_summary=desc_summary,
                        existing_files_list=existing_files_list,
                    )
                    all_files.update(batch_files)
                    total_tokens = coder.tokens_used

                    # Stream these files immediately too
                    for filepath in sorted(batch_files.keys()):
                        state["steps_queue"].append({
                            "action": "writing",
                            "label": f"Generation de {filepath}",
                            "file": filepath
                        })
                        state["steps_queue"].append({
                            "type": "file",
                            "path": filepath,
                            "content": batch_files[filepath],
                        })

                    progress = int(20 + (len(all_files) / total_files) * 80)
                    update_agent("coder", "running", progress, f"{len(all_files)}/{total_files} fichiers")

                except Exception as e:
                    # Partial recovery: keep files from successful batches
                    logger.error(f"Batch {group_idx + 2} failed: {e}. Keeping {len(all_files)} files from previous batches.")
                    state["steps_queue"].append({
                        "action": "error",
                        "label": f"Batch {group_idx + 2} echoue — {len(all_files)} fichiers conserves",
                        "file": None
                    })
                    # Don't abort — continue with remaining batches

            # ── Finalize ──
            if not all_files:
                update_agent("coder", "error", 0, "Aucun fichier genere")
                await persist_agents()
                state["status"] = "error"
                await update_project(project_id, status="error")
                return

            state["steps_queue"].append({
                "action": "complete",
                "label": f"{len(all_files)} fichiers generes",
                "file": None
            })

            update_agent("coder", "done", 100, f"{len(all_files)} fichiers generes")
            await persist_agents()

            state["status"] = "completed"
            file_names = sorted(all_files.keys())
            await update_project(
                project_id,
                status="complete",
                result_json=json.dumps({"files_created": file_names}),
                tokens_used=total_tokens,
            )

            if total_tokens > 0:
                input_est = int(total_tokens * 0.6)
                output_est = total_tokens - input_est
                exec_model = coder.model_used or settings.deepseek_pro_model
                cost_usd, cost_fcfa = calculate_cost_fcfa("deepseek", input_est, output_est, model=exec_model)
                try:
                    await record_usage(email, "deepseek", exec_model, input_est, output_est, cost_usd, cost_fcfa, task_type="project_exec")
                    if cost_fcfa > 0:
                        await deduct_credits(email, cost_fcfa, f"Exec: {project_id}", "deepseek", exec_model)
                        await update_project(project_id, cost_fcfa=cost_fcfa)
                except Exception as e:
                    logger.error(f"BILLING_FAILED: user={email} project={project_id} "
                                 f"tokens={total_tokens} cost_fcfa={cost_fcfa} error={e}")

        except Exception as e:
            logger.error(f"Execute project error: {e}", exc_info=True)
            # Partial recovery: if we have some files, mark as complete with warning
            if all_files:
                state["steps_queue"].append({
                    "action": "complete",
                    "label": f"Erreur partielle — {len(all_files)} fichiers conserves",
                    "file": None
                })
                update_agent("coder", "done", 80, f"{len(all_files)} fichiers (partiel)")
                state["status"] = "completed"
                await update_project(project_id, status="complete")
            else:
                update_agent("coder", "error", 0, "Erreur lors de la generation.")
                state["status"] = "error"
                await update_project(project_id, status="error")
            await persist_agents()

    asyncio.create_task(_run_generation())

    async def _observe_stream():
        while True:
            state = _project_states.get(project_id)
            if not state:
                break

            yield json.dumps({"type": "agents", "agents": state["agents"]}) + "\n"

            steps_queue = state.get("steps_queue", [])
            while steps_queue:
                event = steps_queue.pop(0)
                if event.get("type") == "file":
                    yield json.dumps(event) + "\n"
                else:
                    yield json.dumps({"type": "step", **event}) + "\n"

            if state.get("status") in ("completed", "error"):
                break

            await asyncio.sleep(0.15)  # 150ms poll — much snappier UX than 500ms

    return StreamingResponse(
        _observe_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{project_id}/status")
async def get_project_status(project_id: str, user: dict = Depends(get_current_user)):
    """Get agent status for a project (in-memory state or DB fallback)."""
    state = _project_states.get(project_id)

    if state:
        return JSONResponse(content={"status": state.get("status"), "agents": state.get("agents", [])})

    project = await get_project(project_id)
    if project:
        persisted_agents = []
        raw = project.get("agent_states", "")
        if raw:
            try:
                persisted_agents = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                pass
        if not persisted_agents:
            persisted_agents = [
                {"name": "planner", "status": "idle", "progress": 0},
                {"name": "coder", "status": "idle", "progress": 0},
            ]
        return JSONResponse(content={
            "status": project.get("status", "unknown"),
            "agents": persisted_agents,
        })

    return JSONResponse(content={"status": "unknown", "agents": []})


@router.get("/{project_id}/download-files")
async def download_project_files(project_id: str, user: dict = Depends(get_current_user)):
    """Return generated files content for frontend to write locally via Tauri FS."""
    state = _project_states.get(project_id)
    if not state:
        raise HTTPException(404, "Projet non trouvé ou expiré")

    files = state.get("generated_files", {})
    if not files:
        raise HTTPException(404, "Aucun fichier généré")

    return JSONResponse(content={"files": files, "file_count": len(files)})


@router.post("/{project_id}/cancel")
async def cancel_project(project_id: str, user: dict = Depends(get_current_user)):
    """Cancel a running project execution."""
    state = _project_states.get(project_id)
    if state:
        state["status"] = "cancelled"
        for agent in state.get("agents", []):
            if agent["status"] == "running":
                agent["status"] = "cancelled"
                agent["message"] = "Annulé par l'utilisateur"
    await update_project(project_id, status="cancelled")
    return JSONResponse(content={"status": "cancelled"})


def _build_smart_context(
    files: Dict[str, str],
    message: str,
    file_focus: Optional[str] = None,
    max_context_chars: int = 48000,
) -> str:
    """Build intelligent file context for iteration.

    Strategy:
    1. Focused file(s) → full content (no truncation)
    2. Related files (imported/referenced by focused files) → full content
    3. Remaining files → signature only (first 5 lines + path)

    This ensures the CoderAgent sees complete files it needs to modify,
    while staying within context limits.
    """
    msg_lower = message.lower()
    all_paths = sorted(files.keys())

    # ── Identify priority files ──
    # Priority 1: explicitly focused file
    priority_full: list[str] = []
    if file_focus and file_focus in files:
        priority_full.append(file_focus)

    # Priority 2: files mentioned by name in the user message
    for path in all_paths:
        filename = path.split("/")[-1].lower()
        basename = filename.rsplit(".", 1)[0] if "." in filename else filename
        if basename and len(basename) > 2 and basename in msg_lower and path not in priority_full:
            priority_full.append(path)

    # Priority 3: files related by imports (referenced in priority files)
    related: list[str] = []
    for ppath in list(priority_full):
        content = files.get(ppath, "")
        for other_path in all_paths:
            if other_path in priority_full or other_path in related:
                continue
            other_name = other_path.split("/")[-1].rsplit(".", 1)[0]
            # Check if this file is imported/referenced
            if other_name and len(other_name) > 2 and other_name in content:
                related.append(other_path)

    # If no focus found, use heuristic: files most likely to match the request
    if not priority_full:
        # Score each file by keyword relevance to the message
        scored = []
        keywords = [w for w in msg_lower.split() if len(w) > 3]
        for path in all_paths:
            content_lower = files[path][:500].lower()
            score = sum(1 for kw in keywords if kw in path.lower() or kw in content_lower)
            scored.append((score, path))
        scored.sort(key=lambda x: -x[0])
        # Take top 3 most relevant as priority
        for score, path in scored[:3]:
            if score > 0:
                priority_full.append(path)

    # If still nothing, take all files (small project)
    if not priority_full and len(all_paths) <= 8:
        priority_full = list(all_paths)

    # ── Build context string ──
    parts: list[str] = []
    used_chars = 0

    # Full content for priority files
    for path in priority_full:
        content = files.get(path, "")
        entry = f"\n=== {path} (COMPLET) ===\n{content}\n"
        if used_chars + len(entry) < max_context_chars:
            parts.append(entry)
            used_chars += len(entry)

    # Full content for related files (if budget allows)
    for path in related:
        content = files.get(path, "")
        entry = f"\n=== {path} (lié) ===\n{content}\n"
        if used_chars + len(entry) < max_context_chars:
            parts.append(entry)
            used_chars += len(entry)
        else:
            # Fallback: signature only
            sig = "\n".join(content.split("\n")[:8])
            entry = f"\n--- {path} (résumé) ---\n{sig}\n...\n"
            if used_chars + len(entry) < max_context_chars:
                parts.append(entry)
                used_chars += len(entry)

    # Remaining files — full content if budget allows, signature otherwise
    remaining = [p for p in all_paths if p not in priority_full and p not in related]
    for path in remaining:
        content = files.get(path, "")
        full_entry = f"\n=== {path} ===\n{content}\n"
        if used_chars + len(full_entry) < max_context_chars:
            parts.append(full_entry)
            used_chars += len(full_entry)
        else:
            # Budget tight — use signature
            sig = "\n".join(content.split("\n")[:8])
            entry = f"\n--- {path} (résumé) ---\n{sig}\n...\n"
            if used_chars + len(entry) < max_context_chars:
                parts.append(entry)
                used_chars += len(entry)

    return "".join(parts)


@router.post("/{project_id}/iterate")
async def iterate_project(project_id: str, body: IterateRequest, user: dict = Depends(get_current_user)):
    """Iterate on an existing project: apply a modification described in natural language.

    Uses smart context: focused files get full content, related files get full content,
    remaining files get signatures only. No truncation of important files.
    """
    email = user["sub"]

    if not await has_credits(email):
        raise HTTPException(402, "Solde épuisé. Rechargez pour continuer.")

    if not body.files:
        raise HTTPException(400, "Aucun fichier fourni pour l'itération")

    # Build smart context — V4 supporte 1M tokens, on peut être généreux
    files_context = _build_smart_context(
        files=body.files,
        message=body.message,
        file_focus=body.file_focus,
        max_context_chars=150000,
    )

    focus_hint = ""
    if body.file_focus:
        focus_hint = f"\nFichier principal à modifier: {body.file_focus}\n"

    # Project structure overview for coherence
    structure_overview = "Structure du projet:\n" + "\n".join(
        f"  {p}" for p in sorted(body.files.keys())
    )

    # Build iteration history context (previous user↔assistant exchanges)
    history_context = ""
    if body.history:
        # Keep last 10 messages max to avoid context explosion
        recent_history = body.history[-10:]
        history_lines = []
        for msg in recent_history:
            prefix = "Utilisateur" if msg.role == "user" else "Assistant"
            # Truncate long assistant responses (they contain full files)
            content = msg.content[:500] if msg.role == "assistant" else msg.content
            history_lines.append(f"[{prefix}]: {content}")
        history_context = (
            "\n\n═══ HISTORIQUE DES ITÉRATIONS PRÉCÉDENTES ═══\n"
            + "\n".join(history_lines)
            + "\n═══ FIN HISTORIQUE ═══\n"
        )

    # Load developer memory for personalized iteration
    memory_profile = await get_memory_as_profile(email)

    coder = CoderAgent(deepseek_client=_deepseek_client)
    coder._memory_context = coder.format_memory_context(memory_profile) if memory_profile else ""

    async def _iterate_stream():
        try:
            yield json.dumps({
                "type": "step",
                "action": "thinking",
                "label": "Lecture du projet et analyse de la modification",
                "file": None,
            }) + "\n"

            # Multi-agent routing: accept all CoderAgent modes
            VALID_MODES = {"iterate", "patch", "refactor", "debug", "test", "review", "code"}
            agent_mode = body.mode if body.mode in VALID_MODES else "iterate"

            result = await asyncio.wait_for(
                coder.execute({
                    "mode": agent_mode,
                    "code": files_context,
                    "language": "",
                    "context": (
                        f"{structure_overview}\n\n"
                        f"{history_context}"
                        f"Voici la NOUVELLE demande de l'utilisateur:\n"
                        f'"{body.message}"\n'
                        f"{focus_hint}\n"
                        f"RAPPEL: Tu as DÉJÀ tous les fichiers du projet ci-dessus. "
                        f"Ne demande JAMAIS à l'utilisateur de coller du code.\n"
                    ),
                }),
                timeout=180.0,  # 3 min max (contexte plus large)
            )

            if result.get("status") == "error":
                yield json.dumps({
                    "type": "step",
                    "action": "error",
                    "label": result.get("error", "Erreur de modification"),
                    "file": None,
                }) + "\n"
                return

            response_text = result.get("result", "")

            # In patch mode, try to apply patches first; fall back to code blocks
            if agent_mode == "patch":
                modified_files = _apply_patches(response_text, body.files)
                if not modified_files:
                    # Fallback: AI may have returned full files instead of patches
                    modified_files = coder._extract_code_blocks(response_text)
            else:
                modified_files = coder._extract_code_blocks(response_text)

            actual_count = 0
            for filepath, content in modified_files.items():
                if filepath == "generated_code.txt":
                    continue

                actual_count += 1
                yield json.dumps({
                    "type": "step",
                    "action": "writing",
                    "label": f"Modification de {filepath}",
                    "file": filepath,
                }) + "\n"

                yield json.dumps({
                    "type": "file",
                    "path": filepath,
                    "content": content,
                }) + "\n"

            yield json.dumps({
                "type": "step",
                "action": "complete",
                "label": f"{actual_count} fichier(s) modifié(s)",
                "file": None,
            }) + "\n"

            # Billing — estimate input/output ratio more accurately
            total_tokens = result.get("tokens_used", 0)
            if total_tokens > 0:
                # Input is typically ~75% of total for iterate (large context in)
                input_est = int(total_tokens * 0.75)
                output_est = total_tokens - input_est
                iter_model = coder.model_used or settings.deepseek_model
                cost_usd, cost_fcfa = calculate_cost_fcfa("deepseek", input_est, output_est, model=iter_model)
                try:
                    await record_usage(email, "deepseek", iter_model, input_est, output_est, cost_usd, cost_fcfa, task_type="iterate")
                    if cost_fcfa > 0:
                        await deduct_credits(email, cost_fcfa, f"Iterate: {project_id}", "deepseek", iter_model)
                except Exception as e:
                    logger.error(f"Iterate billing error: {e}")

        except asyncio.TimeoutError:
            logger.error(f"Iterate timeout for project {project_id}")
            yield json.dumps({
                "type": "step",
                "action": "error",
                "label": "Timeout: la modification prend trop de temps. Essaie une demande plus ciblée.",
                "file": None,
            }) + "\n"

        except Exception as e:
            logger.error(f"Iterate project error: {e}", exc_info=True)
            yield json.dumps({
                "type": "step",
                "action": "error",
                "label": f"Erreur: {str(e)[:200]}",
                "file": None,
            }) + "\n"

    return StreamingResponse(
        _iterate_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── CODE REVIEW ──

class ReviewRequest(BaseModel):
    files: Dict[str, str] = Field(..., description="Map filepath → content")
    project_name: str = Field("Projet", description="Nom du projet")
    focus: Optional[str] = Field(None, description="Focus spécifique (sécurité, performance, etc.)")


@router.post("/{project_id}/review")
async def review_project(project_id: str, body: ReviewRequest, user: dict = Depends(get_current_user)):
    """Run a deep code review/audit on a project's files.

    Returns a streaming response with step events and the final markdown report.
    """
    email = user["sub"]

    if not await has_credits(email):
        raise HTTPException(402, "Solde épuisé. Rechargez pour continuer.")

    if not body.files:
        raise HTTPException(400, "Aucun fichier fourni pour l'audit")

    # Load developer memory for contextual audit
    memory_profile = await get_memory_as_profile(email)

    reviewer = CodeReviewAgent(deepseek_client=_deepseek_client)
    reviewer._memory_context = reviewer.format_memory_context(memory_profile) if memory_profile else ""

    async def _review_stream():
        try:
            yield json.dumps({
                "type": "step",
                "action": "thinking",
                "label": f"Lecture de {len(body.files)} fichiers du projet",
                "file": None,
            }) + "\n"

            yield json.dumps({
                "type": "step",
                "action": "thinking",
                "label": "Analyse de l'architecture et du code",
                "file": None,
            }) + "\n"

            result = await asyncio.wait_for(
                reviewer.execute({
                    "project_name": body.project_name,
                    "files": body.files,
                    "focus": body.focus,
                }),
                timeout=300.0,  # 5 min for deep audit
            )

            report = result.get("report", "Aucun rapport généré.")

            yield json.dumps({
                "type": "step",
                "action": "writing",
                "label": "Rédaction du rapport d'audit",
                "file": None,
            }) + "\n"

            yield json.dumps({
                "type": "review",
                "report": report,
            }) + "\n"

            yield json.dumps({
                "type": "step",
                "action": "complete",
                "label": "Audit terminé",
                "file": None,
            }) + "\n"

            # Billing
            total_tokens = result.get("tokens_used", 0)
            if total_tokens > 0:
                input_est = int(total_tokens * 0.7)
                output_est = total_tokens - input_est
                review_model = result.get("model", "") or settings.deepseek_model
                cost_usd, cost_fcfa = calculate_cost_fcfa("deepseek", input_est, output_est, model=review_model)
                try:
                    await deduct_credits(email, cost_fcfa)
                    await record_usage(
                        email=email,
                        provider="deepseek",
                        model=review_model,
                        input_tokens=input_est,
                        output_tokens=output_est,
                        cost_usd=cost_usd,
                        cost_fcfa=cost_fcfa,
                        endpoint="review",
                    )
                except Exception as billing_err:
                    logger.error(f"Billing error (review): {billing_err}")

        except asyncio.TimeoutError:
            yield json.dumps({
                "type": "step",
                "action": "error",
                "label": "Timeout: l'audit prend trop de temps. Essaie avec moins de fichiers.",
                "file": None,
            }) + "\n"

        except Exception as e:
            logger.error(f"Review project error: {e}", exc_info=True)
            yield json.dumps({
                "type": "step",
                "action": "error",
                "label": f"Erreur: {str(e)[:200]}",
                "file": None,
            }) + "\n"

    return StreamingResponse(
        _review_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── CRUD ──

@router.get("")
async def list_projects(user: dict = Depends(get_current_user), limit: int = 50):
    """List all projects for the current user."""
    projects = await get_user_projects(user["sub"], limit=min(limit, 200))
    return {"projects": projects, "count": len(projects)}


@router.get("/{project_id}")
async def get_single_project(project_id: str, user: dict = Depends(get_current_user)):
    """Get a single project by ID."""
    project = await get_project(project_id)
    if not project:
        raise HTTPException(404, "Projet non trouvé")
    if project.get("user_email") != user["sub"]:
        raise HTTPException(403, "Accès non autorisé")
    return project


@router.delete("/{project_id}")
async def remove_project(project_id: str, user: dict = Depends(get_current_user)):
    """Delete a project."""
    deleted = await delete_project(project_id, user["sub"])
    if not deleted:
        raise HTTPException(404, "Projet non trouvé ou accès non autorisé")
    _project_states.pop(project_id, None)
    return {"status": "deleted"}


# ── Design-to-Code ──

class DesignToCodeRequest(BaseModel):
    """Request to convert a design image into code."""
    image_data: Optional[str] = Field(None, description="Base64-encoded image")
    image_url: Optional[str] = Field(None, description="Image URL")
    framework: str = Field("html", description="Target framework: html|react|vue")
    css_mode: str = Field("tailwind", description="CSS approach: tailwind|css-modules|inline|vanilla")
    responsive: bool = Field(True, description="Generate responsive code")
    instructions: str = Field("", max_length=5000, description="Additional user instructions")
    existing_files: Dict[str, str] = Field(default_factory=dict, description="Existing project files for context")


@router.post("/{project_id}/design-to-code")
async def design_to_code(project_id: str, body: DesignToCodeRequest, user: dict = Depends(get_current_user)):
    """Convert a design image to code using VisionAgent + CoderAgent pipeline.

    1. VisionAgent analyses the image → structured description
    2. CoderAgent generates code from the description
    3. Files are streamed back via SSE
    """
    email = user["sub"]

    if not await has_credits(email):
        raise HTTPException(402, "Solde épuisé. Rechargez pour continuer.")

    if not body.image_data and not body.image_url:
        raise HTTPException(400, "Aucune image fournie (image_data ou image_url requis)")

    vision = VisionAgent()
    if not vision.is_available:
        raise HTTPException(503, "Service vision non disponible (API Kimi non configurée)")

    # Load developer memory for personalized code generation
    memory_profile_dtc = await get_memory_as_profile(email)

    coder = CoderAgent(deepseek_client=_deepseek_client)
    coder._memory_context = coder.format_memory_context(memory_profile_dtc) if memory_profile_dtc else ""

    # Framework-specific code generation prompt
    framework_hints = {
        "html": "HTML5 sémantique + CSS moderne. Un seul fichier index.html avec le CSS inline ou dans un <style> tag.",
        "react": "React fonctionnel avec hooks. Composants séparés dans des fichiers .tsx. Utilise TypeScript.",
        "vue": "Vue 3 Composition API avec <script setup>. Composants séparés dans des fichiers .vue.",
    }
    css_hints = {
        "tailwind": "Utilise Tailwind CSS pour le styling (classes utilitaires). Ajoute le CDN Tailwind si HTML.",
        "css-modules": "Utilise des CSS Modules (.module.css) pour le styling scopé.",
        "inline": "Utilise des styles inline (objets style en React, attribut style en HTML).",
        "vanilla": "Utilise du CSS vanilla dans des fichiers .css séparés.",
    }

    fw = framework_hints.get(body.framework, framework_hints["html"])
    css = css_hints.get(body.css_mode, css_hints["tailwind"])
    responsive_hint = "Le code DOIT être responsive (mobile-first, media queries ou classes responsive Tailwind)." if body.responsive else ""

    async def _d2c_stream():
        total_tokens = 0

        try:
            # Step 1: Analyze the design with VisionAgent
            yield json.dumps({
                "type": "step",
                "action": "analyzing",
                "label": "Analyse du design avec l'IA vision...",
                "file": None,
            }) + "\n"

            vision_result = await asyncio.wait_for(
                vision.execute({
                    "image_data": body.image_data or "",
                    "image_url": body.image_url or "",
                    "prompt": (
                        "Analyse cette maquette/screenshot de design web en détail. "
                        "Décris PRÉCISÉMENT le layout, les couleurs, la typographie, "
                        "les composants, le contenu textuel, et les interactions. "
                        "Réponds en JSON structuré."
                    ),
                    "mode": "analyze",
                }),
                timeout=120.0,
            )

            if vision_result.get("status") == "error":
                yield json.dumps({
                    "type": "error",
                    "message": f"Erreur d'analyse visuelle: {vision_result.get('error', 'Unknown')}",
                }) + "\n"
                return

            analysis_text = vision_result.get("analysis", "")
            total_tokens += vision_result.get("tokens_used", 0)

            # Try to parse as JSON for structured analysis
            analysis_data = None
            try:
                analysis_data = json.loads(analysis_text)
            except (json.JSONDecodeError, TypeError):
                analysis_data = {"description": analysis_text}

            yield json.dumps({
                "type": "analysis",
                "analysis": {
                    "layout": analysis_data.get("layout", ""),
                    "colors": list(analysis_data.get("colors", {}).values()) if isinstance(analysis_data.get("colors"), dict) else [],
                    "typography": str(analysis_data.get("typography", "")),
                    "components": analysis_data.get("components", []),
                    "interactions": analysis_data.get("interactions", []),
                    "description": analysis_data.get("description", analysis_text[:500]),
                    "raw": analysis_text[:2000],
                },
            }) + "\n"

            yield json.dumps({
                "type": "step",
                "action": "generating",
                "label": "Génération du code à partir du design...",
                "file": None,
            }) + "\n"

            # Step 2: Generate code from the analysis
            user_instructions = f"\nInstructions supplémentaires: {body.instructions}" if body.instructions else ""

            # Include existing files context if any
            existing_context = ""
            if body.existing_files:
                existing_context = "\n\nFICHIERS EXISTANTS DU PROJET (adapte le nouveau code pour s'intégrer):\n"
                for fpath, fcontent in list(body.existing_files.items())[:10]:
                    existing_context += f"\n--- {fpath} ---\n{fcontent[:2000]}\n"

            code_prompt = (
                f"Voici l'analyse détaillée d'un design web:\n\n"
                f"{analysis_text}\n\n"
                f"GÉNÈRE LE CODE COMPLET pour reproduire ce design.\n\n"
                f"FRAMEWORK: {fw}\n"
                f"CSS: {css}\n"
                f"{responsive_hint}\n"
                f"{user_instructions}\n"
                f"{existing_context}\n\n"
                f"RÈGLES:\n"
                f"1. Reproduis le design le plus fidèlement possible\n"
                f"2. Utilise le contenu textuel EXACT de l'analyse\n"
                f"3. Respecte les couleurs, tailles et espacements décrits\n"
                f"4. Code PROPRE, bien structuré, commenté\n"
                f"5. Fonctionnel immédiatement (pas de placeholder)\n"
                f"6. Chaque fichier dans un code block avec le chemin en premier commentaire"
            )

            code_result = await asyncio.wait_for(
                coder.execute({
                    "mode": "code",
                    "code": "",
                    "language": body.framework,
                    "context": code_prompt,
                }),
                timeout=180.0,
            )

            if code_result.get("status") == "error":
                yield json.dumps({
                    "type": "error",
                    "message": f"Erreur de génération: {code_result.get('error', 'Unknown')}",
                }) + "\n"
                return

            total_tokens += code_result.get("tokens_used", 0)

            # Extract generated files
            response_text = code_result.get("result", "")
            generated_files = coder._extract_code_blocks(response_text)

            file_count = 0
            for filepath, content in generated_files.items():
                if filepath == "generated_code.txt":
                    continue

                file_count += 1
                yield json.dumps({
                    "type": "step",
                    "action": "writing",
                    "label": f"Écriture de {filepath}",
                    "file": filepath,
                }) + "\n"

                yield json.dumps({
                    "type": "file",
                    "path": filepath,
                    "content": content,
                }) + "\n"

            # Billing
            try:
                cost = calculate_cost_fcfa(total_tokens, "generation")
                if cost > 0:
                    await deduct_credits(email, cost)
                    await record_usage(email, "design_to_code", total_tokens, cost, {
                        "project_id": project_id,
                        "framework": body.framework,
                        "files_generated": file_count,
                    })
            except Exception as e:
                logger.warning(f"[design-to-code] Billing error: {e}")

            yield json.dumps({
                "type": "done",
                "files_count": file_count,
                "tokens_used": total_tokens,
            }) + "\n"

            logger.info(f"[design-to-code] {file_count} files generated, {total_tokens} tokens used")

        except asyncio.TimeoutError:
            yield json.dumps({
                "type": "error",
                "message": "Timeout — la génération a pris trop de temps (>3 min)",
            }) + "\n"
        except Exception as e:
            logger.error(f"[design-to-code] Error: {e}")
            yield json.dumps({
                "type": "error",
                "message": "Erreur interne lors de la conversion design → code",
            }) + "\n"

    return StreamingResponse(
        _d2c_stream(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )
