# 03. Chiến đấu theo lượt

Tài liệu này mô tả luật chơi. Chi tiết đồng bộ mạng và cấu trúc thông điệp sẽ được chốt ở tài liệu kiến trúc, sau khi thiết kế.

## Luồng một lượt
1. **Pha di chuyển (tối đa 15 giây):** mỗi người chơi di chuyển trong phạm vi cho phép.
2. **Pha ngắm (tối đa 30 giây):** chọn súng, đạn, chỉnh góc và lực bằng thao tác chạm.
3. **Pha bắn đồng thời:** mọi người bắn cùng lúc. Máy chủ tính quỹ đạo và kết quả.
4. **Pha phát lại:** client hiển thị quỹ đạo và hiệu ứng theo dữ liệu từ máy chủ.

## Góc và lực
- Góc bắn giới hạn theo bản đồ, giá trị đề xuất: từ -30° đến 80°.
- Lực đặt bằng thao tác chạm, có thể ngắt quãng để chọn.
- Chỉnh góc và lực không tốn thời gian ngắm ngoài khung 30 giây.

## Cảnh báo trước một lượt
- Mọi vùng ảnh hưởng (hố thiên thạch, vùng cháy, vùng sao băng, vùng độc) được hiển thị ở lượt trước khi hiệu ứng xảy ra.
- Người chơi có thể né hoặc chuẩn bị.

## Độ lệch quỹ đạo
- Lệch tối đa ±3 ô, giảm khi chỉ số Chính xác tăng.
- Chí mạng: 5% cơ hội, nhân sát thương 1.5.
- Độ lệch được tính trên máy chủ, không phụ thuộc client.

## Địa hình
- Hố, đất vỡ và thay đổi địa hình chỉ có hiệu lực trong trận.
- Khi trận kết thúc, địa hình được khôi phục về trạng thái ban đầu của bản đồ.

## Trạng thái hiệu ứng
- **Cháy:** sát thương nhỏ mỗi lượt, tối đa 2 lượt.
- **Độc:** sát thương nhỏ mỗi lượt, tối đa 2 lượt.
- **Choáng:** mất lượt di chuyển, tối đa 1 lượt.
- **Chậm:** giảm quãng di chuyển, tối đa 1 lượt.
- Một đối thủ không nhận cùng một hiệu ứng từ hai nguồn trong cùng một lượt. Nguồn mới thay thế nguồn cũ nếu mạnh hơn.

## Mất kết nối
- Người chơi mất kết nối trong pha ngắm: máy chủ tự chọn hành động mặc định (không bắn, giữ nguyên vị trí).
- Người chơi mất kết nối nhiều lượt liên tiếp: bị loại khỏi trận, nhận phần thưởng an ủi nhỏ.
- Cơ chế cụ thể sẽ chốt ở tài liệu kiến trúc.

## Thoát và kết thúc trận
- Trận kết thúc khi một bên không còn người chơi hoặc quái còn sống.
- Phần thưởng: kinh nghiệm, trang bị, tinh thể nâng cấp.

## Câu hỏi còn mở
- Cách đồng bộ khi nhiều người bắn cùng lúc: máy chủ gửi kết quả một lần hay từng phát bắn?
- Thời điểm máy chủ quyết định số lượt tối đa của một trận.
