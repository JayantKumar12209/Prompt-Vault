# PromptVault — API Design

> **Status: DESIGN (Phase 2). No endpoint is implemented yet.** This file becomes the real API reference as endpoints ship; each endpoint will be marked implemented and tested.

## Conventions

- Base path: `/api`. JSON only (`Content-Type: application/json`).
- Auth: cookie `pv_session` (httpOnly). All endpoints except register, login and health require it.
- State-changing requests (POST, PUT, PATCH, DELETE) must come from an allowed `Origin`.
- Resources owned by another user respond **404**.
- IDs are opaque strings (cuid).
- Pagination: `?page=1&pageSize=20` (max 100). List responses: `{ "data": [...], "page": 1, "pageSize": 20, "total": 42 }`.

### Error format

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed",
             "details": [ { "path": "template", "message": "Required" } ] } }
```

| Status | Meaning | Example codes |
|--------|---------|---------------|
| 400 | Invalid input | `VALIDATION_ERROR`, `MISSING_VARIABLES` |
| 401 | Not authenticated or session expired | `UNAUTHENTICATED` |
| 403 | Blocked origin | `FORBIDDEN_ORIGIN` |
| 404 | Not found or not yours | `NOT_FOUND` |
| 409 | Conflict | `EMAIL_TAKEN`, `DUPLICATE_NAME` |
| 413 | Body too large | `PAYLOAD_TOO_LARGE` |
| 429 | Rate limit or daily AI quota | `RATE_LIMITED`, `QUOTA_EXCEEDED` |
| 502 | AI provider failed | `PROVIDER_UNAVAILABLE`, `PROVIDER_AUTH`, `PROVIDER_BLOCKED` |
| 503 | AI not configured | `AI_NOT_CONFIGURED` |
| 504 | AI provider timed out | `PROVIDER_TIMEOUT` |
| 500 | Unexpected | `INTERNAL_ERROR` (no stack trace in production) |

## Endpoints

### System
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/health` | no | Liveness and DB check |
| GET | `/api/config` | yes | `{ "aiMode": "gemini" \| "demo" \| "unconfigured", "model": "..." }` so the UI shows the true mode |

### Authentication
| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/auth/register` | `{ email, password, displayName? }` → 201, sets cookie. Password 10–128 chars. |
| POST | `/api/auth/login` | `{ email, password }` → 200, sets cookie. Generic error on failure. |
| POST | `/api/auth/logout` | Deletes the session row, clears cookie → 204 |
| GET | `/api/auth/me` | Current user |

### Prompts
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/prompts` | Query: `q`, `categoryId`, `tag`, `favorite=true`, `collectionId`, `sort=createdAt\|updatedAt`, `order`, `page`, `pageSize` |
| POST | `/api/prompts` | Creates prompt + version 1 in one transaction |
| GET | `/api/prompts/:id` | Includes current version and variable metadata |
| PUT | `/api/prompts/:id` | Metadata (title, description, category, tags). If `template` or variables changed, creates a new version |
| DELETE | `/api/prompts/:id` | Execution history is kept (link set to null) |
| POST | `/api/prompts/:id/duplicate` | New prompt "Copy of ..." with version 1 |

### Versions
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/prompts/:id/versions` | List, newest first |
| GET | `/api/prompts/:id/versions/:versionId` | One version; comparison is done client-side from two versions |
| POST | `/api/prompts/:id/versions` | `{ template, variables?, changeNote? }` → new version, becomes current |
| POST | `/api/prompts/:id/versions/:versionId/restore` | Copies that version into a **new** version |

### Execution
| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/prompts/:id/execute` | `{ values: {name: string}, versionId?, temperature? }` |
| POST | `/api/executions/:id/retry` | New execution with the same values |
| GET | `/api/executions` | Filters: `promptId`, `status`, `provider`, pagination |
| GET | `/api/executions/:id` | Full record |
| DELETE | `/api/executions/:id` | Remove one history entry |

### Categories, Collections, Favorites
| Method | Path | Notes |
|--------|------|-------|
| GET / POST | `/api/categories` | |
| PUT / DELETE | `/api/categories/:id` | Prompts become uncategorized |
| GET / POST | `/api/collections` | |
| PUT / DELETE | `/api/collections/:id` | |
| PUT / DELETE | `/api/collections/:id/prompts/:promptId` | Add / remove membership |
| GET | `/api/favorites` | |
| PUT / DELETE | `/api/favorites/:promptId` | Idempotent |

### Dashboard, Import/Export
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/dashboard` | Totals, favorites, executions, recent activity, recently modified, most used, category distribution; all computed from DB |
| GET | `/api/export` | Download JSON (format below) |
| POST | `/api/import` | `{ file: <export JSON>, dryRun?: boolean, onDuplicate: "skip" \| "rename" }` |

`/api/export` and `/api/import` are top-level to avoid clashing with `/api/prompts/:id`.

## Examples

**Register**

```http
POST /api/auth/register
{ "email": "jayant@example.com", "password": "correct horse battery", "displayName": "Jayant" }
→ 201  Set-Cookie: pv_session=...; HttpOnly; Secure; SameSite=Lax
{ "user": { "id": "clx...", "email": "jayant@example.com", "displayName": "Jayant" } }
```

**Create prompt**

```http
POST /api/prompts
{ "title": "Explain a concept", "categoryId": "clx...", "tags": ["learning"],
  "template": "Explain {{topic}} using {{language}} for {{audience}}.",
  "variables": [ { "name": "audience", "required": false, "defaultValue": "beginners" } ] }
→ 201  { "id": "clx...", "currentVersion": { "versionNumber": 1, "variables": ["topic","language","audience"] } }
```

**Execute — success**

```http
POST /api/prompts/clx.../execute
{ "values": { "topic": "recursion", "language": "JavaScript" } }
→ 200 { "id": "clx...", "status": "SUCCESS", "provider": "GEMINI", "model": "<GEMINI_MODEL>",
        "response": "...", "totalTokens": 412, "latencyMs": 1830 }
```

**Execute — missing variable**

```http
→ 400 { "error": { "code": "MISSING_VARIABLES", "message": "Missing required variables",
                   "details": [ { "path": "values.topic", "message": "Required" } ] } }
```

**Execute — provider failure** (history row saved with `status: "ERROR"`)

```http
→ 502 { "error": { "code": "PROVIDER_UNAVAILABLE", "message": "The AI provider is unavailable. Try again." } }
```

## Export format (schemaVersion 1)

```json
{ "schemaVersion": 1, "exportedAt": "2026-11-06T10:00:00Z",
  "categories": ["Coding"],
  "prompts": [ { "title": "...", "description": "...", "category": "Coding", "tags": [],
                 "template": "... {{topic}} ...",
                 "variables": [ { "name": "topic", "description": "", "defaultValue": null, "required": true } ] } ],
  "collections": [ { "name": "...", "promptTitles": ["..."] } ] }
```

Import rules: strict schema validation; unknown fields stripped; client-supplied IDs ignored; everything is created under the authenticated user; limits of 5 MB, 500 prompts, 50,000 chars per template. A prompt with the same title and identical template is a duplicate. Same title with a different template is a conflict handled by `onDuplicate`. `dryRun` returns counts and errors without writing.

## Rate limits (configurable via env)

| Scope | Default |
|-------|---------|
| All `/api` requests | 300 per 15 min per IP |
| Register and login | 10 per 15 min per IP |
| Execute | 10 per minute per user, 100 per day per user (counted from `Execution`) |
