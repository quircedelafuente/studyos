# NotebookLM Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CLI tab's iframe with a full NotebookLM UI backed by a FastAPI server wrapping notebooklm-py.

**Architecture:** Next.js frontend proxies `/api/notebooklm/*` to a FastAPI backend on port 8000. The backend uses `notebooklm-py` async client. Frontend uses client-side state with fetch calls.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS 4, FastAPI, notebooklm-py, uvicorn, uv

---

## File Structure

### Backend (new: `backend/`)
- `backend/pyproject.toml` — Python project config with fastapi, notebooklm-py, uvicorn deps
- `backend/main.py` — FastAPI app: client lifecycle, all endpoints, error handling

### Frontend (new/modified)
- `src/app/api/notebooklm/[...path]/route.ts` — Catch-all proxy to FastAPI
- `src/components/dashboard/NotebookLMPanel.tsx` — Main panel (replaces CliPanel)
- `src/components/dashboard/notebooklm/NotebookLMSidebar.tsx` — Notebook list sidebar
- `src/components/dashboard/notebooklm/NotebookLMAuthBanner.tsx` — Auth status banner
- `src/components/dashboard/notebooklm/SourcesTab.tsx` — Sources list/add/remove
- `src/components/dashboard/notebooklm/ChatTab.tsx` — Chat interface
- `src/components/dashboard/notebooklm/ArtifactsTab.tsx` — Generate/list/download artifacts
- `src/components/dashboard/notebooklm/SettingsTab.tsx` — Share, delete notebook

### Modified
- `src/types/dashboard.ts` — Change `"cli"` to `"notebooklm"` in MainTabId
- `src/components/dashboard/DashboardApp.tsx` — Update tab config, import new panel
- `src/components/dashboard/CliPanel.tsx` — Delete

---

### Task 1: Backend — Python project and FastAPI app

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/main.py`

- [ ] **Step 1: Create pyproject.toml**

```toml
[project]
name = "iestudio-notebooklm-backend"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.34.0",
    "notebooklm-py>=0.7.0",
    "python-multipart>=0.0.18",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

- [ ] **Step 2: Create main.py with all endpoints**

```python
from __future__ import annotations

import asyncio
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from notebooklm import NotebookLMClient
from notebooklm.exceptions import (
    AuthError,
    NotebookLMError,
    NotebookNotFoundError,
    SourceNotFoundError,
    ArtifactNotFoundError,
)

# ---------------------------------------------------------------------------
# Client singleton
# ---------------------------------------------------------------------------

_client: NotebookLMClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _client
    try:
        _client = await NotebookLMClient.from_storage()
        await _client.__aenter__()
    except Exception:
        _client = None
    yield
    if _client:
        await _client.__aexit__(None, None, None)
        _client = None


app = FastAPI(lifespan=lifespan)


def get_client() -> NotebookLMClient:
    if _client is None:
        raise HTTPException(
            status_code=401,
            detail="No active session. Run 'notebooklm login' in your terminal.",
        )
    return _client


# ---------------------------------------------------------------------------
# Error handler
# ---------------------------------------------------------------------------

@app.exception_handler(NotebookLMError)
async def notebooklm_error_handler(request, exc: NotebookLMError):
    if isinstance(exc, AuthError):
        return JSONResponse(status_code=401, content={"error": str(exc)})
    if isinstance(exc, (NotebookNotFoundError, SourceNotFoundError, ArtifactNotFoundError)):
        return JSONResponse(status_code=404, content={"error": str(exc)})
    return JSONResponse(status_code=502, content={"error": str(exc)})


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@app.get("/auth/status")
async def auth_status():
    client = get_client()
    return {"authenticated": True, "connected": client.is_connected}


# ---------------------------------------------------------------------------
# Notebooks
# ---------------------------------------------------------------------------

@app.get("/notebooks")
async def list_notebooks():
    client = get_client()
    notebooks = await client.notebooks.list()
    return [
        {
            "id": nb.id,
            "title": nb.title,
            "created_at": nb.created_at.isoformat() if nb.created_at else None,
            "sources_count": nb.sources_count,
        }
        for nb in notebooks
    ]


class CreateNotebookBody(BaseModel):
    title: str


@app.post("/notebooks")
async def create_notebook(body: CreateNotebookBody):
    client = get_client()
    nb = await client.notebooks.create(body.title)
    return {"id": nb.id, "title": nb.title}


@app.get("/notebooks/{notebook_id}")
async def get_notebook(notebook_id: str):
    client = get_client()
    nb = await client.notebooks.get(notebook_id)
    return {
        "id": nb.id,
        "title": nb.title,
        "created_at": nb.created_at.isoformat() if nb.created_at else None,
        "sources_count": nb.sources_count,
    }


@app.delete("/notebooks/{notebook_id}")
async def delete_notebook(notebook_id: str):
    client = get_client()
    ok = await client.notebooks.delete(notebook_id)
    return {"deleted": ok}


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

def _serialize_source(s) -> dict[str, Any]:
    return {
        "id": s.id,
        "title": s.title,
        "url": s.url,
        "kind": s.kind.value if s.kind else None,
        "status": "ready" if s.is_ready else "processing" if s.is_processing else "error",
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


@app.get("/notebooks/{notebook_id}/sources")
async def list_sources(notebook_id: str):
    client = get_client()
    sources = await client.sources.list(notebook_id)
    return [_serialize_source(s) for s in sources]


@app.post("/notebooks/{notebook_id}/sources/url")
async def add_source_url(notebook_id: str, body: dict):
    client = get_client()
    source = await client.sources.add_url(notebook_id, body["url"], wait=True)
    return _serialize_source(source)


@app.post("/notebooks/{notebook_id}/sources/text")
async def add_source_text(notebook_id: str, body: dict):
    client = get_client()
    source = await client.sources.add_text(
        notebook_id, body["title"], body["content"], wait=True
    )
    return _serialize_source(source)


@app.post("/notebooks/{notebook_id}/sources/file")
async def add_source_file(
    notebook_id: str,
    file: UploadFile = File(...),
):
    client = get_client()
    with tempfile.NamedTemporaryFile(
        delete=False, suffix=Path(file.filename or "upload").suffix
    ) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        source = await client.sources.add_file(
            notebook_id, tmp_path, mime_type=file.content_type, wait=True
        )
        return _serialize_source(source)
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@app.delete("/notebooks/{notebook_id}/sources/{source_id}")
async def delete_source(notebook_id: str, source_id: str):
    client = get_client()
    ok = await client.sources.delete(notebook_id, source_id)
    return {"deleted": ok}


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

class ChatBody(BaseModel):
    question: str
    source_ids: list[str] | None = None
    conversation_id: str | None = None


@app.post("/notebooks/{notebook_id}/chat")
async def chat(notebook_id: str, body: ChatBody):
    client = get_client()
    result = await client.chat.ask(
        notebook_id,
        body.question,
        source_ids=body.source_ids,
        conversation_id=body.conversation_id,
    )
    return {
        "answer": result.answer,
        "conversation_id": result.conversation_id,
        "turn_number": result.turn_number,
        "references": [
            {
                "source_id": r.source_id,
                "cited_text": r.cited_text,
                "citation_number": r.citation_number,
            }
            for r in result.references
        ],
    }


@app.get("/notebooks/{notebook_id}/chat/history")
async def chat_history(notebook_id: str):
    client = get_client()
    history = await client.chat.get_history(notebook_id)
    return [{"question": q, "answer": a} for q, a in history]


# ---------------------------------------------------------------------------
# Artifacts
# ---------------------------------------------------------------------------

def _serialize_artifact(a) -> dict[str, Any]:
    return {
        "id": a.id,
        "title": a.title,
        "kind": a.kind.value if a.kind else None,
        "status": a.status_str,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


@app.get("/notebooks/{notebook_id}/artifacts")
async def list_artifacts(notebook_id: str, artifact_type: str | None = None):
    client = get_client()
    from notebooklm import ArtifactType

    at = ArtifactType(artifact_type) if artifact_type else None
    artifacts = await client.artifacts.list(notebook_id, artifact_type=at)
    return [_serialize_artifact(a) for a in artifacts]


class GenerateArtifactBody(BaseModel):
    artifact_type: str  # "audio", "report", "quiz", etc.
    source_ids: list[str] | None = None
    language: str = "en"
    instructions: str | None = None
    # Audio-specific
    audio_format: int | None = None
    audio_length: int | None = None
    # Report-specific
    report_format: str | None = None


@app.post("/notebooks/{notebook_id}/artifacts/generate")
async def generate_artifact(notebook_id: str, body: GenerateArtifactBody):
    client = get_client()
    from notebooklm import (
        AudioFormat,
        AudioLength,
        ReportFormat,
    )

    kwargs: dict[str, Any] = {
        "notebook_id": notebook_id,
        "source_ids": body.source_ids,
    }

    if body.artifact_type == "audio":
        if body.audio_format:
            kwargs["audio_format"] = AudioFormat(body.audio_format)
        if body.audio_length:
            kwargs["audio_length"] = AudioLength(body.audio_length)
        if body.language:
            kwargs["language"] = body.language
        if body.instructions:
            kwargs["instructions"] = body.instructions
        status = await client.artifacts.generate_audio(**kwargs)
    elif body.artifact_type == "report":
        if body.report_format:
            kwargs["report_format"] = ReportFormat(body.report_format)
        if body.language:
            kwargs["language"] = body.language
        if body.instructions:
            kwargs["custom_prompt"] = body.instructions
        status = await client.artifacts.generate_report(**kwargs)
    elif body.artifact_type == "quiz":
        if body.instructions:
            kwargs["instructions"] = body.instructions
        status = await client.artifacts.generate_quiz(**kwargs)
    elif body.artifact_type == "flashcards":
        if body.instructions:
            kwargs["instructions"] = body.instructions
        status = await client.artifacts.generate_flashcards(**kwargs)
    elif body.artifact_type == "study_guide":
        if body.language:
            kwargs["language"] = body.language
        status = await client.artifacts.generate_study_guide(**kwargs)
    elif body.artifact_type == "mind_map":
        if body.instructions:
            kwargs["instructions"] = body.instructions
        status = await client.artifacts.generate_mind_map(**kwargs)
    else:
        raise HTTPException(status_code=422, detail=f"Unknown artifact type: {body.artifact_type}")

    return {
        "task_id": status.task_id,
        "status": status.status,
    }


@app.get("/notebooks/{notebook_id}/artifacts/{artifact_id}/status")
async def artifact_status(notebook_id: str, artifact_id: str):
    client = get_client()
    artifact = await client.artifacts.get(notebook_id, artifact_id)
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return _serialize_artifact(artifact)


@app.get("/notebooks/{notebook_id}/artifacts/{artifact_id}/download")
async def download_artifact(notebook_id: str, artifact_id: str):
    client = get_client()
    artifact = await client.artifacts.get(notebook_id, artifact_id)
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")

    kind = artifact.kind.value if artifact.kind else "unknown"
    with tempfile.TemporaryDirectory() as tmpdir:
        out = Path(tmpdir) / f"{artifact_id}"
        download_method = {
            "audio": client.artifacts.download_audio,
            "report": client.artifacts.download_report,
            "quiz": client.artifacts.download_quiz,
            "flashcards": client.artifacts.download_flashcards,
            "mind_map": client.artifacts.download_mind_map,
            "infographic": client.artifacts.download_infographic,
            "slide_deck": client.artifacts.download_slide_deck,
            "data_table": client.artifacts.download_data_table,
            "video": client.artifacts.download_video,
        }.get(kind)

        if not download_method:
            raise HTTPException(status_code=422, detail=f"Cannot download {kind}")

        path = await download_method(notebook_id, str(out), artifact_id=artifact_id)
        return FileResponse(path, filename=Path(path).name)


@app.delete("/notebooks/{notebook_id}/artifacts/{artifact_id}")
async def delete_artifact(notebook_id: str, artifact_id: str):
    client = get_client()
    ok = await client.artifacts.delete(notebook_id, artifact_id)
    return {"deleted": ok}


# ---------------------------------------------------------------------------
# Sharing
# ---------------------------------------------------------------------------

@app.get("/notebooks/{notebook_id}/sharing")
async def get_sharing(notebook_id: str):
    client = get_client()
    status = await client.sharing.get_status(notebook_id)
    return {
        "is_public": status.is_public,
        "access": status.access.name.lower(),
        "view_level": status.view_level.name.lower(),
        "share_url": status.share_url,
        "shared_users": [
            {
                "email": u.email,
                "permission": u.permission.name.lower(),
                "display_name": u.display_name,
            }
            for u in status.shared_users
        ],
    }


class ShareBody(BaseModel):
    public: bool


@app.post("/notebooks/{notebook_id}/sharing")
async def set_sharing(notebook_id: str, body: ShareBody):
    client = get_client()
    status = await client.sharing.set_public(notebook_id, body.public)
    return {
        "is_public": status.is_public,
        "share_url": status.share_url,
    }
```

- [ ] **Step 3: Install dependencies**

```bash
cd /Users/usuario/Desktop/IEStudio/backend && uv sync
```

- [ ] **Step 4: Commit**

```bash
git add backend/
git commit -m "feat: add FastAPI backend wrapping notebooklm-py"
```

---

### Task 2: Next.js proxy route

**Files:**
- Create: `src/app/api/notebooklm/[...path]/route.ts`

- [ ] **Step 1: Create the catch-all proxy route**

```typescript
export const runtime = "nodejs";

const BACKEND = process.env.NOTEBOOKLM_BACKEND_URL ?? "http://localhost:8000";

async function proxy(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Strip /api/notebooklm prefix, keep the rest
  const backendPath = url.pathname.replace(/^\/api\/notebooklm/, "") || "/";
  const target = `${BACKEND}${backendPath}${url.search}`;

  try {
    const headers = new Headers();
    const contentType = req.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);

    const res = await fetch(target, {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? await req.arrayBuffer() : undefined,
    });

    const responseHeaders = new Headers();
    const resContentType = res.headers.get("content-type");
    if (resContentType) responseHeaders.set("content-type", resContentType);
    const disposition = res.headers.get("content-disposition");
    if (disposition) responseHeaders.set("content-disposition", disposition);

    return new Response(res.body, {
      status: res.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      { error: "Backend not running. Start it with: cd backend && uvicorn main:app --port 8000" },
      { status: 503 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
export const PUT = proxy;
export const PATCH = proxy;
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/notebooklm/
git commit -m "feat: add Next.js proxy route for notebooklm backend"
```

---

### Task 3: Update tab config — rename CLI to NotebookLM

**Files:**
- Modify: `src/types/dashboard.ts:1-6`
- Modify: `src/components/dashboard/DashboardApp.tsx:8,30,163-167`
- Delete: `src/components/dashboard/CliPanel.tsx`

- [ ] **Step 1: Update MainTabId type**

In `src/types/dashboard.ts`, change `"cli"` to `"notebooklm"`.

- [ ] **Step 2: Update DashboardApp.tsx**

Replace `CliPanel` import with `NotebookLMPanel`. Change the tab config entry from `{ id: "cli", label: "CLI", Icon: IconTerminal }` to `{ id: "notebooklm", label: "NotebookLM", Icon: IconTerminal }`. Update the render section to use `NotebookLMPanel`.

- [ ] **Step 3: Delete CliPanel.tsx**

```bash
rm src/components/dashboard/CliPanel.tsx
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: rename CLI tab to NotebookLM, remove old CliPanel"
```

---

### Task 4: NotebookLMPanel — main panel component

**Files:**
- Create: `src/components/dashboard/NotebookLMPanel.tsx`
- Create: `src/components/dashboard/notebooklm/NotebookLMAuthBanner.tsx`

- [ ] **Step 1: Create NotebookLMAuthBanner**

Simple banner that shows when `/api/notebooklm/auth/status` returns 401.

- [ ] **Step 2: Create NotebookLMPanel**

Main panel with:
- Auth check on mount
- Auth banner if not authenticated
- Left sidebar (notebook list) + right detail area
- State: selectedNotebookId, activeDetailTab
- Fetches notebook list on mount

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/NotebookLMPanel.tsx src/components/dashboard/notebooklm/
git commit -m "feat: add NotebookLMPanel with auth check and layout"
```

---

### Task 5: NotebookLMSidebar — notebook list

**Files:**
- Create: `src/components/dashboard/notebooklm/NotebookLMSidebar.tsx`

- [ ] **Step 1: Create sidebar component**

Shows list of notebooks (title, source count), create button, active state for selected notebook.

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/notebooklm/NotebookLMSidebar.tsx
git commit -m "feat: add NotebookLM sidebar with notebook list"
```

---

### Task 6: SourcesTab

**Files:**
- Create: `src/components/dashboard/notebooklm/SourcesTab.tsx`

- [ ] **Step 1: Create SourcesTab**

Lists sources for selected notebook. Add source forms: URL input, text (title+content), file upload. Delete button per source. Status badges (ready/processing/error).

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/notebooklm/SourcesTab.tsx
git commit -m "feat: add SourcesTab with add/list/delete sources"
```

---

### Task 7: ChatTab

**Files:**
- Create: `src/components/dashboard/notebooklm/ChatTab.tsx`

- [ ] **Step 1: Create ChatTab**

Chat interface with message history, input box, send button. Displays answer with citation references. Maintains conversation_id across messages.

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/notebooklm/ChatTab.tsx
git commit -m "feat: add ChatTab with conversation support"
```

---

### Task 8: ArtifactsTab

**Files:**
- Create: `src/components/dashboard/notebooklm/ArtifactsTab.tsx`

- [ ] **Step 1: Create ArtifactsTab**

Lists existing artifacts. Generate new artifacts (audio, report, quiz, flashcards, study guide, mind map). Status polling for in-progress artifacts. Download button for completed artifacts. Delete button.

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/notebooklm/ArtifactsTab.tsx
git commit -m "feat: add ArtifactsTab with generate/list/download"
```

---

### Task 9: SettingsTab

**Files:**
- Create: `src/components/dashboard/notebooklm/SettingsTab.tsx`

- [ ] **Step 1: Create SettingsTab**

Sharing controls (public toggle, share URL display). Shared users list. Delete notebook button with confirmation.

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/notebooklm/SettingsTab.tsx
git commit -m "feat: add SettingsTab with sharing and delete"
```

---

### Task 10: Wire everything together and verify

- [ ] **Step 1: Verify all imports resolve**

```bash
cd /Users/usuario/Desktop/IEStudio && npx tsc --noEmit
```

- [ ] **Step 2: Verify dev server starts**

```bash
npm run dev
```

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete NotebookLM integration in IEStudio dashboard"
```
