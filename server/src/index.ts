import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer, SERVER_VERSION } from "./server.js";

const raw = process.env.PORT;
const port = raw === undefined || raw === "" ? 8080 : Number(raw);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`PORT không hợp lệ: ${raw}`);
  process.exit(1);
}

// WEB_DIR: thư mục bản xuất Web; mặc định ../build/web nếu có.
const webDir = process.env.WEB_DIR || fileURLToPath(new URL("../../build/web", import.meta.url));
const staticDir = existsSync(webDir) ? webDir : undefined;

const server = await createServer({ port, staticDir });
console.log(`Tinh Hà Xạ Kích server v${SERVER_VERSION} đang lắng nghe ở cổng ${server.port}`);
if (staticDir) console.log(`Bản Web: http://localhost:${server.port}/`);

const shutdown = (): void => {
  console.log("Đang tắt máy chủ...");
  void server.close().then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
