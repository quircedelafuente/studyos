# NotebookLM Integration Design

## Overview

Replace the current CLI tab (iframe embedding NotebookLM) with a full-featured UI backed by a Python FastAPI server that wraps the `notebooklm-py` library. This gives programmatic access to all NotebookLM functionality directly within IEStudio.

## Architecture

```
IEStudio (Next.js :3000)
    └─ NotebookLMPanel.tsx → /api/notebooklm/* (Next.js proxy route)
                                └─ FastAPI backend (:8000)
                                      └─ notebooklm-py library
                                            └─ ~/.notebooklm/ (session cookies)
```

Two processes run in development:
- Next.js dev server on port 3000
- FastAPI server on port 8000

Next.js proxies all `/api/notebooklm/*` requests to the FastAPI backend, avoiding CORS issues.

## Backend (`backend/`)

Located at `IEStudio/backend/` within the monorepo.

### Stack

- Python 3.11+
- FastAPI (async)
- notebooklm-py (latest)
- uvicorn (ASGI server)
- uv (package manager)

### API Endpoints

All endpoints are prefixed with `/` on the FastAPI side (the `/api/notebooklm` prefix is stripped by the Next.js proxy).

#### Auth

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/status` | Check if session cookies exist and are valid |

#### Notebooks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/notebooks` | List all notebooks |
| POST | `/notebooks` | Create a new notebook |
| DELETE | `/notebooks/{id}` | Delete a notebook |
| GET | `/notebooks/{id}` | Get notebook details |

#### Sources

| Method | Path | Description |
|--------|------|-------------|
| GET | `/notebooks/{id}/sources` | List sources in a notebook |
| POST | `/notebooks/{id}/sources` | Add a source (URL, text, or file upload) |
| DELETE | `/notebooks/{id}/sources/{source_id}` | Remove a source |

#### Chat

| Method | Path | Description |
|--------|------|-------------|
| POST | `/notebooks/{id}/chat` | Send a message, receive response |

#### Audio Overviews

| Method | Path | Description |
|--------|------|-------------|
| GET | `/notebooks/{id}/audio` | Get existing audio overview |
| POST | `/notebooks/{id}/audio` | Generate a new audio overview |

#### Sharing

| Method | Path | Description |
|--------|------|-------------|
| GET | `/notebooks/{id}/share` | Get share status/link |
| POST | `/notebooks/{id}/share` | Enable/configure sharing |

#### Downloads

| Method | Path | Description |
|--------|------|-------------|
| GET | `/notebooks/{id}/downloads` | List downloadable artifacts |
| GET | `/notebooks/{id}/downloads/{artifact_id}` | Download a specific artifact |

### Error Handling

All errors return JSON with `{ "error": string, "detail": string }` and appropriate HTTP status codes:
- 401: No valid session (need to run `notebooklm login`)
- 404: Notebook/source not found
- 422: Invalid request parameters
- 502: NotebookLM API error

### Session Management

The backend reads session cookies from `~/.notebooklm/` (default notebooklm-py location). No credentials are stored or managed by the backend itself. If the session is expired or missing, the `/auth/status` endpoint returns 401 and the frontend shows setup instructions.

## Frontend

### Tab Changes

- Rename the tab from "CLI" to "NotebookLM" in `DashboardApp.tsx`
- Update `MainTabId` type from `"cli"` to `"notebooklm"`
- Keep the `IconTerminal` icon (or switch to a notebook-style icon)
- Replace `CliPanel.tsx` content entirely

### Component Structure

```
NotebookLMPanel.tsx          (main panel, replaces CliPanel)
├─ NotebookLMAuthBanner.tsx  (shown when not authenticated)
├─ NotebookLMSidebar.tsx     (notebook list + create button)
└─ NotebookLMDetail.tsx      (selected notebook content)
   ├─ SourcesTab.tsx         (list/add/remove sources)
   ├─ ChatTab.tsx            (conversation interface)
   ├─ AudioTab.tsx           (generate/play audio overviews)
   └─ SettingsTab.tsx        (share, download, delete)
```

### Layout

- **Left sidebar** (~280px): scrollable list of notebooks, each showing title and source count. "New Notebook" button at top. Active notebook highlighted.
- **Main area**: sub-tab navigation at top (Sources | Chat | Audio | Settings), content below.
- **Auth banner**: full-width banner at top of the panel when `/auth/status` returns 401. Shows instructions to run `notebooklm login` in terminal.

### Styling

Follows existing IEStudio design system:
- CSS variables: `--surface`, `--border`, `--ink`, `--ink-muted`, etc.
- Rounded corners (`rounded-xl`, `rounded-2xl`)
- Font: Plus Jakarta Sans for UI, JetBrains Mono for code/commands
- Consistent with other panels (CalendarPanel, CoursesPanel patterns)

### Data Fetching

- Use `fetch` to call `/api/notebooklm/*` endpoints
- Loading states with skeleton placeholders
- Error states with retry buttons
- Optimistic updates for delete operations

## Next.js Proxy Route

`src/app/api/notebooklm/[...path]/route.ts`

Catch-all route that:
1. Strips the `/api/notebooklm` prefix
2. Forwards the request (method, headers, body) to `http://localhost:8000/`
3. Returns the response as-is
4. Handles connection errors (backend not running) with a friendly 503 response

## Setup Requirements

1. Install Python 3.11+ and `uv`
2. `cd backend && uv sync` (installs dependencies)
3. `notebooklm login` (one-time browser login to get Google session cookies)
4. `uvicorn main:app --port 8000` (start backend)
5. `npm run dev` (start Next.js as usual)

## File Changes Summary

### New files
- `backend/pyproject.toml`
- `backend/main.py` (FastAPI app with all endpoints)
- `src/app/api/notebooklm/[...path]/route.ts` (proxy)
- `src/components/dashboard/NotebookLMPanel.tsx`
- `src/components/dashboard/NotebookLMAuthBanner.tsx`
- `src/components/dashboard/NotebookLMSidebar.tsx`
- `src/components/dashboard/NotebookLMDetail.tsx`
- `src/components/dashboard/notebooklm/SourcesTab.tsx`
- `src/components/dashboard/notebooklm/ChatTab.tsx`
- `src/components/dashboard/notebooklm/AudioTab.tsx`
- `src/components/dashboard/notebooklm/SettingsTab.tsx`

### Modified files
- `src/components/dashboard/DashboardApp.tsx` (tab rename, new import)
- `src/types/dashboard.ts` (MainTabId update)
- `src/components/dashboard/CliPanel.tsx` (deleted)
