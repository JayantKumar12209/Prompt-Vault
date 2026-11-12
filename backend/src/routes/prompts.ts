import { Router } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { z } from "zod";
import { detectVariables } from "@prompt-vault/shared";
import { getPrismaClient } from "../config/database.js";
import { AppError } from "../errors/app-error.js";
import { createRequireAuth } from "../middleware/require-auth.js";

export function createPromptsRouter(getClient: () => PrismaClient = getPrismaClient): Router {
const router = Router();
const requireAuth = createRequireAuth(getClient);

const variableSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,49}$/),
  description: z.string().trim().max(300).nullable().optional(),
  defaultValue: z.string().max(10000).nullable().optional(),
  required: z.boolean().optional()
}).strict();

const createPromptSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  template: z.string().min(1).max(50000),
  categoryId: z.string().min(1).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  variables: z.array(variableSchema).max(50).optional()
}).strict();

function validationError(message: string): AppError {
  return new AppError(400, "VALIDATION_ERROR", message);
}

function notFound(): AppError {
  return new AppError(404, "PROMPT_NOT_FOUND", "Prompt was not found");
}

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = createPromptSchema.safeParse(req.body);
    if (!parsed.success) {
      next(validationError("Provide a title, template, and valid optional prompt metadata."));
      return;
    }

    const { title, description, template, categoryId, tags, variables } = parsed.data;
    const detected = detectVariables(template);

    if (detected.malformed.length > 0) {
      next(validationError("The template contains malformed variable placeholders."));
      return;
    }

    const suppliedVariables = variables ?? [];
    const suppliedNames = suppliedVariables.map((variable) => variable.name);
    if (new Set(suppliedNames).size !== suppliedNames.length) {
      next(validationError("Variable definitions must not contain duplicate names."));
      return;
    }

    if (suppliedNames.some((name) => !detected.variables.includes(name))) {
      next(validationError("Variable definitions must match placeholders used in the template."));
      return;
    }

    const client = getClient();
    if (categoryId) {
      const category = await client.category.findFirst({
        where: { id: categoryId, userId: req.auth!.userId },
        select: { id: true }
      });
      if (!category) {
        next(validationError("The selected category does not exist."));
        return;
      }
    }

    const variableByName = new Map(suppliedVariables.map((variable) => [variable.name, variable]));
    const created = await client.$transaction(async (tx) => {
      const prompt = await tx.prompt.create({
        data: {
          userId: req.auth!.userId,
          categoryId: categoryId ?? null,
          title,
          description: description ?? null,
          tags: [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))]
        }
      });

      const version = await tx.promptVersion.create({
        data: {
          promptId: prompt.id,
          versionNumber: 1,
          template,
          variables: {
            create: detected.variables.map((name) => {
              const metadata = variableByName.get(name);
              return {
                name,
                description: metadata?.description ?? null,
                defaultValue: metadata?.defaultValue ?? null,
                required: metadata?.required ?? true
              };
            })
          }
        },
        include: { variables: true }
      });

      await tx.prompt.update({
        where: { id: prompt.id },
        data: { currentVersionId: version.id }
      });

      return { ...prompt, currentVersion: version };
    });

    res.status(201).json({ prompt: created });
  } catch (error) {
    next(error);
  }
});

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const querySchema = z.object({
      search: z.string().trim().max(100).optional(),
      categoryId: z.string().min(1).optional(),
      tag: z.string().trim().min(1).max(30).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20)
    }).strict();
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      next(validationError("Invalid prompt list filters."));
      return;
    }

    const { search, categoryId, tag, page, limit } = parsed.data;
    const where = {
      userId: req.auth!.userId,
      ...(categoryId ? { categoryId } : {}),
      ...(tag ? { tags: { has: tag } } : {}),
      ...(search ? {
        OR: [
          { title: { contains: search, mode: "insensitive" as const } },
          { description: { contains: search, mode: "insensitive" as const } }
        ]
      } : {})
    };

    const client = getClient();
    const [prompts, total] = await client.$transaction([
      client.prompt.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          category: true,
          currentVersion: { include: { variables: true } }
        }
      }),
      client.prompt.count({ where })
    ]);

    res.status(200).json({
      prompts,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    next(error);
  }
});


const updatePromptSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  template: z.string().min(1).max(50000).optional(),
  categoryId: z.string().min(1).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  variables: z.array(variableSchema).max(50).optional()
}).strict().refine((value) => Object.keys(value).length > 0);

router.patch("/:id", requireAuth, async (req, res, next) => {
  try {
    const promptId = req.params.id;
    if (typeof promptId !== "string" || promptId.length === 0) {
      next(notFound());
      return;
    }

    const parsed = updatePromptSchema.safeParse(req.body);
    if (!parsed.success) {
      next(validationError("Provide at least one valid prompt field to update."));
      return;
    }

    const client = getClient();
    const existing = await client.prompt.findFirst({
      where: { id: promptId, userId: req.auth!.userId },
      include: {
        currentVersion: { include: { variables: true } },
        versions: { select: { versionNumber: true } }
      }
    });

    if (!existing || !existing.currentVersion) {
      next(notFound());
      return;
    }

    // Capture the checked relation before entering the transaction callback.
    const existingVersion = existing.currentVersion;
    const changes = parsed.data;
    if (changes.categoryId) {
      const category = await client.category.findFirst({
        where: { id: changes.categoryId, userId: req.auth!.userId },
        select: { id: true }
      });
      if (!category) {
        next(validationError("The selected category does not exist."));
        return;
      }
    }

    const nextTemplate = changes.template ?? existingVersion.template;
    const detected = detectVariables(nextTemplate);
    if (detected.malformed.length > 0) {
      next(validationError("The template contains malformed variable placeholders."));
      return;
    }

    const suppliedVariables = changes.variables ?? [];
    const suppliedNames = suppliedVariables.map((variable) => variable.name);
    if (new Set(suppliedNames).size !== suppliedNames.length) {
      next(validationError("Variable definitions must not contain duplicate names."));
      return;
    }
    if (suppliedNames.some((name) => !detected.variables.includes(name))) {
      next(validationError("Variable definitions must match placeholders used in the template."));
      return;
    }

    const previousVariables = new Map(
      existingVersion.variables.map((variable) => [variable.name, variable])
    );
    const suppliedByName = new Map(suppliedVariables.map((variable) => [variable.name, variable]));
    const nextVariables = detected.variables.map((name) => {
      const previous = previousVariables.get(name);
      const supplied = suppliedByName.get(name);
      return {
        name,
        description: supplied?.description !== undefined
          ? supplied.description
          : previous?.description ?? null,
        defaultValue: supplied?.defaultValue !== undefined
          ? supplied.defaultValue
          : previous?.defaultValue ?? null,
        required: supplied?.required ?? previous?.required ?? true
      };
    });

    const variablesChanged = nextVariables.length !== existingVersion.variables.length ||
      nextVariables.some((variable) => {
        const previous = previousVariables.get(variable.name);
        return !previous ||
          variable.description !== previous.description ||
          variable.defaultValue !== previous.defaultValue ||
          variable.required !== previous.required;
      });
    const contentChanged = nextTemplate !== existingVersion.template || variablesChanged;

    const data: Record<string, unknown> = {};
    if (changes.title !== undefined) data.title = changes.title;
    if (changes.description !== undefined) data.description = changes.description;
    if (changes.categoryId !== undefined) data.categoryId = changes.categoryId;
    if (changes.tags !== undefined) {
      data.tags = [...new Set(changes.tags.map((tag) => tag.trim()).filter(Boolean))];
    }

    const updated = await client.$transaction(async (tx) => {
      let currentVersionId = existingVersion.id;
      let currentVersion = existingVersion;

      if (contentChanged) {
        const versionNumber = Math.max(
          ...existing.versions.map((version) => version.versionNumber),
          0
        ) + 1;
        const version = await tx.promptVersion.create({
          data: {
            promptId,
            versionNumber,
            template: nextTemplate,
            variables: { create: nextVariables }
          },
          include: { variables: true }
        });
        currentVersionId = version.id;
        currentVersion = version;
      }

      const prompt = await tx.prompt.update({
        where: { id: promptId },
        data: { ...data, ...(contentChanged ? { currentVersionId } : {}) }
      });

      return { ...prompt, currentVersion };
    });

    res.status(200).json({ prompt: updated });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const promptId = req.params.id;
    if (typeof promptId !== "string" || promptId.length === 0) {
      next(notFound());
      return;
    }

    const result = await getClient().prompt.deleteMany({
      where: { id: promptId, userId: req.auth!.userId }
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

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const promptId = req.params.id;
    if (typeof promptId !== "string" || promptId.length === 0) {
      next(notFound());
      return;
    }

    const prompt = await getClient().prompt.findFirst({
      where: { id: promptId, userId: req.auth!.userId },
      include: {
        category: true,
        currentVersion: { include: { variables: true } },
        versions: {
          orderBy: { versionNumber: "desc" },
          select: { id: true, versionNumber: true, changeNote: true, createdAt: true }
        }
      }
    });

    if (!prompt) {
      next(notFound());
      return;
    }

    res.status(200).json({ prompt });
  } catch (error) {
    next(error);
  }
});

  return router;
}

export const promptsRouter = createPromptsRouter();
