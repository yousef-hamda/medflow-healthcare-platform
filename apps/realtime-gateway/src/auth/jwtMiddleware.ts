/**
 * Socket.IO connection middleware — verifies the HS256 JWT from the handshake.
 *
 * The token must be supplied in one of:
 *  - query param  ?token=<jwt>
 *  - Authorization header  Bearer <jwt>
 *
 * On success the decoded payload is attached to socket.data.claims so
 * downstream handlers (join, etc.) can read it without re-verifying.
 */

import type { Socket } from "socket.io";
import jwt from "jsonwebtoken";
import type { TokenClaims } from "./roomAuth.js";
import type { Logger } from "../logger.js";

export interface AuthenticatedSocket extends Socket {
  data: {
    claims: TokenClaims;
    rawToken: string;
  };
}

type NextFn = (err?: Error) => void;

/**
 * Builds a Socket.IO middleware function that validates JWT tokens.
 *
 * @param signingKey  HS256 secret from JWT_SIGNING_KEY env var.
 * @param logger      Pino logger instance.
 */
export function buildJwtMiddleware(
  signingKey: string,
  logger: Logger,
): (socket: Socket, next: NextFn) => void {
  return (socket: Socket, next: NextFn): void => {
    // Extract raw token from query string or Authorization header
    const queryToken =
      typeof socket.handshake.query["token"] === "string"
        ? socket.handshake.query["token"]
        : undefined;

    const authHeader = socket.handshake.headers["authorization"];
    const headerToken =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : undefined;

    const rawToken = queryToken ?? headerToken;

    if (!rawToken) {
      logger.warn({ socketId: socket.id }, "JWT middleware: missing token");
      next(new Error("MISSING_TOKEN"));
      return;
    }

    let payload: TokenClaims;
    try {
      const decoded = jwt.verify(rawToken, signingKey, { algorithms: ["HS256"] });
      if (typeof decoded !== "object" || decoded === null || !("sub" in decoded)) {
        throw new Error("invalid payload shape");
      }
      payload = decoded as TokenClaims;
    } catch (err) {
      logger.warn(
        { socketId: socket.id, err: (err as Error).message },
        "JWT middleware: invalid token",
      );
      next(new Error("INVALID_TOKEN"));
      return;
    }

    // Attach claims and raw token to socket data for downstream handlers
    (socket as AuthenticatedSocket).data = {
      claims: payload,
      rawToken,
    };

    next();
  };
}
