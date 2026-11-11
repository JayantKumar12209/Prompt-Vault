import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { env } from "../src/config/env.js";
import { createApp } from "../src/app.js";
import { createAuthRouter } from "../src/routes/auth.js";
import { createPromptsRouter } from "../src/routes/prompts.js";

function createFakePrisma() {
  const users = new Map<string, any>();
  const sessions = new Map<string, any>();
  const prompts = new Map<string, any>();
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
  fake.category = {
    findFirst: async ({ where }: any) => where.userId ? null : null
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

  return { client: fake as unknown as PrismaClient, users, sessions, prompts };
}

async function withServer(run: (baseUrl: string, db: ReturnType<typeof createFakePrisma>) => Promise<void>) {
  const db = createFakePrisma();
  const getClient = () => db.client;
  const app = createApp(createAuthRouter(getClient), createPromptsRouter(getClient));
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
      method: "DELETE", cookie: otherCookie
    });
    assert.equal(forbidden.status, 404);
    assert.equal(db.prompts.size, 1);

    const deleted = await request(baseUrl, `/api/prompts/${promptId}`, {
      method: "DELETE", cookie: ownerCookie
    });
    assert.equal(deleted.status, 204);
    assert.equal(db.prompts.size, 0);

    const repeated = await request(baseUrl, `/api/prompts/${promptId}`, {
      method: "DELETE", cookie: ownerCookie
    });
    assert.equal(repeated.status, 404);
  });
});

