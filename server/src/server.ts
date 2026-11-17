import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  parseClientMessage,
  type ErrorCode,
  type ServerMessage,
} from "./protocol.js";

/** Quá số lỗi này trong một kết nối thì đóng (spec: "quá 5"). */
const MAX_ERRORS = 5;

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };
export const SERVER_VERSION: string = pkg.version;

export interface GameServer {
  /** Cổng thực sự đã bind (hữu ích khi tạo với port 0). */
  readonly port: number;
  close(): Promise<void>;
}

const ERROR_TEXT: Record<ErrorCode, string> = {
  bad_json: "Thông điệp không phải JSON hợp lệ",
  bad_version: "Phiên bản giao thức không được hỗ trợ",
  bad_message: "Thông điệp sai định dạng hoặc sai trường",
  not_hello: "Thông điệp đầu tiên phải là hello",
  unknown_type: "Loại thông điệp không được hỗ trợ",
  too_large: "Thông điệp quá lớn",
};

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function sendError(ws: WebSocket, code: ErrorCode, message = ERROR_TEXT[code]): void {
  send(ws, { v: PROTOCOL_VERSION, type: "error", code, message });
}

/**
 * Quá kích thước: ws (maxPayload = 4 KB) tự đóng kết nối với mã 1009 trước khi
 * ta thấy thông điệp, nên máy chủ không gửi được error `too_large` ở đường này.
 * `too_large` chỉ còn dùng trong parser như lớp bảo vệ thứ hai.
 */
export function createServer(opts: { port: number; host?: string }): Promise<GameServer> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({
      port: opts.port,
      host: opts.host,
      maxPayload: MAX_MESSAGE_BYTES,
    });

    wss.on("connection", (ws) => {
      let greeted = false;
      let errors = 0;

      const reject_ = (code: ErrorCode): void => {
        sendError(ws, code);
        errors++;
        if (errors > MAX_ERRORS) ws.close(1008, "too many errors");
      };

      ws.on("message", (data: RawData, isBinary: boolean) => {
        try {
          if (isBinary || Array.isArray(data)) {
            if (!greeted) return notHello();
            return reject_("bad_message");
          }
          const buf = data instanceof ArrayBuffer ? Buffer.from(data) : data;
          const res = parseClientMessage(buf);

          if (!greeted) {
            if (res.ok && res.message.type === "hello") {
              greeted = true;
              send(ws, {
                v: PROTOCOL_VERSION,
                type: "welcome",
                sessionId: randomUUID(),
                serverVersion: SERVER_VERSION,
                serverTime: Date.now(),
              });
              return;
            }
            return notHello();
          }

          if (!res.ok) return reject_(res.code);
          const msg = res.message;
          if (msg.type === "ping") {
            send(ws, { v: PROTOCOL_VERSION, type: "pong", seq: msg.seq, serverTime: Date.now() });
          } else {
            reject_("bad_message"); // hello lần hai
          }
        } catch (e) {
          console.error("lỗi xử lý thông điệp", e);
          ws.close(1011, "internal error");
        }
      });

      function notHello(): void {
        sendError(ws, "not_hello");
        ws.close(1008, "not_hello");
      }

      ws.on("error", () => ws.terminate());
    });

    wss.once("error", reject);
    wss.once("listening", () => {
      wss.off("error", reject);
      wss.on("error", (e) => console.error("lỗi máy chủ", e));
      const port = (wss.address() as AddressInfo).port;
      resolve({
        port,
        close: () =>
          new Promise<void>((res) => {
            for (const c of wss.clients) c.terminate();
            wss.close(() => res());
          }),
      });
    });
  });
}
