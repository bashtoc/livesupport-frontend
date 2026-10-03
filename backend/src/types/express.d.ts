import type { AuthPrincipal } from "../modules/auth/types.js";

declare global {
  namespace Express {
    interface Request {
      id: string;
      auth?: AuthPrincipal;
    }
  }
}

export {};
