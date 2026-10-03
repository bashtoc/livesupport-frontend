import crypto from "node:crypto";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { errorHandler, notFound } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import { attachmentRouter } from "./modules/attachments/routes.js";
import { authRouter } from "./modules/auth/routes.js";
import { conversationRouter } from "./modules/conversations/routes.js";
import { healthRouter } from "./modules/health/routes.js";
import { identityRouter } from "./modules/identity/routes.js";
import { savedReplyRouter } from "./modules/saved-replies/routes.js";
import { staffRouter } from "./modules/staff/routes.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env().TRUST_PROXY);
  app.use((req, res, next) => {
    req.id = req.get("x-request-id")?.slice(0, 128) || crypto.randomUUID();
    res.setHeader("x-request-id", req.id);
    next();
  });
  app.use(pinoHttp({ logger, quietReqLogger: true }));
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
  app.use(cors({ origin: env().APP_ORIGIN, methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] }));
  app.use(express.json({ limit: "128kb", strict: true }));
  app.use(rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => req.path.startsWith("/api/v1/health"),
    message: { error: { code: "rate_limited", message: "Too many requests" } }
  }));

  app.use("/api/v1/health", healthRouter);
  app.use("/api/v1/identity", identityRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1", conversationRouter);
  app.use("/api/v1", attachmentRouter);
  app.use("/api/v1/staff", staffRouter);
  app.use("/api/v1/staff/saved-replies", savedReplyRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
