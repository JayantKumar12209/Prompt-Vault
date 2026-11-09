import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    // Prisma CLI uses the direct Neon connection for schema operations and migrations.
    url: env("DIRECT_URL")
  }
});
