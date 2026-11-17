# 01. Tổng quan

## Ý tưởng
Game online nhập vai có bắn theo lượt đồng thời. Người chơi chọn một cung hoàng đạo khi tạo nhân vật, sử dụng súng để chiến đấu cùng nhóm, và phát triển nhân vật qua các trận đánh.

## Cốt truyện (tóm tắt)
Mười hai chòm sao từng giữ cân bằng cho bầu trời. Một mảnh tinh thể rơi xuống trái đất, làm vỡ vòng sáng bảo vệ các chòm sao. Sinh vật Ám Thạch xuất hiện từ các mảnh vỡ, và các Thủ Hộ Tinh Tú bị phân tán khắp bốn vùng đất.

Người chơi là Xạ Thủ Tân Tinh, được Đài Quan Tinh triệu tập để thu thập mảnh tinh thể và đánh thức từng chòm sao. Khi đủ mười hai chòm sao, bầu trời được vá lại.

Cốt truyện đầy đủ sẽ được mở rộng sau bản thử nghiệm.

## Quyết định đã chốt
| Mục | Quyết định |
|---|---|
| Nền tảng | Android và Web trước, PC sau, iOS để sau |
| Engine | Godot 4 |
| Máy chủ | TypeScript với Node.js, tự xây dựng |
| Số cung bản thử nghiệm | 4 cung: Bạch Dương, Kim Ngưu, Xử Nữ, Bảo Bình (chốt 2026-11-18) |
| Đồng bộ lượt | Máy chủ gom lệnh, mô phỏng một lần, gửi kết quả kèm quỹ đạo (xem `06-kien-truc.md`, chốt 2026-11-18) |
| Khóa cung | Khóa vĩnh viễn sau khi chọn. Đệ tử cung khác và kết hợp để sau |
| PvP | Chỉ thách đấu trong thường ngày. Đánh tự do trong một số sự kiện |
| Điều khiển | Cảm ứng cho bản thử nghiệm |
| Súng | Thường, hiếm trong thử nghiệm. Thần thoại để sau |
| Địa hình | Đào, phá đất chỉ có hiệu lực trong trận, khôi phục khi trận kết thúc |
| Kinh tế | Miễn phí, không bán lợi thế chiến đấu |

## Phạm vi bản thử nghiệm
- 4 cung, 12 khẩu súng của 4 cung (3 mỗi cung), cộng súng thường và súng hiếm.
- 1 thành (khu an toàn).
- 2 vùng săn, quái đi lại trên bản đồ, chạm vào quái để vào trận.
- Chiến đấu theo lượt: di chuyển, ngắm, bắn đồng thời, phát lại.
- Thách đấu PvP, và chế độ đánh tự do trong một sự kiện thử nghiệm.
- Lên cấp, cộng điểm chỉ số, kỹ năng.
- Máy chủ quyết định kết quả, đồng bộ trạng thái lượt.

**Không nằm trong bản thử nghiệm:** súng thần thoại, 8 cung còn lại, đệ tử và kết hợp cung, clan, xếp hạng toàn máy chủ, bản PC, iOS, nạp tiền.

## Lộ trình
1. **Giai đoạn 0:** khung dự án Godot và máy chủ Node.js, kết nối được với nhau.
2. **Giai đoạn 1:** lát cắt chơi được. Đăng nhập, một thành, một vùng săn, một trận với một khẩu súng.
3. **Giai đoạn 2:** đủ 4 cung, đủ súng thường và hiếm, hai vùng săn, thách đấu.
4. **Giai đoạn 3:** cân bằng bằng mô phỏng, thử nghiệm qua đường link Web.
5. **Giai đoạn 4:** sự kiện PvP, xuất bản Android, thêm PC.

## Câu hỏi còn mở
- Tên chính thức của game (hiện là tên tạm).
