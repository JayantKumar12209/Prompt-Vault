import type { RequestHandler } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { getPrismaClient } from "../config/database.js";
import { AppError } from "../errors/app-error.js";
import { hashSessionToken, readSessionToken } from "../auth/session.js";

export function createRequireAuth(
  getClient: () => PrismaClient = getPrismaClient
): RequestHandler {
  return async (req, _res, next) => {
    try {
      const token = readSessionToken(req);
      if (!token) {
        next(new AppError(401, "UNAUTHENTICATED", "Authentication is required"));
        return;
      }

      const tokenHash = hashSessionToken(token);
      const session = await getClient().session.findUnique({
        where: { tokenHash },
        include: { user: { select: { id: true, email: true, displayName: true } } }
      });

      if (!session) {
        next(new AppError(401, "UNAUTHENTICATED", "Authentication is required"));
        return;
      }

      if (session.expiresAt <= new Date()) {
        await getClient().session.deleteMany({ where: { id: session.id } });
        next(new AppError(401, "UNAUTHENTICATED", "Authentication is required"));
        return;
      }

      req.auth = {
        userId: session.user.id,
        sessionId: session.id,
        email: session.user.email,
        displayName: session.user.displayName
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireAuth = createRequireAuth();
