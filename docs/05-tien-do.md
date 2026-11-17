# 05. Tiến độ

## Giai đoạn hiện tại
**Giai đoạn 0:** gần xong. Client và máy chủ đã nối được với nhau. Còn chờ duyệt phần đồng bộ lượt trong `06-kien-truc.md` và xác nhận 4 cung.

## Việc cần làm
- [x] Viết `06-kien-truc.md`: giao thức Giai đoạn 0 (đã dùng). Phần đồng bộ lượt: **chờ duyệt**.
- [ ] Xác nhận 4 cung của bản thử nghiệm.
- [x] Tạo dự án Godot 4 với preset xuất Android và Web (chưa cài export template, Android SDK).
- [x] Tạo khung máy chủ Node.js với WebSocket, kết nối được với client.
- [x] Ghi lệnh chạy vào `CLAUDE.md`.
- [x] Chuyển số liệu cân bằng v0 vào `data/can-bang-v0.json` (14 giá trị chưa có số, xem `chuaCoSo`).

## Việc tồn đọng
- Bản Web đang suy địa chỉ máy chủ từ host của trang. Khi triển khai cần quyết định máy chủ game và web chung host (qua reverse proxy) hay đặt `tinh_ha/network/server_url`.
- Cài export template Godot 4.7.2 để xuất Web; cài Android SDK, JDK và keystore để xuất Android.

## Nhật ký thay đổi
- 2026-11-18: Dựng khung Giai đoạn 0. Đổi `project.godot.txt` thành `project.godot` (Godot không nhận tên cũ). Thêm máy chủ `server/` (18 test), client Godot (6 test), `data/`, `docs/06-kien-truc.md`. Chạy thử end-to-end: client nhận `welcome` và `pong` từ máy chủ thật.
