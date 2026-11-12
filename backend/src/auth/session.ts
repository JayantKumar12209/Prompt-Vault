import { createHash, randomBytes } from "node:crypto";
import type { CookieOptions, Request } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";
import { getPrismaClient } from "../config/database.js";

export const SESSION_COOKIE_NAME = "pv_session";
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_MS
  };
}

export function sessionClearCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/"
  };
}

export function readSessionToken(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  const matching = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));

  if (matching.length !== 1) return null;

  const cookie = matching[0];
  if (cookie === undefined) return null;

  const token = cookie.slice(SESSION_COOKIE_NAME.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function createSession(
  userId: string,
  client: PrismaClient = getPrismaClient()
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await client.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt
    }
  });

  return token;
}
