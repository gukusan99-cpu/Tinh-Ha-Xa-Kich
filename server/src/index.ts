import { createServer, SERVER_VERSION } from "./server.js";

const raw = process.env.PORT;
const port = raw === undefined || raw === "" ? 8080 : Number(raw);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`PORT không hợp lệ: ${raw}`);
  process.exit(1);
}

const server = await createServer({ port });
console.log(`Tinh Hà Xạ Kích server v${SERVER_VERSION} đang lắng nghe ở cổng ${server.port}`);

process.on("SIGINT", () => {
  console.log("Đang tắt máy chủ...");
  void server.close().then(() => process.exit(0));
});
