import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "./env.js";
import { logger } from "./logger.js";

let prisma: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  if (prisma) return prisma;

  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  const adapter = new PrismaNeon({ connectionString: env.DATABASE_URL });
  prisma = new PrismaClient({ adapter });

  return prisma;
}

export async function disconnectDatabase(): Promise<void> {
  if (!prisma) return;

  await prisma.$disconnect();
  prisma = undefined;
  logger.info("Database connection closed");
}
