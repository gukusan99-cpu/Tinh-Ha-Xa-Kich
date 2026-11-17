/** Giao thức Giai đoạn 0 (xem docs/06-kien-truc.md). */

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 4096;
export const MAX_CLIENT_VERSION_LENGTH = 32;

export type ErrorCode =
  | "bad_json"
  | "bad_version"
  | "bad_message"
  | "not_hello"
  | "unknown_type"
  | "too_large";

export interface HelloMessage {
  v: 1;
  type: "hello";
  clientVersion: string;
}
export interface PingMessage {
  v: 1;
  type: "ping";
  seq: number;
}
export type ClientMessage = HelloMessage | PingMessage;

export interface WelcomeMessage {
  v: 1;
  type: "welcome";
  sessionId: string;
  serverVersion: string;
  serverTime: number;
}
export interface PongMessage {
  v: 1;
  type: "pong";
  seq: number;
  serverTime: number;
}
export interface ErrorMessage {
  v: 1;
  type: "error";
  code: ErrorCode;
  message: string;
}
export type ServerMessage = WelcomeMessage | PongMessage | ErrorMessage;

export type ParseResult = { ok: true; message: ClientMessage } | { ok: false; code: ErrorCode };

const fail = (code: ErrorCode): ParseResult => ({ ok: false, code });

/** Kiểm tra từng trường bằng tay; không tin bất cứ gì từ client. */
export function parseClientMessage(raw: string | Buffer): ParseResult {
  const byteLength = typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.length;
  if (byteLength > MAX_MESSAGE_BYTES) return fail("too_large");

  let data: unknown;
  try {
    data = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  } catch {
    return fail("bad_json");
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) return fail("bad_message");
  const obj = data as Record<string, unknown>;

  if (obj.v !== PROTOCOL_VERSION) return fail("bad_version");
  if (typeof obj.type !== "string") return fail("bad_message");

  switch (obj.type) {
    case "hello": {
      const cv = obj.clientVersion;
      if (typeof cv !== "string" || cv.length === 0 || cv.length > MAX_CLIENT_VERSION_LENGTH) {
        return fail("bad_message");
      }
      return { ok: true, message: { v: 1, type: "hello", clientVersion: cv } };
    }
    case "ping": {
      const seq = obj.seq;
      if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) return fail("bad_message");
      return { ok: true, message: { v: 1, type: "ping", seq } };
    }
    default:
      return fail("unknown_type");
  }
}
