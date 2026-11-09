import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "prompt-vault-api",
    timestamp: new Date().toISOString(),
    requestId: req.requestId
  });
});
