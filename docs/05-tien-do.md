# 05. Tiến độ

## Giai đoạn hiện tại
**Giai đoạn 2:** đã có đủ 4 cung với 12 súng, nội lực, hiệu ứng trạng thái và nội tại (`docs/07`), đã cân bằng PvE bằng mô phỏng. Đã có thách đấu PvP. Còn lại của Giai đoạn 2: súng thường/hiếm chung, vùng săn thứ hai. Giai đoạn 0 và 1 đã xong.

## Giai đoạn 2
- [x] Đặc tả `07-cung-va-sung.md`; 4 cung, 12 súng cung, nội lực, hồi chiêu, hiệu ứng, nội tại, đường ngắm Súng kính.
- [x] Máy chủ, client, mô phỏng theo từng cung; cân bằng PvE v2.
- [ ] Súng thường và súng hiếm chung (`02`: ba tia, liên thanh, súng hơi, laser, tơ nhện, nọc độc, phun lửa, lưới băng, dây điện).
- [ ] Vùng săn thứ hai.
- [x] Thách đấu PvP 1 đấu 1 trong thành, bản đồ đấu trường đối xứng, cân bằng cặp cung bằng mô phỏng (cặp lệch nhất 52%). Hai bot đã đấu nhau qua máy chủ thật.
- [ ] Quái biết di chuyển (để hiệu ứng khống chế có giá trị trong PvE).

## Giai đoạn 1
- [x] Đặc tả giao thức và luật vật lý trận (`06-kien-truc.md`, `server/src/battle/types.ts`).
- [x] Dữ liệu: nhân vật, súng `thuoc_no_nho`, quái `am_thach_nho`, bản đồ thành, vùng săn, bản đồ trận.
- [x] Máy chủ: tài khoản (lưu trong bộ nhớ), thế giới, điều phối trận, engine trận tất định. 121 test.
- [x] Client: đăng nhập, tạo nhân vật, bản đồ thế giới, màn trận phát lại. 25 test.
- [x] Bot e2e `tests/e2e_full.gd` đi hết luồng, không lỗi.
- [ ] Người chơi thử bằng tay trong Godot editor, góp ý cảm giác điều khiển.
- [x] Cân bằng PvE v1 bằng mô phỏng (`npm run sim` trong `server/`): bot giỏi thắng 90%, trung bình 46%, ngẫu nhiên 0%, trận khoảng 7 lượt.
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
- 2026-11-18: Thách đấu PvP (`docs/08`). Cân bằng PvP bằng mô phỏng 10 cặp cung × 400 trận, bot giỏi có né: trước khi chỉnh, Xử Nữ thắng Kim Ngưu 60% và Kim Ngưu yếu ở mọi cặp. Súng tiểu liên 12 → 14, Súng nặng 44 → 50, Súng băng 40 → 36, Đạn sao 28 → 30. Sau chỉnh: cặp lệch nhất 52% (mục tiêu ≤ 60%), hòa 9–28%. PvE sau chỉnh (giỏi | trung bình): Bạch Dương 94,3 | 56,5; Kim Ngưu 95,9 | 63,3; Xử Nữ 95,4 | 47,9; Bảo Bình 92,4 | 55,2. Ưu tiên công bằng PvP; Kim Ngưu hơi mạnh ở PvE, theo dõi khi thử nghiệm.
- 2026-11-18: Cân bằng 4 cung (mô phỏng 2000 trận mỗi cung). Súng 2 nội lực (Súng nung đỏ, Đạn lạnh, Súng nặng) tăng lên 3, vì hồi 2 mỗi lượt khiến chúng bắn được liên tục và súng cơ bản của cung bị bỏ không. Tách súng quái `da_am_thach` (35) khỏi súng chung `thuoc_no_nho` (35 → 30), để súng cung luôn hơn súng chung mà không làm quái yếu đi. Pháo đạn nổ 40 → 32, Súng nặng 60 → 44, Súng tiểu liên 14 → 12, Súng băng 30 → 40, Đạn sao 22 → 28, giảm sát thương Kim Ngưu 15% → 6%. Kết quả (bot giỏi | trung bình): Bạch Dương 93,3 | 56,5; Kim Ngưu 94,2 | 58,7; Xử Nữ 95,3 | 52,1; Bảo Bình 88,3 | 50,8. Lưu ý: hiệu ứng chậm/choáng/đẩy lùi chưa được đánh giá vì quái không di chuyển; cần đo lại khi có PvP.
- 2026-11-18: Cân bằng PvE. `baseHp` 100 → 150, máu `am_thach_nho` 80 → 65, `aiErrorTiles` 4 → 8. Lý do: mô phỏng 2000 trận với số cũ cho bot giỏi chỉ thắng 6,6%. Số mới: giỏi 90,3%, trung bình 46,1%, ngẫu nhiên 0%, trung bình 7,2 lượt (mục tiêu `04`: giỏi ≥70%). Đã thử thêm 13 bộ số khác; bộ này gần mọi mục tiêu nhất.
- 2026-11-18: Giai đoạn 1. Điền giá trị đề xuất `moveRangeTiles` 5, `aimPowerRange` 0–100, `maxTurnsPerMatch` 20 và các hằng số vật lý trận (lý do: cần số để chạy được, sẽ chỉnh sau mô phỏng). Cài Git for Windows 2.56.1.
- 2026-11-18: Dựng khung Giai đoạn 0. Đổi `project.godot.txt` thành `project.godot` (Godot không nhận tên cũ). Thêm máy chủ `server/` (18 test), client Godot (6 test), `data/`, `docs/06-kien-truc.md`. Chạy thử end-to-end: client nhận `welcome` và `pong` từ máy chủ thật.
