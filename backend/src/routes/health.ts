import { Router } from "express";
import { getPrismaClient } from "../config/database.js";

export const healthRouter = Router();

healthRouter.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "prompt-vault-api",
    timestamp: new Date().toISOString(),
    requestId: req.requestId
  });
});

healthRouter.get("/ready", async (req, res) => {
  try {
    await getPrismaClient().$queryRaw`SELECT 1`;
    res.status(200).json({
      status: "ready",
      service: "prompt-vault-api",
      database: "connected",
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });
  } catch {
    res.status(503).json({
      status: "not_ready",
      service: "prompt-vault-api",
      database: "unavailable",
      requestId: req.requestId
    });
  }
});
