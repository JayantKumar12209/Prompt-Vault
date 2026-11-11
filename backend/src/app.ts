import express, { type Router } from "express";
import helmet from "helmet";
import { errorHandler } from "./middleware/error-handler.js";
import { notFound } from "./middleware/not-found.js";
import { originCheck } from "./middleware/origin-check.js";
import { requestId } from "./middleware/request-id.js";
import { requestLogger } from "./middleware/request-logger.js";
import { authRouter } from "./routes/auth.js";
import { promptsRouter } from "./routes/prompts.js";
import { healthRouter } from "./routes/health.js";

export function createApp(authRouterInstance: Router = authRouter) {
  const application = express();

  application.disable("x-powered-by");
  application.use(requestId);
  application.use(requestLogger);
  application.use(helmet());
  application.use(originCheck);
  application.use(express.json({ limit: "100kb" }));

  application.use("/api/health", healthRouter);
  application.use("/api/auth", authRouterInstance);
  application.use("/api/prompts", promptsRouter);
  application.use(notFound);
  application.use(errorHandler);

  return application;
}

export const app = createApp();
