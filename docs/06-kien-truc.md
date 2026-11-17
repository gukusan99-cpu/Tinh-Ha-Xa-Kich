# 06. Kiến trúc

Trạng thái: **đề xuất, chờ xác nhận.** Phần "Giao thức Giai đoạn 0" được dùng ngay để dựng khung. Phần "Đồng bộ lượt" là đề xuất cho Giai đoạn 1, chưa code cho tới khi được duyệt.

## Tổng thể
```
Client Godot (Android/Web)  <--WebSocket, JSON-->  Máy chủ Node.js (TypeScript)
                                                     ├─ PostgreSQL: tài khoản, tiến độ
                                                     └─ Redis: trạng thái trận đang chạy
```
- Client chỉ gửi **ý định** (di chuyển tới đâu, góc, lực, súng). Không bao giờ gửi kết quả (sát thương, trúng/trượt, vị trí đạn rơi).
- Máy chủ là nơi duy nhất đọc `data/` để tính kết quả. Client có thể đọc `data/` để hiển thị (tên, mô tả), không để tính.

## Cấu trúc thư mục
| Thư mục | Nội dung |
|---|---|
| `/` (gốc) | Dự án Godot: `project.godot`, `scenes/`, `scripts/` |
| `server/` | Máy chủ TypeScript, có `package.json` riêng |
| `data/` | Số liệu cân bằng dạng JSON, dùng chung |
| `docs/` | Tài liệu thiết kế |

Máy chủ nằm trong `server/` có file `.gdignore` để Godot không quét `node_modules/`.

## Giao thức Giai đoạn 0
Mỗi thông điệp là một object JSON, gửi dạng text frame:
```json
{ "v": 1, "type": "<loại>", ... }
```
- `v`: phiên bản giao thức. Máy chủ từ chối `v` khác phiên bản đang hỗ trợ.
- Kích thước tối đa một thông điệp: 4 KB. Lớn hơn thì đóng kết nối.

| Hướng | `type` | Trường thêm | Ghi chú |
|---|---|---|---|
| C→S | `hello` | `clientVersion: string` | Bắt buộc là thông điệp đầu tiên |
| S→C | `welcome` | `sessionId: string`, `serverVersion: string`, `serverTime: number` | Trả lời `hello` hợp lệ |
| C→S | `ping` | `seq: number` (số nguyên ≥ 0) | |
| S→C | `pong` | `seq: number`, `serverTime: number` | Lặp lại `seq` của client |
| S→C | `error` | `code: string`, `message: string` | Sau đó máy chủ có thể đóng kết nối |

Mã lỗi: `bad_json`, `bad_version`, `bad_message`, `not_hello`, `unknown_type`, `too_large`.

Quy tắc kiểm tra phía máy chủ:
- JSON hỏng, sai kiểu trường, thiếu trường: trả `error`, không làm sập máy chủ.
- Gửi bất cứ gì trước `hello`: `error` `not_hello` rồi đóng kết nối.
- Quá 5 thông điệp lỗi trong một kết nối: đóng kết nối.
- `serverTime` là mili giây Unix của máy chủ.

Cổng mặc định: `8080`, đổi bằng biến môi trường `PORT`.

## Đồng bộ lượt (đề xuất cho Giai đoạn 1)
Trả lời hai câu hỏi mở trong `03-chien-dau-luot.md`.

1. **Máy chủ giữ đồng hồ.** Mỗi pha có hạn chót tính theo giờ máy chủ, gửi cho client dưới dạng `deadline` tuyệt đối. Client chỉ đếm ngược để hiển thị.
2. **Gom lệnh rồi tính một lần.** Trong pha ngắm, client gửi `submit_shot` (góc, lực, súng). Có thể gửi lại để sửa trước hạn chót, lệnh sau thay lệnh trước. Khi mọi người đã gửi hoặc hết giờ, máy chủ khóa lệnh và mô phỏng toàn bộ pha bắn.
3. **Gửi kết quả một lần, kèm quỹ đạo đã tính.** Máy chủ gửi một gói `turn_result` gồm quỹ đạo từng viên đạn (các điểm lấy mẫu), điểm chạm, thay đổi địa hình, sát thương, hiệu ứng. Client chỉ phát lại, không mô phỏng vật lý. Lý do: client không thể lệch kết quả, và phát lại giống nhau trên mọi máy.
4. **Ngẫu nhiên có hạt giống.** Mỗi lượt máy chủ sinh một seed. Độ lệch quỹ đạo và chí mạng lấy từ seed đó. Lưu seed và lệnh vào Redis để phát lại và điều tra gian lận.
5. **Mất kết nối.** Hết giờ mà chưa có lệnh: không bắn, giữ nguyên vị trí (như `03`). Vắng 3 lượt liên tiếp: loại khỏi trận. Con số 3 nằm trong `data/`.
6. **Số lượt tối đa** được quyết định khi tạo trận, lấy từ dữ liệu vùng săn, gửi trong `match_start`.

## Việc chưa chốt
- Xác thực tài khoản (Giai đoạn 1).
- Định dạng địa hình (lưới ô hay bitmap) và độ phân giải lấy mẫu quỹ đạo.
