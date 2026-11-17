# 05. Tiến độ

## Giai đoạn hiện tại
**Giai đoạn 1:** lát cắt chơi được đã chạy thông end-to-end (đăng ký → tạo nhân vật → thành → vùng săn → chạm quái → trận → về thế giới). Giai đoạn 0 đã xong.

## Giai đoạn 1
- [x] Đặc tả giao thức và luật vật lý trận (`06-kien-truc.md`, `server/src/battle/types.ts`).
- [x] Dữ liệu: nhân vật, súng `thuoc_no_nho`, quái `am_thach_nho`, bản đồ thành, vùng săn, bản đồ trận.
- [x] Máy chủ: tài khoản (lưu trong bộ nhớ), thế giới, điều phối trận, engine trận tất định. 121 test.
- [x] Client: đăng nhập, tạo nhân vật, bản đồ thế giới, màn trận phát lại. 25 test.
- [x] Bot e2e `tests/e2e_full.gd` đi hết luồng, không lỗi.
- [ ] Người chơi thử bằng tay trong Godot editor, góp ý cảm giác điều khiển.
- [ ] Cân bằng: bot bắn ước lượng thua 2 quái sau 4 lượt. Cần xem lại máu người chơi, sát thương và `aiErrorTiles` của quái.
- [ ] Thay lưu trữ trong bộ nhớ bằng PostgreSQL/Redis (cần cài trên máy).

## Giai đoạn 0 (xong)
- [x] Viết `06-kien-truc.md`, mô hình đồng bộ lượt đã chốt.
- [x] Xác nhận 4 cung của bản thử nghiệm.
- [x] Tạo dự án Godot 4 với preset xuất Android và Web (chưa cài export template, Android SDK).
- [x] Tạo khung máy chủ Node.js với WebSocket, kết nối được với client.
- [x] Ghi lệnh chạy vào `CLAUDE.md`.
- [x] Chuyển số liệu cân bằng v0 vào `data/can-bang-v0.json` (14 giá trị chưa có số, xem `chuaCoSo`).

## Việc tồn đọng
- Bản Web đang suy địa chỉ máy chủ từ host của trang. Khi triển khai cần quyết định máy chủ game và web chung host (qua reverse proxy) hay đặt `tinh_ha/network/server_url`.
- Cài export template Godot 4.7.2 để xuất Web; cài Android SDK, JDK và keystore để xuất Android.

## Nhật ký thay đổi
- 2026-11-18: Giai đoạn 1. Điền giá trị đề xuất `moveRangeTiles` 5, `aimPowerRange` 0–100, `maxTurnsPerMatch` 20 và các hằng số vật lý trận (lý do: cần số để chạy được, sẽ chỉnh sau mô phỏng). Cài Git for Windows 2.56.1.
- 2026-11-18: Dựng khung Giai đoạn 0. Đổi `project.godot.txt` thành `project.godot` (Godot không nhận tên cũ). Thêm máy chủ `server/` (18 test), client Godot (6 test), `data/`, `docs/06-kien-truc.md`. Chạy thử end-to-end: client nhận `welcome` và `pong` từ máy chủ thật.
