import type { Server as HttpServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { Emitter } from "@socket.io/redis-emitter";
import { Redis } from "ioredis";
import { Server } from "socket.io";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { requireConversationAccess } from "../conversations/access.js";
import { verifyAccessToken } from "../auth/tokens.js";

let io: Server | undefined;
let emitter: Emitter | undefined;

export async function startRealtime(httpServer: HttpServer): Promise<Server> {
  const pub = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
  const sub = pub.duplicate();
  io = new Server(httpServer, {
    path: "/socket.io",
    cors: { origin: env().APP_ORIGIN, credentials: false },
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 100_000,
    pingInterval: 25_000,
    pingTimeout: 20_000
  });
  io.adapter(createAdapter(pub, sub));
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (typeof token !== "string") throw new Error("Missing token");
      socket.data.auth = await verifyAccessToken(token);
      next();
    } catch {
      logger.warn({ socketId: socket.id }, "Socket.IO authentication rejected");
      next(new Error("unauthorized"));
    }
  });
  io.on("connection", (socket) => {
    const auth = socket.data.auth;
    logger.info(
      { socketId: socket.id, principalType: auth.type, principalId: auth.id },
      "Socket.IO client connected"
    );
    socket.join(`${auth.type}:${auth.id}`);
    if (auth.type === "staff") socket.join(`team:${auth.team}`);
    socket.on("conversation:join", async (conversationId: unknown, acknowledge?: (result: unknown) => void) => {
      try {
        if (typeof conversationId !== "string") throw new Error("Invalid conversation ID");
        await requireConversationAccess(conversationId, auth);
        await socket.join(`conversation:${conversationId}`);
        logger.info(
          { socketId: socket.id, principalType: auth.type, conversationId },
          "Socket.IO conversation joined"
        );
        acknowledge?.({ ok: true });
      } catch (error) {
        logger.warn(
          { socketId: socket.id, principalType: auth.type, conversationId, err: error },
          "Socket.IO conversation join rejected"
        );
        acknowledge?.({ ok: false, error: "forbidden" });
      }
    });
    socket.on("conversation:leave", async (conversationId: unknown) => {
      if (typeof conversationId === "string") await socket.leave(`conversation:${conversationId}`);
    });
    socket.on("message:receipt", async (payload: unknown, acknowledge?: (result: unknown) => void) => {
      try {
        if (!payload || typeof payload !== "object") throw new Error("Invalid receipt");
        const value = payload as { conversationId?: unknown; messageIds?: unknown; state?: unknown };
        if (typeof value.conversationId !== "string" || !Array.isArray(value.messageIds) ||
            !value.messageIds.every((id) => typeof id === "string") ||
            (value.state !== "delivered" && value.state !== "read")) throw new Error("Invalid receipt");
        const { recordReceipt } = await import("../receipts/service.js");
        const receipts = await recordReceipt({
          conversationId: value.conversationId,
          messageIds: value.messageIds,
          state: value.state,
          auth
        });
        acknowledge?.({ ok: true, receipts });
      } catch {
        acknowledge?.({ ok: false, error: "invalid_receipt" });
      }
    });
    socket.on("disconnect", (reason) => {
      logger.info(
        { socketId: socket.id, principalType: auth.type, principalId: auth.id, reason },
        "Socket.IO client disconnected"
      );
    });
  });
  logger.info("Socket.IO realtime layer started");
  return io;
}

export function publishConversationEvent(
  conversationId: string,
  team: string,
  event: string,
  payload: unknown,
  audience: "all" | "staff" = "all"
): void {
  const target = io ?? (emitter ??= new Emitter(new Redis(env().REDIS_URL, { maxRetriesPerRequest: null })));
  if (audience === "staff") {
    target.to(`team:${team}`).emit(event, payload);
    return;
  }
  if (io) {
    io.to(`conversation:${conversationId}`).to(`team:${team}`).emit(event, payload);
    return;
  }
  target.to(`conversation:${conversationId}`).to(`team:${team}`).emit(event, payload);
}
