
import { Router } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { z } from "zod";
import { getPrismaClient } from "../config/database.js";
import { AppError } from "../errors/app-error.js";
import { createRequireAuth } from "../middleware/require-auth.js";

export function createCategoriesRouter(
  getClient: () => PrismaClient = getPrismaClient
): Router {
  const router = Router();
  const requireAuth = createRequireAuth(getClient);

  const createCategorySchema = z.object({
    name: z.string().trim().min(1).max(50)
  }).strict();

  const updateCategorySchema = z.object({
    name: z.string().trim().min(1).max(50)
  }).strict();

  function validationError(): AppError {
    return new AppError(
      400,
      "VALIDATION_ERROR",
      "Provide a valid category name between 1 and 50 characters."
    );
  }

  function notFound(): AppError {
    return new AppError(
      404,
      "CATEGORY_NOT_FOUND",
      "Category was not found"
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

  function duplicateNameError(): AppError {
    return new AppError(
      409,
      "CATEGORY_ALREADY_EXISTS",
      "A category with this name already exists."
    );
  }

  // Create a category.
  router.post("/", requireAuth, async (req, res, next) => {
    try {
      const parsed = createCategorySchema.safeParse(req.body);

      if (!parsed.success) {
        next(validationError());
        return;
      }

      const category = await getClient().category.create({
        data: {
          userId: req.auth!.userId,
          name: parsed.data.name
        }
      });

      res.status(201).json({ category });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        next(duplicateNameError());
        return;
      }

      next(error);
    }
  });

  // List the authenticated user's categories.
  router.get("/", requireAuth, async (req, res, next) => {
    try {
      const categories = await getClient().category.findMany({
        where: { userId: req.auth!.userId },
        orderBy: { name: "asc" }
      });

      res.status(200).json({ categories });
    } catch (error) {
      next(error);
    }
  });

  // Rename a category.
  router.patch("/:id", requireAuth, async (req, res, next) => {
    try {
      const categoryId = req.params.id;

      if (typeof categoryId !== "string" || categoryId.length === 0) {
        next(notFound());
        return;
      }

      const parsed = updateCategorySchema.safeParse(req.body);

      if (!parsed.success) {
        next(validationError());
        return;
      }

      const client = getClient();

      const existing = await client.category.findFirst({
        where: {
          id: categoryId,
          userId: req.auth!.userId
        },
        select: { id: true }
      });

      if (!existing) {
        next(notFound());
        return;
      }

      const category = await client.category.update({
        where: { id: categoryId },
        data: { name: parsed.data.name }
      });

      res.status(200).json({ category });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        next(duplicateNameError());
        return;
      }

      next(error);
    }
  });

  // Delete a category. Prisma's SetNull relation preserves its prompts.
  router.delete("/:id", requireAuth, async (req, res, next) => {
    try {
      const categoryId = req.params.id;

      if (typeof categoryId !== "string" || categoryId.length === 0) {
        next(notFound());
        return;
      }

      const result = await getClient().category.deleteMany({
        where: {
          id: categoryId,
          userId: req.auth!.userId
        }
      });

      if (result.count === 0) {
        next(notFound());
        return;
      }

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const categoriesRouter = createCategoriesRouter();
