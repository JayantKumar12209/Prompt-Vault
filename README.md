# PromptVault

PromptVault is a secure prompt management platform designed to help users create, organize, version, and manage reusable AI prompts.

> **Project status:** Backend implementation in progress. Core prompt management, authentication, categories, favorites, and collections are implemented. Frontend and AI execution are planned.

## Current Features

- **Authentication:** User registration, login, logout, and authenticated user details.
- **Session security:** Random session tokens, hashed token storage, and HTTP-only cookies.
- **Prompt management:** Create, view, search, update, and delete prompts.
- **Prompt versioning:** Content changes create new prompt versions.
- **Variables:** Detect and validate prompt placeholders and variable definitions.
- **Categories:** Create, list, rename, and delete personal categories.
- **Favorites:** Add, list, and remove favorite prompts.
- **Collections:** Create and manage collections, and add or remove prompts.
- **Ownership checks:** Protected resources are scoped to the authenticated user.
- **Health checks:** Liveness and database readiness endpoints.
- **Validation and error handling:** Request validation, structured errors, request IDs, and security middleware.

## Technology Stack

| Area | Technologies |
|---|---|
| Backend | Node.js, TypeScript, Express 5 |
| Database | PostgreSQL, Neon |
| ORM | Prisma 7 |
| Authentication | Argon2id, HTTP-only session cookies |
| Validation | Zod |
| Logging | Pino |
| Security middleware | Helmet, Origin and JSON content-type checks |
| Testing | Node.js test runner, tsx |
| Frontend | Planned: React, Vite, Tailwind CSS |

## Repository Structure

```text
PromptVault/
├── backend/
│   ├── prisma/
│   │   ├── migrations/
│   │   └── schema.prisma
│   ├── src/
│   │   ├── auth/
│   │   ├── config/
│   │   ├── middleware/
│   │   └── routes/
│   └── test/
├── frontend/
├── shared/
├── docs/
│   ├── API_DOCUMENTATION.md
│   ├── DATABASE_DESIGN.md
│   ├── SECURITY.md
│   └── SYSTEM_ARCHITECTURE.md
├── package.json
└── README.md
```

The frontend directory is currently a scaffold. The implemented application functionality is in the backend.

## Getting Started

### Requirements

- Node.js 22.18.0 or later
- npm
- A PostgreSQL database
- Neon database connection strings, or compatible PostgreSQL connection strings

### 1. Clone the repository

```bash
git clone https://github.com/JayantKumar12209/Prompt-Vault.git
cd Prompt-Vault
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the backend environment example:

```powershell
Copy-Item backend/.env.example backend/.env
```

Configure the following values in `backend/.env`:

| Variable | Purpose |
|---|---|
| `NODE_ENV` | Application environment |
| `PORT` | Backend server port |
| `FRONTEND_ORIGIN` | Allowed frontend origin |
| `LOG_LEVEL` | Application log level |
| `DATABASE_URL` | Pooled PostgreSQL connection for application runtime |
| `DIRECT_URL` | Direct PostgreSQL connection for Prisma CLI and migrations |

Do not commit `.env` files or expose database credentials.

### 4. Apply database migrations

After configuring `DIRECT_URL`, run:

```powershell
cd backend
npx prisma migrate deploy
cd ..
```

This applies pending migrations to the configured database.

### 5. Start the backend

From the repository root:

```bash
npm run dev:backend
```

The backend runs on port `4000` by default.

## API Overview

All API routes are mounted under `/api`.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health/` | Liveness check |
| GET | `/api/health/ready` | Database readiness check |
| POST | `/api/auth/register` | Register a user |
| POST | `/api/auth/login` | Log in |
| GET | `/api/auth/me` | Get the authenticated user |
| POST | `/api/auth/logout` | Log out |
| GET, POST, PATCH, DELETE | `/api/prompts` | Manage prompts |
| GET, POST, PATCH, DELETE | `/api/categories` | Manage categories |
| GET, POST, DELETE | `/api/favorites` | Manage favorites |
| GET, POST, PATCH, DELETE | `/api/collections` | Manage collections |
| GET, POST, DELETE | `/api/collections/:id/prompts` | Manage collection membership |

Protected endpoints require a valid authenticated session. See [API Documentation](docs/API_DOCUMENTATION.md) for route details, request formats, and responses.

## Development Commands

Run these commands from the repository root.

| Command | Description |
|---|---|
| `npm run dev:backend` | Start the backend in development mode |
| `npm test` | Run shared and backend tests |
| `npm run typecheck` | Type-check shared and backend packages |
| `npm run build` | Build shared and backend packages |

## Testing

The current automated test suite covers shared utilities and backend API behavior.

The latest verified results:

- Shared tests: 8 passed
- Backend tests: 30 passed
- Total: 38 passed

The backend route tests use an injected fake Prisma client. These results verify application behavior without requiring a live database for each test. They are not a substitute for end-to-end testing against a live PostgreSQL database.

## Database Status

The Prisma schema has been validated and the initial migration has been applied to the configured Neon database.

The migration status check reported that the database schema is up to date.

See [Database Design](docs/DATABASE_DESIGN.md) for the data model and migration details.

## Security

Security measures currently implemented include:

- Argon2id password hashing
- Random session tokens with hashed token storage
- HTTP-only session cookies
- Authentication and resource ownership checks
- Zod request validation
- Login rate limiting
- Helmet security headers
- Origin and JSON content-type checks for state-changing requests
- Request size limit and centralized error handling

Not every planned security control has been implemented. See [Security Documentation](docs/SECURITY.md) for implementation status and remaining work.

## Documentation

- [System Architecture](docs/SYSTEM_ARCHITECTURE.md)
- [API Documentation](docs/API_DOCUMENTATION.md)
- [Database Design](docs/DATABASE_DESIGN.md)
- [Security Documentation](docs/SECURITY.md)

## Planned Work

- Complete the React frontend
- Integrate server-side AI prompt execution
- Add execution history and related functionality
- Expand automated testing, including live database integration tests
- Complete deployment and production-readiness checks

## Project Disclaimer

PromptVault is an actively developed portfolio project. Features described as planned or in progress should not be considered available in the current implementation.
