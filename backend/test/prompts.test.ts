import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { env } from "../src/config/env.js";
import { createApp } from "../src/app.js";
import { createAuthRouter } from "../src/routes/auth.js";
import { createPromptsRouter } from "../src/routes/prompts.js";
import { createCategoriesRouter } from "../src/routes/categories.js";
import { createFavoritesRouter } from "../src/routes/favorites.js";
import { createCollectionsRouter } from "../src/routes/collections.js";

function createFakePrisma() {
  const users = new Map<string, any>();
  const sessions = new Map<string, any>();
  const prompts = new Map<string, any>();
  const favorites = new Map<string, any>();
  const collections = new Map<string, any>();
  const collectionPrompts = new Map<string, any>();

  let nextId = 1;
  const id = (prefix: string) => `${prefix}-${nextId++}`;
  const fake: Record<string, any> = {};

  fake.user = {
    create: async ({ data }: any) => {
      if (users.has(data.email)) throw Object.assign(new Error("Unique"), { code: "P2002" });
      const user = { ...data, id: id("user") };
      users.set(user.email, user);
      return user;
    },
    findUnique: async ({ where }: any) => users.get(where.email) ?? null
  };
  fake.session = {
    create: async ({ data }: any) => {
      const session = { ...data, id: id("session"), createdAt: new Date() };
      sessions.set(session.id, session);
      return session;
    },
    findUnique: async ({ where }: any) => {
      const session = [...sessions.values()].find((item) => item.tokenHash === where.tokenHash);
      if (!session) return null;
      const user = [...users.values()].find((item) => item.id === session.userId);
      return user ? { ...session, user } : null;
    },
    deleteMany: async ({ where }: any) => {
      if (where.id && sessions.delete(where.id)) return { count: 1 };
      return { count: 0 };
    }
  };
 const categories = new Map<string, any>();

fake.category = {
  create: async ({ data }: any) => {
    const duplicate = [...categories.values()].some(
      (category) =>
        category.userId === data.userId &&
        category.name === data.name
    );

    if (duplicate) {
      throw Object.assign(new Error("Unique"), { code: "P2002" });
    }

    const category = {
      ...data,
      id: id("category"),
      createdAt: new Date()
    };

    categories.set(category.id, category);
    return category;
  },

  findFirst: async ({ where }: any) => {
    return (
      [...categories.values()].find(
        (category) =>
          category.id === where.id &&
          (!where.userId || category.userId === where.userId)
      ) ?? null
    );
  },

  findMany: async ({ where }: any) => {
    return [...categories.values()]
      .filter((category) => category.userId === where.userId)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  update: async ({ where, data }: any) => {
    const category = categories.get(where.id);

    if (!category) {
      throw new Error("Category not found");
    }

    const duplicate = [...categories.values()].some(
      (item) =>
        item.id !== where.id &&
        item.userId === category.userId &&
        item.name === data.name
    );

    if (duplicate) {
      throw Object.assign(new Error("Unique"), { code: "P2002" });
    }

    Object.assign(category, data);
    return category;
  },

  deleteMany: async ({ where }: any) => {
    const category = categories.get(where.id);

    if (!category || category.userId !== where.userId) {
      return { count: 0 };
    }

    categories.delete(category.id);

    // Match Prisma's onDelete: SetNull behavior.
    for (const prompt of prompts.values()) {
      if (prompt.categoryId === category.id) {
        prompt.categoryId = null;
        prompt.category = null;
      }
    }

    return { count: 1 };
  }
};
fake.favorite = {
  create: async ({ data, include }: any) => {
    const key = `${data.userId}:${data.promptId}`;

    if (favorites.has(key)) {
      throw Object.assign(new Error("Unique"), { code: "P2002" });
    }

    const favorite = {
      ...data,
      createdAt: new Date()
    };

    favorites.set(key, favorite);

    return include?.prompt
      ? { ...favorite, prompt: prompts.get(data.promptId) }
      : favorite;
  },

  findMany: async ({ where, include }: any) => {
    return [...favorites.values()]
      .filter((favorite) => favorite.userId === where.userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((favorite) =>
        include?.prompt
          ? { ...favorite, prompt: prompts.get(favorite.promptId) }
          : favorite
      );
  },

  deleteMany: async ({ where }: any) => {
    const key = `${where.userId}:${where.promptId}`;

    if (!favorites.has(key)) {
      return { count: 0 };
    }

    favorites.delete(key);
    return { count: 1 };
  }
};

  fake.collection = {
    create: async ({ data }: any) => {
      const duplicate = [...collections.values()].some(
        (item) => item.userId === data.userId && item.name === data.name
      );

      if (duplicate) {
        throw Object.assign(new Error("Unique"), { code: "P2002" });
      }

      const collection = {
        ...data,
        id: id("collection"),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      collections.set(collection.id, collection);
      return collection;
    },

    findFirst: async ({ where }: any) => {
      const collection = collections.get(where.id);

      if (!collection) return null;
      if (where.userId && collection.userId !== where.userId) return null;

      return collection;
    },

    findMany: async ({ where }: any) => {
      return [...collections.values()]
        .filter((item) => item.userId === where.userId)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    },

    update: async ({ where, data }: any) => {
      const collection = collections.get(where.id);

      if (!collection) {
        throw new Error("Collection not found");
      }

      if (data.name !== undefined) {
        const duplicate = [...collections.values()].some(
          (item) =>
            item.id !== where.id &&
            item.userId === collection.userId &&
            item.name === data.name
        );

        if (duplicate) {
          throw Object.assign(new Error("Unique"), { code: "P2002" });
        }
      }

      Object.assign(collection, data);
      collection.updatedAt = new Date();

      return collection;
    },

    deleteMany: async ({ where }: any) => {
      const collection = collections.get(where.id);

      if (!collection || collection.userId !== where.userId) {
        return { count: 0 };
      }

      collections.delete(where.id);

      for (const [key, membership] of collectionPrompts.entries()) {
        if (membership.collectionId === where.id) {
          collectionPrompts.delete(key);
        }
      }

      return { count: 1 };
    }
  };

  fake.collectionPrompt = {
    create: async ({ data, include }: any) => {
      const key = `${data.collectionId}:${data.promptId}`;

      if (collectionPrompts.has(key)) {
        throw Object.assign(new Error("Unique"), { code: "P2002" });
      }

      const membership = {
        ...data,
        addedAt: new Date()
      };

      collectionPrompts.set(key, membership);

      return include?.prompt
        ? { ...membership, prompt: prompts.get(data.promptId) }
        : membership;
    },

    findMany: async ({ where, include }: any) => {
      return [...collectionPrompts.values()]
        .filter((item) => item.collectionId === where.collectionId)
        .sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime())
        .map((item) =>
          include?.prompt
            ? { ...item, prompt: prompts.get(item.promptId) }
            : item
        );
    },

    deleteMany: async ({ where }: any) => {
      const key = `${where.collectionId}:${where.promptId}`;

      if (!collectionPrompts.has(key)) {
        return { count: 0 };
      }

      collectionPrompts.delete(key);
      return { count: 1 };
    }
  };

  fake.prompt = {
    create: async ({ data }: any) => {
      const prompt = {
        ...data, id: id("prompt"), createdAt: new Date(), updatedAt: new Date(),
        currentVersionId: null, currentVersion: null, versions: [], category: null
      };
      prompts.set(prompt.id, prompt);
      return prompt;
    },
    update: async ({ where, data }: any) => {
      const prompt = prompts.get(where.id);
      Object.assign(prompt, data);
      return prompt;
    },
    findFirst: async ({ where }: any) => {
      const prompt = prompts.get(where.id);
      return prompt && prompt.userId === where.userId ? prompt : null;
    },
    findMany: async ({ where, skip = 0, take }: any) => [...prompts.values()].filter((prompt) =>
      prompt.userId === where.userId &&
      (!where.categoryId || prompt.categoryId === where.categoryId) &&
      (!where.tags || prompt.tags.includes(where.tags.has))
    ).slice(skip, take === undefined ? undefined : skip + take),
    deleteMany: async ({ where }: any) => {
      const prompt = prompts.get(where.id);
      if (!prompt || prompt.userId !== where.userId) return { count: 0 };
      prompts.delete(where.id);
      return { count: 1 };
    },
    count: async ({ where }: any) => [...prompts.values()].filter((prompt) =>
      prompt.userId === where.userId &&
      (!where.categoryId || prompt.categoryId === where.categoryId) &&
      (!where.tags || prompt.tags.includes(where.tags.has))
    ).length
  };
  fake.promptVersion = {
    create: async ({ data }: any) => {
      const version = {
        id: id("version"), promptId: data.promptId, versionNumber: data.versionNumber,
        template: data.template, changeNote: data.changeNote ?? null, createdAt: new Date(),
        variables: data.variables.create.map((variable: any) => ({ id: id("variable"), ...variable }))
      };
      const prompt = prompts.get(data.promptId);
      prompt.versions.push(version);
      prompt.currentVersion = version;
      return version;
    }
  };
  fake.$transaction = async (arg: any) => Array.isArray(arg) ? Promise.all(arg) : arg(fake);

  return {
    client: fake as unknown as PrismaClient,
    users,
    sessions,
    prompts,
    categories,
    favorites,
    collections,
    collectionPrompts
  };
}

async function withServer(run: (baseUrl: string, db: ReturnType<typeof createFakePrisma>) => Promise<void>) {
  const db = createFakePrisma();
  const getClient = () => db.client;
const app = createApp(
  createAuthRouter(getClient),
  createPromptsRouter(getClient),
  createCategoriesRouter(getClient),
  createFavoritesRouter(getClient),
  createCollectionsRouter(getClient)
);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try { await run(baseUrl, db); }
  finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function request(baseUrl: string, path: string, options: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { origin: env.FRONTEND_ORIGIN, "content-type": "application/json" };
  if (options.cookie) headers.cookie = options.cookie;
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
}

async function register(baseUrl: string, email: string) {
  const response = await request(baseUrl, "/api/auth/register", {
    body: { email, password: "correct-horse-battery-staple" }
  });
  assert.equal(response.status, 201);
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

test("prompt creation stores an initial version and detected variable definitions", async () => {
  await withServer(async (baseUrl, db) => {
    const cookie = await register(baseUrl, "owner@example.com");
    const response = await request(baseUrl, "/api/prompts", {
      cookie,
      body: {
        title: "Study helper",
        template: "Explain {{topic}} for {{level}}",
        tags: ["study", "education", "study"],
        variables: [{ name: "topic", required: true }, { name: "level", defaultValue: "beginner", required: false }]
      }
    });
    assert.equal(response.status, 201);
    const body = await response.json() as any;
    assert.equal(body.prompt.title, "Study helper");
    assert.equal(body.prompt.currentVersion.versionNumber, 1);
    assert.deepEqual(body.prompt.currentVersion.variables.map((item: any) => item.name), ["topic", "level"]);
    assert.deepEqual(body.prompt.tags, ["study", "education"]);
    assert.equal(db.prompts.size, 1);
  });
});

test("prompt endpoints require authentication and prevent cross-user access", async () => {
  await withServer(async (baseUrl) => {
    const unauthenticated = await request(baseUrl, "/api/prompts");
    assert.equal(unauthenticated.status, 401);

    const ownerCookie = await register(baseUrl, "owner@example.com");
    const otherCookie = await register(baseUrl, "other@example.com");
    const created = await request(baseUrl, "/api/prompts", {
      cookie: ownerCookie,
      body: { title: "Private prompt", template: "Hello {{name}}" }
    });
    const promptId = ((await created.json()) as any).prompt.id;

    const ownerGet = await request(baseUrl, `/api/prompts/${promptId}`, { cookie: ownerCookie });
    assert.equal(ownerGet.status, 200);

    const otherGet = await request(baseUrl, `/api/prompts/${promptId}`, { cookie: otherCookie });
    assert.equal(otherGet.status, 404);

    const otherList = await request(baseUrl, "/api/prompts", { cookie: otherCookie });
    assert.equal(otherList.status, 200);
    assert.deepEqual((await otherList.json() as any).prompts, []);
  });
});

test("prompt creation rejects malformed placeholders and unrelated variable definitions", async () => {
  await withServer(async (baseUrl) => {
    const cookie = await register(baseUrl, "owner@example.com");
    const malformed = await request(baseUrl, "/api/prompts", {
      cookie, body: { title: "Bad", template: "Hello {{name" }
    });
    assert.equal(malformed.status, 400);

    const unrelated = await request(baseUrl, "/api/prompts", {
      cookie,
      body: { title: "Bad", template: "Hello {{name}}", variables: [{ name: "other" }] }
    });
    assert.equal(unrelated.status, 400);
  });
});

test("prompt list supports pagination and tag filtering", async () => {
  await withServer(async (baseUrl) => {
    const cookie = await register(baseUrl, "owner@example.com");
    for (const [title, tag] of [["One", "alpha"], ["Two", "beta"], ["Three", "alpha"]]) {
      const response = await request(baseUrl, "/api/prompts", {
        cookie, body: { title, template: "Text", tags: [tag] }
      });
      assert.equal(response.status, 201);
    }
    const response = await request(baseUrl, "/api/prompts?tag=alpha&page=1&limit=1", { cookie });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.prompts.length, 1);
    assert.equal(body.pagination.total, 2);
    assert.equal(body.pagination.totalPages, 2);
  });
});

test("prompt update changes metadata without creating a new version", async () => {
  await withServer(async (baseUrl) => {
    const cookie = await register(baseUrl, "metadata@example.com");
    const created = await request(baseUrl, "/api/prompts", {
      cookie, body: { title: "Original", template: "Hello {{name}}", tags: ["old"] }
    });
    const promptId = ((await created.json()) as any).prompt.id;

    const updated = await request(baseUrl, `/api/prompts/${promptId}`, {
      method: "PATCH", cookie, body: { title: "Renamed", tags: ["new", "new"] }
    });
    assert.equal(updated.status, 200);
    const prompt = ((await updated.json()) as any).prompt;
    assert.equal(prompt.title, "Renamed");
    assert.deepEqual(prompt.tags, ["new"]);
    assert.equal(prompt.currentVersion.versionNumber, 1);
    assert.equal(prompt.versions.length, 1);
  });
});

test("prompt content update creates a new immutable version and preserves matching variable metadata", async () => {
  await withServer(async (baseUrl) => {
    const cookie = await register(baseUrl, "version@example.com");
    const created = await request(baseUrl, "/api/prompts", {
      cookie,
      body: {
        title: "Versioned",
        template: "Hello {{name}}",
        variables: [{ name: "name", description: "Person's name", defaultValue: "Ada" }]
      }
    });
    const promptId = ((await created.json()) as any).prompt.id;

    const updated = await request(baseUrl, `/api/prompts/${promptId}`, {
      method: "PATCH", cookie, body: { template: "Hello {{name}}, welcome to {{place}}" }
    });
    assert.equal(updated.status, 200);
    const prompt = ((await updated.json()) as any).prompt;
    assert.equal(prompt.currentVersion.versionNumber, 2);
    assert.equal(prompt.currentVersion.template, "Hello {{name}}, welcome to {{place}}");
    assert.deepEqual(prompt.currentVersion.variables.map((item: any) => item.name), ["name", "place"]);
    assert.equal(prompt.currentVersion.variables[0].description, "Person's name");
    assert.equal(prompt.currentVersion.variables[0].defaultValue, "Ada");
    assert.equal(prompt.currentVersion.variables[1].required, true);
  });
});

test("prompt update rejects empty and malformed changes and blocks other users", async () => {
  await withServer(async (baseUrl) => {
    const ownerCookie = await register(baseUrl, "patch-owner@example.com");
    const otherCookie = await register(baseUrl, "patch-other@example.com");
    const created = await request(baseUrl, "/api/prompts", {
      cookie: ownerCookie, body: { title: "Private", template: "Hello {{name}}" }
    });
    const promptId = ((await created.json()) as any).prompt.id;

    const empty = await request(baseUrl, `/api/prompts/${promptId}`, {
      method: "PATCH", cookie: ownerCookie, body: {}
    });
    assert.equal(empty.status, 400);

    const malformed = await request(baseUrl, `/api/prompts/${promptId}`, {
      method: "PATCH", cookie: ownerCookie, body: { template: "Broken {{name" }
    });
    assert.equal(malformed.status, 400);

    const otherUpdate = await request(baseUrl, `/api/prompts/${promptId}`, {
      method: "PATCH", cookie: otherCookie, body: { title: "Stolen" }
    });
    assert.equal(otherUpdate.status, 404);
  });
});

test("prompt delete removes only the owner's prompt and returns not found for other users", async () => {
  await withServer(async (baseUrl, db) => {
    const ownerCookie = await register(baseUrl, "delete-owner@example.com");
    const otherCookie = await register(baseUrl, "delete-other@example.com");
    const created = await request(baseUrl, "/api/prompts", {
      cookie: ownerCookie, body: { title: "Disposable", template: "Goodbye" }
    });
    const promptId = ((await created.json()) as any).prompt.id;

    const forbidden = await request(baseUrl, `/api/prompts/${promptId}`, {
      method: "DELETE", cookie: otherCookie, body: {}
    });
    assert.equal(forbidden.status, 404);
    assert.equal(db.prompts.size, 1);

    const deleted = await request(baseUrl, `/api/prompts/${promptId}`, {
      method: "DELETE", cookie: ownerCookie, body: {}
    });
    assert.equal(deleted.status, 204);
    assert.equal(db.prompts.size, 0);

    const repeated = await request(baseUrl, `/api/prompts/${promptId}`, {
      method: "DELETE", cookie: ownerCookie, body: {}
    });
    assert.equal(repeated.status, 404);
  });
});


test("category endpoints require authentication", async () => {
  await withServer(async (baseUrl) => {
    const listResponse = await request(baseUrl, "/api/categories");
    assert.equal(listResponse.status, 401);

    const createResponse = await request(baseUrl, "/api/categories", {
      body: { name: "Development" }
    });
    assert.equal(createResponse.status, 401);
  });
});

test("category creation, listing, and renaming work correctly", async () => {
  await withServer(async (baseUrl) => {
    const cookie = await register(baseUrl, "category-owner@example.com");

    const createResponse = await request(baseUrl, "/api/categories", {
      cookie,
      body: { name: "  Development  " }
    });

    assert.equal(createResponse.status, 201);

    const createdBody = await createResponse.json() as any;
    assert.equal(createdBody.category.name, "Development");

    const categoryId = createdBody.category.id;

    const listResponse = await request(baseUrl, "/api/categories", {
      cookie
    });

    assert.equal(listResponse.status, 200);

    const listBody = await listResponse.json() as any;
    assert.equal(listBody.categories.length, 1);
    assert.equal(listBody.categories[0].id, categoryId);

    const updateResponse = await request(
      baseUrl,
      `/api/categories/${categoryId}`,
      {
        method: "PATCH",
        cookie,
        body: { name: "Backend Development" }
      }
    );

    assert.equal(updateResponse.status, 200);

    const updatedBody = await updateResponse.json() as any;
    assert.equal(updatedBody.category.name, "Backend Development");
  });
});

test("categories reject invalid input and duplicate names", async () => {
  await withServer(async (baseUrl) => {
    const cookie = await register(baseUrl, "category-validation@example.com");

    const emptyResponse = await request(baseUrl, "/api/categories", {
      cookie,
      body: { name: "   " }
    });

    assert.equal(emptyResponse.status, 400);

    const longResponse = await request(baseUrl, "/api/categories", {
      cookie,
      body: { name: "A".repeat(51) }
    });

    assert.equal(longResponse.status, 400);

    const firstResponse = await request(baseUrl, "/api/categories", {
      cookie,
      body: { name: "Development" }
    });

    assert.equal(firstResponse.status, 201);

    const duplicateResponse = await request(baseUrl, "/api/categories", {
      cookie,
      body: { name: "Development" }
    });

    assert.equal(duplicateResponse.status, 409);

    const updateDuplicateResponse = await request(
      baseUrl,
      `/api/categories/${(await firstResponse.json() as any).category.id}`,
      {
        method: "PATCH",
        cookie,
        body: { name: "Development" }
      }
    );

    // Renaming a category to its existing name is allowed.
    assert.equal(updateDuplicateResponse.status, 200);
  });
});

test("users cannot modify another user's category and deletion preserves prompts", async () => {
  await withServer(async (baseUrl, db) => {
    const ownerCookie = await register(baseUrl, "category-owner2@example.com");
    const otherCookie = await register(baseUrl, "category-other@example.com");

    const createResponse = await request(baseUrl, "/api/categories", {
      cookie: ownerCookie,
      body: { name: "Research" }
    });

    assert.equal(createResponse.status, 201);

    const { category } = await createResponse.json() as any;

    const foreignUpdate = await request(
      baseUrl,
      `/api/categories/${category.id}`,
      {
        method: "PATCH",
        cookie: otherCookie,
        body: { name: "Stolen Category" }
      }
    );

    assert.equal(foreignUpdate.status, 404);

    const foreignDelete = await request(
      baseUrl,
      `/api/categories/${category.id}`,
      {
        method: "DELETE",
        cookie: otherCookie
      }
    );

    assert.equal(foreignDelete.status, 404);

    // Seed a prompt associated with the category.
    db.prompts.set("prompt-category-test", {
      id: "prompt-category-test",
      userId: category.userId,
      categoryId: category.id,
      category,
      title: "Test prompt",
      description: null,
      tags: [],
      versions: [],
      currentVersion: null,
      currentVersionId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const deleteResponse = await request(
      baseUrl,
      `/api/categories/${category.id}`,
      {
        method: "DELETE",
        cookie: ownerCookie
      }
    );

    assert.equal(deleteResponse.status, 204);

    // The prompt must remain, but become uncategorized.
    const preservedPrompt = db.prompts.get("prompt-category-test");

    assert.ok(preservedPrompt);
    assert.equal(preservedPrompt.categoryId, null);
    assert.equal(preservedPrompt.category, null);

    const repeatedDelete = await request(
      baseUrl,
      `/api/categories/${category.id}`,
      {
        method: "DELETE",
        cookie: ownerCookie
      }
    );

    assert.equal(repeatedDelete.status, 404);
  });
});


test("favorite endpoints require authentication", async () => {
  await withServer(async (baseUrl) => {
    const list = await request(baseUrl, "/api/favorites");
    assert.equal(list.status, 401);

    const add = await request(baseUrl, "/api/favorites/prompt-1", {
      body: {}
    });
    assert.equal(add.status, 401);

    const remove = await request(baseUrl, "/api/favorites/prompt-1", {
      method: "DELETE"
    });
    assert.equal(remove.status, 401);
  });
});

test("users can add and list their favorite prompts", async () => {
  await withServer(async (baseUrl, db) => {
    const cookie = await register(baseUrl, "favorite-owner@example.com");

    const created = await request(baseUrl, "/api/prompts", {
      cookie,
      body: {
        title: "Favorite prompt",
        template: "Hello {{name}}"
      }
    });

    assert.equal(created.status, 201);
    const prompt = (await created.json() as any).prompt;

    const added = await request(
      baseUrl,
      `/api/favorites/${prompt.id}`,
      { cookie, body: {} }
    );

    assert.equal(added.status, 201);

    const addedBody = await added.json() as any;
    assert.equal(addedBody.favorite.promptId, prompt.id);
    assert.equal(addedBody.favorite.prompt.title, "Favorite prompt");

    const listed = await request(baseUrl, "/api/favorites", { cookie });

    assert.equal(listed.status, 200);

    const listedBody = await listed.json() as any;
    assert.equal(listedBody.favorites.length, 1);
    assert.equal(listedBody.favorites[0].prompt.id, prompt.id);
    assert.equal(db.favorites.size, 1);
  });
});

test("duplicate favorite additions return conflict", async () => {
  await withServer(async (baseUrl) => {
    const cookie = await register(baseUrl, "favorite-duplicate@example.com");

    const created = await request(baseUrl, "/api/prompts", {
      cookie,
      body: {
        title: "Duplicate test",
        template: "Test"
      }
    });

    const promptId = ((await created.json()) as any).prompt.id;

    const first = await request(baseUrl, `/api/favorites/${promptId}`, {
      cookie,
      body: {}
    });

    assert.equal(first.status, 201);

    const second = await request(baseUrl, `/api/favorites/${promptId}`, {
      cookie,
      body: {}
    });

    assert.equal(second.status, 409);
  });
});

test("users cannot favorite prompts owned by another user", async () => {
  await withServer(async (baseUrl, db) => {
    const ownerCookie = await register(baseUrl, "favorite-prompt-owner@example.com");
    const otherCookie = await register(baseUrl, "favorite-prompt-other@example.com");

    const created = await request(baseUrl, "/api/prompts", {
      cookie: ownerCookie,
      body: {
        title: "Private prompt",
        template: "Private content"
      }
    });

    const promptId = ((await created.json()) as any).prompt.id;

    const attempt = await request(
      baseUrl,
      `/api/favorites/${promptId}`,
      {
        cookie: otherCookie,
        body: {}
      }
    );

    assert.equal(attempt.status, 404);
    assert.equal(db.favorites.size, 0);

    const missing = await request(
      baseUrl,
      "/api/favorites/unknown-prompt",
      {
        cookie: ownerCookie,
        body: {}
      }
    );

    assert.equal(missing.status, 404);
  });
});

test("users can remove their favorites but cannot remove another user's favorite", async () => {
  await withServer(async (baseUrl, db) => {
    const ownerCookie = await register(baseUrl, "favorite-remove-owner@example.com");
    const otherCookie = await register(baseUrl, "favorite-remove-other@example.com");

    const created = await request(baseUrl, "/api/prompts", {
      cookie: ownerCookie,
      body: {
        title: "Removable prompt",
        template: "Temporary"
      }
    });

    const promptId = ((await created.json()) as any).prompt.id;

    const added = await request(baseUrl, `/api/favorites/${promptId}`, {
      cookie: ownerCookie,
      body: {}
    });

    assert.equal(added.status, 201);
    assert.equal(db.favorites.size, 1);

    const foreignDelete = await request(
      baseUrl,
      `/api/favorites/${promptId}`,
      {
        method: "DELETE",
        cookie: otherCookie,
        body: {}
      }
    );

    assert.equal(foreignDelete.status, 404);
    assert.equal(db.favorites.size, 1);

    const deleted = await request(
      baseUrl,
      `/api/favorites/${promptId}`,
      {
        method: "DELETE",
        cookie: ownerCookie,
        body: {}
      }
    );

    assert.equal(deleted.status, 204);
    assert.equal(db.favorites.size, 0);

    const repeated = await request(
      baseUrl,
      `/api/favorites/${promptId}`,
      {
        method: "DELETE",
        cookie: ownerCookie,
        body: {}
      }
    );

    assert.equal(repeated.status, 404);
  });
});


test("collection endpoints require authentication", async () => {
  await withServer(async (baseUrl) => {
    const list = await request(baseUrl, "/api/collections");
    assert.equal(list.status, 401);

    const create = await request(baseUrl, "/api/collections", {
      body: { name: "Private collection" }
    });
    assert.equal(create.status, 401);
  });
});

test("users can create, list, and update their collections", async () => {
  await withServer(async (baseUrl) => {
    const cookie = await register(baseUrl, "collection-crud@example.com");

    const created = await request(baseUrl, "/api/collections", {
      cookie,
      body: {
        name: "  Interview Prep  ",
        description: "  Important prompts  "
      }
    });

    assert.equal(created.status, 201);

    const createdBody = (await created.json()) as any;
    const collectionId = createdBody.collection.id;

    assert.equal(createdBody.collection.name, "Interview Prep");
    assert.equal(createdBody.collection.description, "Important prompts");

    const list = await request(baseUrl, "/api/collections", { cookie });
    assert.equal(list.status, 200);

    const listBody = (await list.json()) as any;
    assert.equal(listBody.collections.length, 1);
    assert.equal(listBody.collections[0].id, collectionId);

    const updated = await request(baseUrl, `/api/collections/${collectionId}`, {
      method: "PATCH",
      cookie,
      body: {
        name: "System Design",
        description: null
      }
    });

    assert.equal(updated.status, 200);

    const updatedBody = (await updated.json()) as any;
    assert.equal(updatedBody.collection.name, "System Design");
    assert.equal(updatedBody.collection.description, null);
  });
});

test("collections reject invalid input and duplicate names", async () => {
  await withServer(async (baseUrl) => {
    const cookie = await register(baseUrl, "collection-validation@example.com");

    const emptyName = await request(baseUrl, "/api/collections", {
      cookie,
      body: { name: "   " }
    });
    assert.equal(emptyName.status, 400);

    const invalidDescription = await request(baseUrl, "/api/collections", {
      cookie,
      body: {
        name: "Valid name",
        description: "x".repeat(501)
      }
    });
    assert.equal(invalidDescription.status, 400);

    const created = await request(baseUrl, "/api/collections", {
      cookie,
      body: { name: "DSA" }
    });
    assert.equal(created.status, 201);

    const duplicate = await request(baseUrl, "/api/collections", {
      cookie,
      body: { name: "DSA" }
    });
    assert.equal(duplicate.status, 409);

    const emptyUpdate = await request(
      baseUrl,
      `/api/collections/${((await created.json()) as any).collection.id}`,
      {
        method: "PATCH",
        cookie,
        body: {}
      }
    );
    assert.equal(emptyUpdate.status, 400);
  });
});

test("users cannot access or modify another user's collections", async () => {
  await withServer(async (baseUrl) => {
    const ownerCookie = await register(baseUrl, "collection-owner@example.com");
    const otherCookie = await register(baseUrl, "collection-other@example.com");

    const created = await request(baseUrl, "/api/collections", {
      cookie: ownerCookie,
      body: { name: "Owner's collection" }
    });

    const collectionId = ((await created.json()) as any).collection.id;

    const list = await request(baseUrl, "/api/collections", {
      cookie: otherCookie
    });
    assert.equal(((await list.json()) as any).collections.length, 0);

    const update = await request(baseUrl, `/api/collections/${collectionId}`, {
      method: "PATCH",
      cookie: otherCookie,
      body: { name: "Unauthorized update" }
    });
    assert.equal(update.status, 404);

    const prompts = await request(
      baseUrl,
      `/api/collections/${collectionId}/prompts`,
      { cookie: otherCookie }
    );
    assert.equal(prompts.status, 404);

    const deletion = await request(
      baseUrl,
      `/api/collections/${collectionId}`,
      {
        method: "DELETE",
        cookie: otherCookie,
        body: {}
      }
    );
    assert.equal(deletion.status, 404);
  });
});

test("users can add and list prompts in their collections", async () => {
  await withServer(async (baseUrl, db) => {
    const cookie = await register(baseUrl, "collection-membership@example.com");

    const collectionResponse = await request(baseUrl, "/api/collections", {
      cookie,
      body: { name: "DSA Practice" }
    });
    const collectionId = ((await collectionResponse.json()) as any).collection.id;

    const promptResponse = await request(baseUrl, "/api/prompts", {
      cookie,
      body: {
        title: "Two Sum",
        template: "Find two numbers whose sum equals {{target}}."
      }
    });
    const promptId = ((await promptResponse.json()) as any).prompt.id;

    const added = await request(
      baseUrl,
      `/api/collections/${collectionId}/prompts`,
      {
        cookie,
        body: { promptId }
      }
    );

    assert.equal(added.status, 201);

    const addedBody = (await added.json()) as any;
    assert.equal(addedBody.collectionPrompt.prompt.id, promptId);
    assert.equal(db.collectionPrompts.size, 1);

    const list = await request(
      baseUrl,
      `/api/collections/${collectionId}/prompts`,
      { cookie }
    );

    assert.equal(list.status, 200);

    const listBody = (await list.json()) as any;
    assert.equal(listBody.collectionPrompts.length, 1);
    assert.equal(listBody.collectionPrompts[0].prompt.title, "Two Sum");
  });
});

test("collections reject duplicate memberships and prompts owned by other users", async () => {
  await withServer(async (baseUrl, db) => {
    const ownerCookie = await register(baseUrl, "collection-prompt-owner@example.com");
    const otherCookie = await register(baseUrl, "collection-prompt-other@example.com");

    const collectionResponse = await request(baseUrl, "/api/collections", {
      cookie: ownerCookie,
      body: { name: "My Collection" }
    });
    const collectionId = ((await collectionResponse.json()) as any).collection.id;

    const ownPromptResponse = await request(baseUrl, "/api/prompts", {
      cookie: ownerCookie,
      body: {
        title: "My Prompt",
        template: "My template"
      }
    });
    const ownPromptId = ((await ownPromptResponse.json()) as any).prompt.id;

    const added = await request(
      baseUrl,
      `/api/collections/${collectionId}/prompts`,
      {
        cookie: ownerCookie,
        body: { promptId: ownPromptId }
      }
    );
    assert.equal(added.status, 201);

    const duplicate = await request(
      baseUrl,
      `/api/collections/${collectionId}/prompts`,
      {
        cookie: ownerCookie,
        body: { promptId: ownPromptId }
      }
    );
    assert.equal(duplicate.status, 409);

    const foreignPromptResponse = await request(baseUrl, "/api/prompts", {
      cookie: otherCookie,
      body: {
        title: "Private Prompt",
        template: "Private template"
      }
    });
    const foreignPromptId = ((await foreignPromptResponse.json()) as any).prompt.id;

    const foreignAttempt = await request(
      baseUrl,
      `/api/collections/${collectionId}/prompts`,
      {
        cookie: ownerCookie,
        body: { promptId: foreignPromptId }
      }
    );
    assert.equal(foreignAttempt.status, 404);

    const missingAttempt = await request(
      baseUrl,
      `/api/collections/${collectionId}/prompts`,
      {
        cookie: ownerCookie,
        body: { promptId: "unknown-prompt" }
      }
    );
    assert.equal(missingAttempt.status, 404);

    assert.equal(db.collectionPrompts.size, 1);
  });
});

test("users can remove collection prompts and deleting a collection removes memberships", async () => {
  await withServer(async (baseUrl, db) => {
    const cookie = await register(baseUrl, "collection-delete@example.com");
    const otherCookie = await register(baseUrl, "collection-delete-other@example.com");

    const collectionResponse = await request(baseUrl, "/api/collections", {
      cookie,
      body: { name: "Temporary Collection" }
    });
    const collectionId = ((await collectionResponse.json()) as any).collection.id;

    const promptResponse = await request(baseUrl, "/api/prompts", {
      cookie,
      body: {
        title: "Temporary Prompt",
        template: "Temporary content"
      }
    });
    const promptId = ((await promptResponse.json()) as any).prompt.id;

    const added = await request(
      baseUrl,
      `/api/collections/${collectionId}/prompts`,
      {
        cookie,
        body: { promptId }
      }
    );
    assert.equal(added.status, 201);
    assert.equal(db.collectionPrompts.size, 1);

    const foreignRemoval = await request(
      baseUrl,
      `/api/collections/${collectionId}/prompts/${promptId}`,
      {
        method: "DELETE",
        cookie: otherCookie,
        body: {}
      }
    );
    assert.equal(foreignRemoval.status, 404);
    assert.equal(db.collectionPrompts.size, 1);

    const removed = await request(
      baseUrl,
      `/api/collections/${collectionId}/prompts/${promptId}`,
      {
        method: "DELETE",
        cookie,
        body: {}
      }
    );
    assert.equal(removed.status, 204);
    assert.equal(db.collectionPrompts.size, 0);

    const repeatedRemoval = await request(
      baseUrl,
      `/api/collections/${collectionId}/prompts/${promptId}`,
      {
        method: "DELETE",
        cookie,
        body: {}
      }
    );
    assert.equal(repeatedRemoval.status, 404);

    const addedAgain = await request(
      baseUrl,
      `/api/collections/${collectionId}/prompts`,
      {
        cookie,
        body: { promptId }
      }
    );
    assert.equal(addedAgain.status, 201);
    assert.equal(db.collectionPrompts.size, 1);

    const deleted = await request(baseUrl, `/api/collections/${collectionId}`, {
      method: "DELETE",
      cookie,
      body: {}
    });
    assert.equal(deleted.status, 204);

    assert.equal(db.collections.size, 0);
    assert.equal(db.collectionPrompts.size, 0);
  });
});
