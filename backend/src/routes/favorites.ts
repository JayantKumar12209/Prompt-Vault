
import { Router } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { getPrismaClient } from "../config/database.js";
import { AppError } from "../errors/app-error.js";
import { createRequireAuth } from "../middleware/require-auth.js";

export function createFavoritesRouter(
  getClient: () => PrismaClient = getPrismaClient
): Router {
  const router = Router();
  const requireAuth = createRequireAuth(getClient);

  function notFound(): AppError {
    return new AppError(
      404,
      "PROMPT_NOT_FOUND",
      "Prompt was not found"
    );
  }

  function favoriteNotFound(): AppError {
    return new AppError(
      404,
      "FAVORITE_NOT_FOUND",
      "Favorite was not found"
    );
  }

  function duplicateFavorite(): AppError {
    return new AppError(
      409,
      "FAVORITE_ALREADY_EXISTS",
      "This prompt is already in your favorites."
    );
  }

  function isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    );
  }

  // Add an owned prompt to favorites.
  router.post("/:promptId", requireAuth, async (req, res, next) => {
    try {
      const promptId = req.params.promptId;

      if (typeof promptId !== "string" || promptId.length === 0) {
        next(notFound());
        return;
      }

      const client = getClient();

      const prompt = await client.prompt.findFirst({
        where: {
          id: promptId,
          userId: req.auth!.userId
        },
        select: { id: true }
      });

      if (!prompt) {
        next(notFound());
        return;
      }

      const favorite = await client.favorite.create({
        data: {
          userId: req.auth!.userId,
          promptId
        },
        include: { prompt: true }
      });

      res.status(201).json({ favorite });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        next(duplicateFavorite());
        return;
      }

      next(error);
    }
  });

  // List the authenticated user's favorites.
  router.get("/", requireAuth, async (req, res, next) => {
    try {
      const favorites = await getClient().favorite.findMany({
        where: { userId: req.auth!.userId },
        orderBy: { createdAt: "desc" },
        include: { prompt: true }
      });

      res.status(200).json({ favorites });
    } catch (error) {
      next(error);
    }
  });

  // Remove a prompt from favorites.
  router.delete("/:promptId", requireAuth, async (req, res, next) => {
    try {
      const promptId = req.params.promptId;

      if (typeof promptId !== "string" || promptId.length === 0) {
        next(favoriteNotFound());
        return;
      }

      const result = await getClient().favorite.deleteMany({
        where: {
          userId: req.auth!.userId,
          promptId
        }
      });

      if (result.count === 0) {
        next(favoriteNotFound());
        return;
      }

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const favoritesRouter = createFavoritesRouter();
