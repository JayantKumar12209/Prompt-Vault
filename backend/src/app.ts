
import express, { type Router } from "express";
import helmet from "helmet";
import { errorHandler } from "./middleware/error-handler.js";
import { notFound } from "./middleware/not-found.js";
import { originCheck } from "./middleware/origin-check.js";
import { requestId } from "./middleware/request-id.js";
import { requestLogger } from "./middleware/request-logger.js";
import { authRouter } from "./routes/auth.js";
import { promptsRouter } from "./routes/prompts.js";
import { categoriesRouter } from "./routes/categories.js";
import { healthRouter } from "./routes/health.js";
import { favoritesRouter } from "./routes/favorites.js";
import { collectionsRouter } from "./routes/collections.js";

export function createApp(
  authRouterInstance: Router = authRouter,
  promptsRouterInstance: Router = promptsRouter,
  categoriesRouterInstance: Router = categoriesRouter,
  favoritesRouterInstance: Router = favoritesRouter,
  collectionsRouterInstance: Router = collectionsRouter
) {
  const application = express();

  application.disable("x-powered-by");
  application.use(requestId);
  application.use(requestLogger);
  application.use(helmet());
  application.use(originCheck);
  application.use(express.json({ limit: "100kb" }));

  application.use("/api/health", healthRouter);
  application.use("/api/auth", authRouterInstance);
  application.use("/api/prompts", promptsRouterInstance);
  application.use("/api/categories", categoriesRouterInstance);
  application.use("/api/favorites", favoritesRouterInstance);
  application.use("/api/collections", collectionsRouterInstance);

  application.use(notFound);
  application.use(errorHandler);

  return application;
}

export const app = createApp();
