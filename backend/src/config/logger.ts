import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers.set-cookie",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.tokenHash",
      "*.apiKey",
      "GEMINI_API_KEY"
    ],
    censor: "[REDACTED]"
  }
});
