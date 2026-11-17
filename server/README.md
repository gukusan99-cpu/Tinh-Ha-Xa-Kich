# Máy chủ Tinh Hà Xạ Kích (Giai đoạn 0)

Máy chủ WebSocket TypeScript. Giao thức: xem `docs/06-kien-truc.md`, mục "Giao thức Giai đoạn 0".

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

## Ghi chú
- Thông điệp lớn hơn 4 KB: thư viện `ws` tự đóng kết nối với mã 1009, không có `error` `too_large`.
- Quá 5 thông điệp lỗi trong một kết nối thì đóng (mã 1008). Gửi gì khác `hello` hợp lệ trước tiên thì nhận `not_hello` rồi bị đóng.
