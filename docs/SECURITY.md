# PromptVault — Security Design

> **Status: DESIGN (Phase 2).** Controls below are planned. Each is marked "implemented" and linked to its test only after it is built and tested.

## Threats and controls

| Threat | Control | Test planned |
|--------|---------|--------------|
| Password theft from DB | Argon2id via `@node-rs/argon2`, OWASP-recommended minimum parameters (m=19 MiB, t=2, p=1) to start, tuned to the host. Password length 10–128. Never logged. | Hash is not plaintext; wrong password rejected |
| User enumeration | Same error and similar timing for unknown email vs wrong password (dummy hash verification when user not found). Register may reveal "email taken". | Login error identical for both cases |
| Brute force | Login/register limit: 10 per 15 min per IP | 11th attempt returns 429 |
| Session theft | 32 random bytes (base64url) in cookie `pv_session`: httpOnly, Secure in production, SameSite=Lax, path `/`. Only the SHA-256 hash is stored. 7-day expiry, extended at most once per day. Logout deletes the row. | Expired and logged-out tokens rejected |
| CSRF | SameSite=Lax; `Origin` must match the allowed origin on POST/PUT/PATCH/DELETE; JSON content type required | Request with foreign Origin gets 403 |
| IDOR / data leakage | Every query scoped by `userId`; foreign resources return 404 | Two-user integration tests for every resource |
| SQL injection | Prisma parameterized queries only; no raw SQL with interpolation | Code review rule |
| XSS | React text rendering only; no `dangerouslySetInnerHTML`; Markdown (if added) without raw HTML; helmet CSP | Test that `<script>` in title/response renders as text |
| Variable injection | Single-pass render; values are never re-expanded or evaluated; output is plain text | Unit tests (see below) |
| Malicious import | Strict Zod schema; size and count caps; unknown fields stripped; IDs ignored; created under current user | Import tests with oversized, malformed and hostile files |
| Oversized requests | 100 KB default body limit; import route 5 MB | 413 test |
| AI key leakage | Key only in backend env; never sent to the client or logged; `.env` git-ignored; `.env.example` has placeholders | Search of build output for key patterns |
| Prompt abuse / cost | Per-user limits (10/min, 100/day), 30 s timeout, max output tokens cap | Quota test |
| Information disclosure | Central error handler; no stack traces or DB errors in responses; request ID for support | Production-mode error test |
| Dependency risk | Lockfile committed, `npm audit` in CI, pinned versions | CI step |

## Variable engine safety tests (unit)

- Value containing `{{other}}` is inserted literally.
- Value containing `<script>` is inserted as text.
- Missing required variable fails with its name.
- Duplicate and repeated placeholders replaced everywhere.
- Invalid names (`{{1a}}`, `{{a-b}}`) reported, not executed.
- `\{{x}}` renders as literal `{{x}}`.
- Length limits enforced.

## Logging

pino with redaction of cookies, authorization headers, passwords, and prompt/response bodies. Log request ID, user ID, route, status, latency.

## Secrets handling

Never commit `.env`. Never paste the Gemini key or database URLs into chat, issues or screenshots. If a secret is exposed, rotate it immediately (Neon database password, Gemini key). Rotating the database password also invalidates nothing in sessions, so delete rows in `Session` if you suspect session compromise.

## Known unknowns (to verify at deployment)

- `trust proxy` hop count behind Vercel rewrite + Render, required for correct per-IP rate limiting.
- Whether the chosen host forwards the original `Origin`/`Host` headers through the rewrite as expected.
- Cookie behaviour on Vercel preview URLs versus the production domain.

## Out of scope for now

Email verification, password reset, MFA, OAuth login, admin roles. Listed as future improvements, not claimed.
