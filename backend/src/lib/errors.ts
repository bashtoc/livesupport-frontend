import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "./logger.js";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, "not_found", "Resource not found"));
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (
    typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large"
  ) {
    res.status(413).json({
      error: { code: "attachment_too_large", message: "Attachment exceeds the configured size limit" },
      requestId: req.id
    });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      error: { code: "validation_error", message: "Invalid request", details: error.issues },
      requestId: req.id
    });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
      requestId: req.id
    });
    return;
  }
  logger.error({ err: error, requestId: req.id }, "Unhandled request error");
  res.status(500).json({
    error: { code: "internal_error", message: "An unexpected error occurred" },
    requestId: req.id
  });
}
