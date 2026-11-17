# Máy chủ Tinh Hà Xạ Kích (Giai đoạn 1)

Máy chủ WebSocket TypeScript. Giao thức: `docs/06-kien-truc.md` (Giai đoạn 0 và mục "Giai đoạn 1: đặc tả triển khai").

## Lệnh
```
cd server
npm install
npm run dev         # chạy chế độ phát triển (tự nạp lại)
npm test            # chạy test (vitest)
npm run typecheck   # kiểm tra kiểu (gồm cả test)
npm run build       # biên dịch ra dist/
npm start           # chạy bản đã build
```

Cổng mặc định `8080`, đổi bằng biến môi trường `PORT` (PowerShell: `$env:PORT=9000; npm start`).

## Cấu trúc `src/`
| File | Vai trò |
|---|---|
| `protocol.ts` | Kiểu thông điệp, parser kiểm tay từng trường |
| `data.ts` | Nạp và kiểm tra `data/` (không có số cân bằng hard-code) |
| `accounts.ts` | `AccountStore` + `MemoryAccountStore`, scrypt, exp/cấp |
| `world.ts` | Thế giới: di chuyển, tường, cổng, quái lang thang, chạm quái (`step(dt)` thuần) |
| `match.ts` | Bộ chạy trận: pha move/aim, hạn chót, kick, kết quả |
| `clock.ts` | `Clock` có thể thay thế (`realClock`, `scaledClock`) |
| `server.ts` | Nối tất cả; `createServer({ clock, data, timing, store, random, seed })` |
| `battle/` | Engine trận (hàm thuần, đã chốt) |

## Ghi chú
- Thông điệp lớn hơn 4 KB: thư viện `ws` tự đóng kết nối với mã 1009, không có `error` `too_large`.
- Quá 5 thông điệp lỗi (kể cả `not_allowed`) trong một kết nối thì đóng (mã 1008).
- `register` thành công cũng đăng nhập luôn. Đăng nhập lại ở kết nối mới gửi `error not_allowed` rồi đóng kết nối cũ bằng mã 4001.
- Tài khoản lưu trong bộ nhớ: khởi động lại là mất. Chờ bản PostgreSQL/Redis.
- Test tích hợp dùng `scaledClock(20)` và `createServer({ data })` với dữ liệu đã chỉnh; `server.world.teleport()` để ép chạm quái.
