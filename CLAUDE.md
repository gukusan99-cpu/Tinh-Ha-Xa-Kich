# Tinh Hà Xạ Kích: hướng dẫn cho Claude Code

## Dự án
Game online nhập vai có bắn theo lượt đồng thời. Người chơi đi lại trên bản đồ, chạm vào quái để vào trận, và cả nhóm bắn cùng lúc trong 30 giây mỗi lượt.

## Công nghệ
- **Client:** Godot 4 (GDScript). Đích xuất: Android và Web trước, PC sau.
- **Máy chủ:** TypeScript với Node.js, giao tiếp bằng WebSocket.
- **Cơ sở dữ liệu:** PostgreSQL cho tài khoản và tiến độ. Redis cho trạng thái trận đang chạy.

## Quy tắc bất biến
1. **Máy chủ quyết định mọi kết quả bắn.** Client chỉ hiển thị và gửi lệnh. Không tin dữ liệu từ client.
2. **Tài liệu thiết kế trong `docs/` là nguồn chân lý.** Khi code mâu thuẫn với tài liệu, hỏi lại trước khi đổi.
3. **Không tự đổi quyết định thiết kế đã chốt** (xem `docs/01-tong-quan.md`, mục Quyết định). Nếu thấy cần đổi, đề xuất và chờ xác nhận.
4. **Con số cân bằng nằm trong file dữ liệu, không hard-code.** Dùng `data/` (JSON hoặc Resource của Godot). Số trong `docs/04-can-bang-v0.md` là giá trị khởi đầu.
5. **Không sao chép code, đồ họa, âm thanh hay tài nguyên của game khác.** Mọi asset là placeholder hoặc tự làm.
6. **Mỗi thay đổi nhỏ là một commit riêng,** có thông điệp mô tả rõ thay đổi.

## Phạm vi bản thử nghiệm (hiện hành)
- 4 cung mở: Bạch Dương, Kim Ngưu, Xử Nữ, Bảo Bình (đề xuất, chờ xác nhận).
- Súng: thường và hiếm. Súng thần thoại để sau.
- 1 thành, 2 vùng săn.
- PvE theo lượt. PvP chỉ thách đấu, và đánh tự do trong sự kiện.
- Điều khiển: cảm ứng trên Android và Web. PC để sau.

## Quy trình làm việc
- Bắt đầu mỗi phiên bằng việc đọc `docs/` và báo lại tiến độ hiện tại.
- Với mỗi tính năng: viết test trước khi code khi có thể, chạy test, rồi commit.
- Giai đoạn hiện tại được ghi trong `docs/05-tien-do.md`. Cập nhật file này khi xong mỗi giai đoạn.

## Lệnh thường dùng
Trên máy này `godot` và `git` chưa có trong PATH:
- Godot: `$godot = "$env:USERPROFILE\Downloads\Godot_v4.7.2-stable_win64.exe\Godot_v4.7.2-stable_win64_console.exe"`
- Git: `C:\Users\Admin\AppData\Local\GitHubDesktop\app-3.6.10\resources\app\git\cmd\git.exe` (git đi kèm GitHub Desktop)

Máy chủ (chạy trong `server/`):
- Cài: `npm install`
- Chạy khi phát triển: `npm run dev` (cổng 8080, đổi bằng `$env:PORT`)
- Test: `npm test`, kiểm kiểu: `npm run typecheck`, build: `npm run build`, chạy bản build: `npm start`

Client Godot (chạy ở thư mục gốc):
- Mở editor: `& $godot --path . --editor`
- Test đơn vị: `& $godot --headless --path . --script res://tests/run_tests.gd`
- Test nối máy chủ (cần máy chủ đang chạy): `& $godot --headless --path . --script res://tests/e2e_probe.gd`
