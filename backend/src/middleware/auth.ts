import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors.js";
import { verifyAccessToken } from "../modules/auth/tokens.js";
import type { StaffRole } from "../modules/auth/types.js";

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    next(new AppError(401, "authentication_required", "Bearer token is required"));
    return;
  }
  try {
    req.auth = await verifyAccessToken(header.slice(7));
    next();
  } catch (error) {
    next(error);
  }
}

export function requireType(type: "customer" | "staff") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.auth?.type !== type) {
      next(new AppError(403, "forbidden", `A ${type} session is required`));
      return;
    }
    next();
  };
}

export function requireRole(...roles: StaffRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.auth?.type !== "staff" || !roles.includes(req.auth.role)) {
      next(new AppError(403, "forbidden", "Your staff role cannot perform this action"));
      return;
    }
    next();
  };
}
