import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const originCheck: RequestHandler = (req, _res, next) => {
  if (!stateChangingMethods.has(req.method)) {
    next();
    return;
  }

  if (req.get("origin") !== env.FRONTEND_ORIGIN) {
    next(new AppError(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed"));
    return;
  }

  if (!req.is("application/json")) {
    next(new AppError(415, "JSON_REQUIRED", "Content-Type must be application/json"));
    return;
  }

  next();
};
