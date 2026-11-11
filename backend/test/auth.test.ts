import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { env } from "../src/config/env.js";
import { createApp } from "../src/app.js";
import { createAuthRouter } from "../src/routes/auth.js";

interface FakeUser {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string | null;
}

interface FakeSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

function createFakePrisma() {
  const users = new Map<string, FakeUser>();
  const sessions = new Map<string, FakeSession>();
  let nextId = 1;

  const fake: Record<string, any> = {};

  fake.user = {
    create: async ({ data }: { data: Omit<FakeUser, "id"> }) => {
      if (users.has(data.email)) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const user = { ...data, id: `user-${nextId++}` };
      users.set(user.email, user);
      return user;
    },
    findUnique: async ({ where }: { where: { email: string } }) => {
      return users.get(where.email) ?? null;
    }
  };

  fake.session = {
    create: async ({ data }: { data: Omit<FakeSession, "id" | "createdAt"> }) => {
      const session = { ...data, id: `session-${nextId++}`, createdAt: new Date() };
      sessions.set(session.id, session);
      return session;
    },
    findUnique: async ({ where }: { where: { tokenHash: string } }) => {
      const session = [...sessions.values()].find((item) => item.tokenHash === where.tokenHash);
      if (!session) return null;
      const user = [...users.values()].find((item) => item.id === session.userId);
      return user ? { ...session, user } : null;
    },
    deleteMany: async ({ where }: { where: { id?: string } }) => {
      if (where.id && sessions.delete(where.id)) return { count: 1 };
      return { count: 0 };
    }
  };

  fake.$transaction = async <T>(callback: (tx: unknown) => Promise<T>) => callback(fake);

  return {
    client: fake as unknown as PrismaClient,
    users,
    sessions
  };
}

async function withTestServer(
  run: (baseUrl: string, database: ReturnType<typeof createFakePrisma>) => Promise<void>
): Promise<void> {
  const database = createFakePrisma();
  const application = createApp(createAuthRouter(() => database.client));
  const server = application.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl, database);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function send(
  baseUrl: string,
  path: string,
  options: { method?: string; body?: unknown; cookie?: string } = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    origin: env.FRONTEND_ORIGIN,
    "content-type": "application/json"
  };
  if (options.cookie) headers.cookie = options.cookie;

  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
}

function getSessionCookie(response: Response): string {
  const header = response.headers.get("set-cookie");
  assert.ok(header, "Expected the server to set a session cookie");
  return header.split(";")[0]!;
}

const validCredentials = {
  email: "jayant@example.com",
  password: "correct-horse-battery-staple",
  displayName: "Jayant Kumar"
};

test("register creates a normalized user and stores only a hash of the session token", async () => {
  await withTestServer(async (baseUrl, database) => {
    const response = await send(baseUrl, "/api/auth/register", {
      body: { ...validCredentials, email: "  JAYANT@EXAMPLE.COM  ", displayName: " Jayant Kumar " }
    });

    assert.equal(response.status, 201);
    const body = await response.json() as { user: FakeUser };
    assert.deepEqual(body.user, {
      id: "user-1",
      email: "jayant@example.com",
      displayName: "Jayant Kumar"
    });
    assert.equal("passwordHash" in body.user, false);

    const cookie = getSessionCookie(response);
    assert.match(cookie, /^pv_session=[A-Za-z0-9_-]{43}$/);
    assert.match(response.headers.get("set-cookie")!, /HttpOnly/i);
    assert.match(response.headers.get("set-cookie")!, /SameSite=Lax/i);

    const token = cookie.slice("pv_session=".length);
    assert.equal(database.users.size, 1);
    assert.equal(database.sessions.size, 1);
    assert.match([...database.users.values()][0]!.passwordHash, /^\$argon2id\$/);
    assert.equal([...database.sessions.values()][0]!.tokenHash.length, 64);
    assert.notEqual([...database.sessions.values()][0]!.tokenHash, token);

    const me = await send(baseUrl, "/api/auth/me", { cookie });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { user: body.user });
  });
});

test("registration rejects invalid input and duplicate email addresses", async () => {
  await withTestServer(async (baseUrl) => {
    const invalid = await send(baseUrl, "/api/auth/register", {
      body: { email: "not-an-email", password: "short" }
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json() as any).error.code, "VALIDATION_ERROR");

    const first = await send(baseUrl, "/api/auth/register", { body: validCredentials });
    assert.equal(first.status, 201);

    const duplicate = await send(baseUrl, "/api/auth/register", {
      body: { ...validCredentials, email: "JAYANT@EXAMPLE.COM" }
    });
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json() as any).error.code, "EMAIL_TAKEN");
  });
});

test("login accepts the correct password and rejects an incorrect password", async () => {
  await withTestServer(async (baseUrl) => {
    const registered = await send(baseUrl, "/api/auth/register", { body: validCredentials });
    assert.equal(registered.status, 201);

    const wrongPassword = await send(baseUrl, "/api/auth/login", {
      body: { email: validCredentials.email, password: "incorrect-password" }
    });
    assert.equal(wrongPassword.status, 401);
    assert.equal((await wrongPassword.json() as any).error.code, "INVALID_CREDENTIALS");

    const login = await send(baseUrl, "/api/auth/login", {
      body: { email: "JAYANT@EXAMPLE.COM", password: validCredentials.password }
    });
    assert.equal(login.status, 200);
    assert.match(getSessionCookie(login), /^pv_session=[A-Za-z0-9_-]{43}$/);
  });
});

test("protected route rejects missing, malformed, and expired sessions", async () => {
  await withTestServer(async (baseUrl, database) => {
    const missing = await send(baseUrl, "/api/auth/me");
    assert.equal(missing.status, 401);

    const malformed = await send(baseUrl, "/api/auth/me", { cookie: "pv_session=invalid" });
    assert.equal(malformed.status, 401);

    const registered = await send(baseUrl, "/api/auth/register", { body: validCredentials });
    const cookie = getSessionCookie(registered);
    const storedSession = [...database.sessions.values()][0]!;
    storedSession.expiresAt = new Date(0);

    const expired = await send(baseUrl, "/api/auth/me", { cookie });
    assert.equal(expired.status, 401);
    assert.equal(database.sessions.size, 0);
  });
});

test("logout deletes the session, clears the cookie, and invalidates subsequent requests", async () => {
  await withTestServer(async (baseUrl, database) => {
    const registered = await send(baseUrl, "/api/auth/register", { body: validCredentials });
    const cookie = getSessionCookie(registered);

    const logout = await send(baseUrl, "/api/auth/logout", { method: "POST", body: {}, cookie });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get("set-cookie")!, /^pv_session=;/);
    assert.equal(database.sessions.size, 0);

    const afterLogout = await send(baseUrl, "/api/auth/me", { cookie });
    assert.equal(afterLogout.status, 401);
  });
});

test("authentication endpoints rate-limit the eleventh request from the same client", async () => {
  await withTestServer(async (baseUrl) => {
    const responses: Response[] = [];
    for (let attempt = 0; attempt < 11; attempt++) {
      responses.push(await send(baseUrl, "/api/auth/login", {
        body: { email: "invalid", password: "x" }
      }));
    }

    assert.ok(responses.slice(0, 10).every((response) => response.status === 400));
    assert.equal(responses[10]!.status, 429);
    assert.equal((await responses[10]!.json() as any).error.code, "RATE_LIMITED");
  });
});
