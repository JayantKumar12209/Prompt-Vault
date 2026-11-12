# PromptVault Security Documentation

## 1. Security Status

PromptVault is an actively developed application. Security controls are implemented in several backend areas, but the application has not completed a full production security review.

This document distinguishes:

- **Implemented:** Present in the current backend implementation.
- **Partially implemented:** Some protection exists, but additional verification or hardening is needed.
- **Planned:** Not currently implemented.

## 2. Implemented Security Controls

### 2.1 Password Security

**Status: Implemented**

- Passwords are hashed using Argon2id through `@node-rs/argon2`.
- Plaintext passwords are not stored in the database.
- Passwords must contain between 10 and 128 characters.
- Login verifies the supplied password against the stored password hash.
- Unknown email addresses use dummy password-hash verification to reduce user-enumeration timing differences.
- Authentication errors use a generic invalid-credentials response.

Password reset and password recovery workflows are not implemented.

### 2.2 Session Security

**Status: Implemented**

The authentication system uses server-side sessions.

- Session tokens are generated using cryptographically secure random bytes.
- Tokens are encoded using Base64URL.
- Only the SHA-256 hash of a session token is stored in the database.
- The browser receives the token through the `pv_session` cookie.
- The cookie is HTTP-only.
- The cookie uses `SameSite=Lax`.
- The Secure cookie attribute is enabled in production.
- The cookie path is `/`.
- Sessions have a seven-day duration.
- Logout deletes the current session record and clears the cookie.

Session validation is performed by the authentication middleware before protected resources are accessed.

### 2.3 Authentication Rate Limiting

**Status: Implemented**

Registration and login routes use rate limiting.

- Limit: 10 attempts per 15 minutes per IP address.
- Standard rate-limit headers are enabled.

This limit applies to authentication routes. It should not be interpreted as a global API rate limit.

Correct client IP detection behind a reverse proxy still requires deployment verification.

### 2.4 Authentication and Resource Ownership

**Status: Implemented**

Protected endpoints use authentication middleware.

User ownership is checked when accessing protected resources, including:

- Prompts
- Categories
- Favorites
- Collections
- Collection membership

The backend scopes resource operations to the authenticated user.

Collection membership operations verify that both the collection and the prompt belong to the authenticated user.

Resources belonging to another user are generally returned as not found rather than exposing their existence.

Automated backend tests cover authentication and ownership scenarios for implemented routes.

### 2.5 Request Validation

**Status: Implemented**

- Zod schemas validate request bodies and relevant input fields.
- Strict request schemas are used where configured.
- Prompt titles, templates, tags, categories, collections, and variable definitions have validation constraints.
- Prompt variable names follow a defined identifier pattern.
- Category and collection names are validated and unique per user.
- Invalid input is rejected before the corresponding database operation.

### 2.6 Request Origin and Content-Type Checks

**Status: Implemented**

The `originCheck` middleware applies to state-changing methods:

- POST
- PUT
- PATCH
- DELETE

It requires:

- The request Origin to match the configured `FRONTEND_ORIGIN`.
- The declared Content-Type to be `application/json`.

A disallowed Origin returns HTTP 403.

A missing or unsupported JSON Content-Type returns HTTP 415.

This provides an additional request-origin and content-type check alongside the session cookie's SameSite setting. It should not be treated as a complete substitute for a deployment-specific CSRF review.

### 2.7 HTTP Security Headers

**Status: Implemented**

Helmet middleware is enabled in the Express application.

The application also disables the `X-Powered-By` response header.

### 2.8 Request Size Limit

**Status: Implemented**

The Express JSON parser has a request body limit of 100 KB.

A separate import upload limit is not implemented because the import endpoint is not yet available.

### 2.9 Error Handling and Request Identification

**Status: Implemented**

- Requests receive request IDs.
- A centralized error handler processes application errors.
- Unknown routes are handled by not-found middleware.
- Application logging uses Pino.

Production error-response behavior and comprehensive sensitive-data redaction should be reviewed as part of deployment hardening.

### 2.10 Database Access

**Status: Implemented**

- Prisma is used for database access.
- Application database operations use the Prisma client.
- Database credentials are supplied through environment variables.
- The runtime database client uses the configured database connection.
- The initial migration has been applied to the configured Neon database.

The database readiness endpoint executes a static database connectivity query.

## 3. Partially Implemented Protections and Remaining Verification

| Area | Current protection | Remaining work |
|---|---|---|
| CSRF | SameSite cookie, Origin validation, JSON content-type requirement | Review behavior across production domains, proxies, and browser deployments |
| SQL injection | Prisma-based database access | Review every database query and any future raw SQL usage |
| Information disclosure | Centralized error handling and request IDs | Verify production responses never expose stack traces, database details, or secrets |
| Logging | Pino application logger | Verify redaction of session cookies, authorization headers, passwords, and sensitive prompt data |
| Rate limiting | Authentication route limits | Configure and verify proxy-aware client IP handling; add limits for other sensitive operations where needed |
| XSS | Helmet security headers | Implement and review frontend output handling when the frontend is developed |
| Session security | Hashed session tokens and HTTP-only cookies | Perform deployment-specific cookie and session lifecycle testing |

## 4. Planned Security Work

The following protections are not currently implemented as complete application features.

### 4.1 AI Execution Protection

Planned before enabling AI execution:

- Keep provider API keys exclusively on the backend.
- Never expose provider credentials to the frontend.
- Add per-user execution rate limits and quotas.
- Set provider request timeouts.
- Limit generated output size or token usage.
- Handle provider failures without exposing internal credentials or sensitive details.
- Avoid logging sensitive prompt values and provider responses unnecessarily.

AI execution is not currently implemented in the API.

### 4.2 Import and Export Security

Import/export endpoints are not implemented.

Before adding imports, the application should include:

- Strict input schema validation.
- File-size and record-count limits.
- Validation of prompt templates and variables.
- Ownership enforcement.
- Duplicate handling.
- Protection against malicious or malformed input.

### 4.3 Frontend Security

The frontend is currently a scaffold.

Before production release:

- Review React rendering and user-generated content handling.
- Avoid unsafe HTML insertion.
- Sanitize any future rich-text or Markdown content where appropriate.
- Review Content Security Policy configuration.
- Test session handling and API requests across the deployed frontend and backend domains.

### 4.4 Dependency and Supply-Chain Security

Further work should include:

- Regular dependency updates.
- Dependency vulnerability checks.
- Automated security checks in CI.
- Review of dependency and lockfile changes.

## 5. Environment Variables and Secrets

Backend configuration is loaded from environment variables.

The example configuration is available in:

`backend/.env.example`

Environment files containing actual credentials must not be committed.

Sensitive values include:

- `DATABASE_URL`
- `DIRECT_URL`
- Future AI provider API keys
- Any other production credentials or tokens

Never publish credentials in source code, screenshots, issue reports, or repository documentation.

If a credential is exposed:

1. Revoke or rotate the affected credential.
2. Update the corresponding deployment environment variable.
3. Verify that the application can connect using the new credential.
4. Investigate whether unauthorized access may have occurred.

If session compromise is suspected, invalidate affected sessions as part of incident response.

## 6. Deployment Security Checklist

The following items require verification before production deployment:

- [ ] Configure production environment variables securely.
- [ ] Ensure database credentials are not exposed to the frontend.
- [ ] Verify production HTTPS and Secure cookie behavior.
- [ ] Verify allowed Origin configuration.
- [ ] Review reverse-proxy configuration and Express trust proxy settings.
- [ ] Verify rate limiting uses the correct client IP.
- [ ] Test session expiration and logout behavior.
- [ ] Verify production error responses do not expose internal details.
- [ ] Review sensitive-data logging and redaction.
- [ ] Run dependency vulnerability checks.
- [ ] Test authentication and ownership boundaries.
- [ ] Perform a security review of the deployed application.

## 7. Known Limitations

The following capabilities are not currently available or have not been fully verified:

- Email verification
- Password reset and recovery
- Multi-factor authentication
- OAuth login
- Administrative roles and permissions
- AI execution security controls
- Import/export validation
- Complete frontend security review
- Production deployment security verification
- Comprehensive live-database integration testing

These are future improvements, not implemented features.

## 8. Related Documentation

- [System Architecture](SYSTEM_ARCHITECTURE.md)
- [API Documentation](API_DOCUMENTATION.md)
- [Database Design](DATABASE_DESIGN.md)
