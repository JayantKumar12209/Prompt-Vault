import { Algorithm, hash, verify } from "@node-rs/argon2";

const passwordHashOptions = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, passwordHashOptions);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

// A valid dummy hash makes unknown-email login attempts perform a password verification too.
export const dummyPasswordHash = hashPassword("PromptVault-dummy-password-not-a-user");
