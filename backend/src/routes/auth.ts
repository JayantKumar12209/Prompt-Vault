import { randomBytes } from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import {
  createSession,
  hashSessionToken,
  sessionClearCookieOptions,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS
} from "../auth/session.js";
import { dummyPasswordHash, hashPassword, verifyPassword } from "../auth/password.js";
import { getPrismaClient } from "../config/database.js";
import { AppError } from "../errors/app-error.js";
import { requireAuth } from "../middleware/require-auth.js";

export const authRouter = Router();

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many authentication attempts. Try again later.",
        requestId: req.requestId
      }
    });
  }
});

const registerSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(128),
  displayName: z.string().trim().min(1).max(100).optional()
}).strict();

const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128)
}).strict();

function validationError(message: string): AppError {
  return new AppError(400, "VALIDATION_ERROR", message);
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: unknown }).code === "P2002";
}

authRouter.post("/register", authRateLimiter, async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      next(validationError("Provide a valid email, a password of 10–128 characters, and an optional display name of 1–100 characters."));
      return;
    }

    const { email, password, displayName } = parsed.data;
    const passwordHash = await hashPassword(password);

    // User and first session are committed atomically.
    const created = await getPrismaClient().$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordHash, displayName: displayName ?? null }
      });
      const token = randomBytes(32).toString("base64url");

      await tx.session.create({
        data: {
          userId: user.id,
          tokenHash: hashSessionToken(token),
          expiresAt: new Date(Date.now() + SESSION_DURATION_MS)
        }
      });

      return { user, token };
    });

    res.cookie(SESSION_COOKIE_NAME, created.token, sessionCookieOptions());
    res.status(201).json({
      user: {
        id: created.user.id,
        email: created.user.email,
        displayName: created.user.displayName
      }
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      next(new AppError(409, "EMAIL_TAKEN", "An account with this email already exists"));
      return;
    }
    next(error);
  }
});

authRouter.post("/login", authRateLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      next(validationError("Provide a valid email and password."));
      return;
    }

    const { email, password } = parsed.data;
    const user = await getPrismaClient().user.findUnique({ where: { email } });
    const storedHash = user?.passwordHash ?? await dummyPasswordHash;
    const passwordMatches = await verifyPassword(storedHash, password);

    if (!user || !passwordMatches) {
      next(new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect"));
      return;
    }

    const token = await createSession(user.id);
    res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());
    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName
      }
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", requireAuth, (req, res) => {
  if (!req.auth) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required" } });
    return;
  }

  res.status(200).json({
    user: {
      id: req.auth.userId,
      email: req.auth.email,
      displayName: req.auth.displayName
    }
  });
});

authRouter.post("/logout", requireAuth, async (req, res, next) => {
  try {
    if (req.auth) {
      await getPrismaClient().session.deleteMany({ where: { id: req.auth.sessionId } });
    }
    res.clearCookie(SESSION_COOKIE_NAME, sessionClearCookieOptions());
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
