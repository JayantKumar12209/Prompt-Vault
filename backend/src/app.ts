import express from "express";
import helmet from "helmet";
import { errorHandler } from "./middleware/error-handler.js";
import { notFound } from "./middleware/not-found.js";
import { originCheck } from "./middleware/origin-check.js";
import { requestId } from "./middleware/request-id.js";
import { requestLogger } from "./middleware/request-logger.js";
import { healthRouter } from "./routes/health.js";

export const app = express();

app.disable("x-powered-by");
app.use(requestId);
app.use(requestLogger);
app.use(helmet());
app.use(originCheck);
app.use(express.json({ limit: "100kb" }));

app.use("/api/health", healthRouter);
app.use(notFound);
app.use(errorHandler);
