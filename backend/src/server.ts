import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";

const server = app.listen(env.PORT, "0.0.0.0", () => {
  logger.info({ port: env.PORT, environment: env.NODE_ENV }, "PromptVault API started");
});

const shutdown = (signal: string): void => {
  logger.info({ signal }, "Shutting down PromptVault API");
  server.close((error) => {
    if (error) {
      logger.error({ err: error }, "Error while closing HTTP server");
      process.exitCode = 1;
      return;
    }
    logger.info("HTTP server closed");
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.on("error", (error) => {
  logger.fatal({ err: error }, "HTTP server failed to start or crashed");
  process.exitCode = 1;
});
