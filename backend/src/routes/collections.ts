
import { Router } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { z } from "zod";
import { getPrismaClient } from "../config/database.js";
import { AppError } from "../errors/app-error.js";
import { createRequireAuth } from "../middleware/require-auth.js";

export function createCollectionsRouter(
  getClient: () => PrismaClient = getPrismaClient
): Router {
  const router = Router();
  const requireAuth = createRequireAuth(getClient);

  const createSchema = z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).nullable().optional()
  }).strict();

  const updateSchema = z.object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional()
  }).strict().refine(
    (data) => data.name !== undefined || data.description !== undefined
  );

  const addPromptSchema = z.object({
    promptId: z.string().trim().min(1)
  }).strict();

  function collectionNotFound(): AppError {
    return new AppError(404, "COLLECTION_NOT_FOUND", "Collection was not found");
  }

  function promptNotFound(): AppError {
    return new AppError(404, "PROMPT_NOT_FOUND", "Prompt was not found");
  }

  function membershipNotFound(): AppError {
    return new AppError(
      404,
      "COLLECTION_PROMPT_NOT_FOUND",
      "Prompt was not found in this collection"
    );
  }

  function validationError(): AppError {
    return new AppError(
      400,
      "VALIDATION_ERROR",
      "Provide valid collection details or a prompt ID."
    );
  }

  function duplicateNameError(): AppError {
    return new AppError(
      409,
      "COLLECTION_ALREADY_EXISTS",
      "A collection with this name already exists."
    );
  }

  function duplicatePromptError(): AppError {
    return new AppError(
      409,
      "PROMPT_ALREADY_IN_COLLECTION",
      "This prompt is already in the collection."
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

  async function findOwnedCollection(
    collectionId: string,
    userId: string
  ) {
    return getClient().collection.findFirst({
      where: { id: collectionId, userId },
      select: { id: true }
    });
  }

  // Create a collection.
  router.post("/", requireAuth, async (req, res, next) => {
    try {
      const parsed = createSchema.safeParse(req.body);

      if (!parsed.success) {
        next(validationError());
        return;
      }

      const collection = await getClient().collection.create({
        data: {
          userId: req.auth!.userId,
          name: parsed.data.name,
          description: parsed.data.description ?? null
        }
      });

      res.status(201).json({ collection });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        next(duplicateNameError());
        return;
      }
      next(error);
    }
  });

  // List the authenticated user's collections.
  router.get("/", requireAuth, async (req, res, next) => {
    try {
      const collections = await getClient().collection.findMany({
        where: { userId: req.auth!.userId },
        orderBy: { updatedAt: "desc" }
      });

      res.status(200).json({ collections });
    } catch (error) {
      next(error);
    }
  });

  // Update a collection's name or description.
  router.patch("/:id", requireAuth, async (req, res, next) => {
    try {
      const collectionId = req.params.id;

      if (typeof collectionId !== "string" || !collectionId) {
        next(collectionNotFound());
        return;
      }

      const parsed = updateSchema.safeParse(req.body);

      if (!parsed.success) {
        next(validationError());
        return;
      }

      const client = getClient();
      const existing = await client.collection.findFirst({
        where: {
          id: collectionId,
          userId: req.auth!.userId
        },
        select: { id: true }
      });

      if (!existing) {
        next(collectionNotFound());
        return;
      }

     const updateData = {
  ...(parsed.data.name !== undefined
    ? { name: parsed.data.name }
    : {}),
  ...(parsed.data.description !== undefined
    ? { description: parsed.data.description }
    : {})
};

const collection = await client.collection.update({
  where: { id: collectionId },
  data: updateData
});

      res.status(200).json({ collection });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        next(duplicateNameError());
        return;
      }
      next(error);
    }
  });

  // Delete a collection and its memberships.
  router.delete("/:id", requireAuth, async (req, res, next) => {
    try {
      const collectionId = req.params.id;

      if (typeof collectionId !== "string" || !collectionId) {
        next(collectionNotFound());
        return;
      }

      const result = await getClient().collection.deleteMany({
        where: {
          id: collectionId,
          userId: req.auth!.userId
        }
      });

      if (result.count === 0) {
        next(collectionNotFound());
        return;
      }

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  // List prompts belonging to an owned collection.
  router.get("/:id/prompts", requireAuth, async (req, res, next) => {
    try {
      const collectionId = req.params.id;

      if (typeof collectionId !== "string" || !collectionId) {
        next(collectionNotFound());
        return;
      }

      const collection = await findOwnedCollection(
        collectionId,
        req.auth!.userId
      );

      if (!collection) {
        next(collectionNotFound());
        return;
      }

      const collectionPrompts = await getClient().collectionPrompt.findMany({
        where: { collectionId },
        orderBy: { addedAt: "desc" },
        include: { prompt: true }
      });

      res.status(200).json({ collectionPrompts });
    } catch (error) {
      next(error);
    }
  });

  // Add an owned prompt to an owned collection.
  router.post("/:id/prompts", requireAuth, async (req, res, next) => {
    try {
      const collectionId = req.params.id;

      if (typeof collectionId !== "string" || !collectionId) {
        next(collectionNotFound());
        return;
      }

      const parsed = addPromptSchema.safeParse(req.body);

      if (!parsed.success) {
        next(validationError());
        return;
      }

      const userId = req.auth!.userId;
      const client = getClient();

      const collection = await client.collection.findFirst({
        where: { id: collectionId, userId },
        select: { id: true }
      });

      if (!collection) {
        next(collectionNotFound());
        return;
      }

      const prompt = await client.prompt.findFirst({
        where: { id: parsed.data.promptId, userId },
        select: { id: true }
      });

      if (!prompt) {
        next(promptNotFound());
        return;
      }

      const collectionPrompt = await client.collectionPrompt.create({
        data: {
          collectionId,
          promptId: parsed.data.promptId
        },
        include: { prompt: true }
      });

      res.status(201).json({ collectionPrompt });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        next(duplicatePromptError());
        return;
      }
      next(error);
    }
  });

  // Remove a prompt from an owned collection.
  router.delete(
    "/:id/prompts/:promptId",
    requireAuth,
    async (req, res, next) => {
      try {
        const collectionId = req.params.id;
        const promptId = req.params.promptId;

        if (
          typeof collectionId !== "string" || !collectionId ||
          typeof promptId !== "string" || !promptId
        ) {
          next(membershipNotFound());
          return;
        }

        const userId = req.auth!.userId;
        const client = getClient();

        const collection = await client.collection.findFirst({
          where: { id: collectionId, userId },
          select: { id: true }
        });

        if (!collection) {
          next(collectionNotFound());
          return;
        }

        const prompt = await client.prompt.findFirst({
          where: { id: promptId, userId },
          select: { id: true }
        });

        if (!prompt) {
          next(promptNotFound());
          return;
        }

        const result = await client.collectionPrompt.deleteMany({
          where: { collectionId, promptId }
        });

        if (result.count === 0) {
          next(membershipNotFound());
          return;
        }

        res.status(204).end();
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export const collectionsRouter = createCollectionsRouter();
