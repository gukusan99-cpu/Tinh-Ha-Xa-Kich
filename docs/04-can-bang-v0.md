# 04. Cân bằng v0

Giá trị khởi đầu, sẽ được kiểm chứng bằng mô phỏng. Đặt trong file dữ liệu, không hard-code trong code.

## Nguyên tắc
- **Kỹ năng chiếm khoảng 70%** kết quả trận. Yếu tố khác chiếm khoảng 30%.
- Mọi hiệu ứng khu vực được cảnh báo trước một lượt.
- Không có hiệu ứng nào quyết định trận ngay lập tức.

## Nguồn biến thiên (ước tính)
| Nguồn | Trọng số ước tính | Cách kiềm chế |
|---|---|---|
| Chênh lệch chỉ số | ~15% | Giới hạn chênh lệch tối đa 15% trong cùng khoảng cấp |
| Trang bị | ~5% | Trang bị chỉ thêm 5–10% chỉ số |
| Ngẫu nhiên khi bắn | ~7% | Lệch tối đa ±3 ô, chí mạng 5% |
| Ngẫu nhiên vị trí rơi | ~3% | Vị trí rơi quanh tâm cố định |

## Giá trị khởi đầu
| Mục | Giá trị v0 | Ghi chú |
|---|---|---|
| Lệch quỹ đạo | ±3 ô | Giảm khi Chính xác tăng |
| Chí mạng | 5%, nhân 1.5 | |
| Chênh lệch chỉ số tối đa trong trận | 15% | Trong cùng khoảng cấp |
| Thiên thạch: bán kính hố | 2 ô | Đào hố sâu, chỉ trong trận |
| Thiên thạch: thiêu đốt | 2 lượt, sát thương nhỏ mỗi lượt | |
| Thiên thạch: choáng | 1 lượt | |
| Sao băng: số viên | 4 ở cấp 1, tối đa 10 | Tăng theo đường cong giảm dần |
| Sao băng: bán kính mỗi viên | 1 ô | Tổng vùng rộng hơn thiên thạch |
| Nội lực hồi | 2 điểm mỗi lượt | Đủ dùng một súng hiếm mỗi 2–3 lượt |
| Thời gian hồi súng hiếm | 1–2 lượt | |
| Thời gian hồi súng thường | 0 | |

## Kiểm chứng bằng mô phỏng
- Bot ngẫu nhiên và bot giỏi (chọn góc gần mục tiêu nhất, tránh vùng cảnh báo).
- Mục tiêu: bot giỏi thắng khoảng 70% trở lên.
- Không súng nào thắng quá 60% khi dùng đúng cách.
- Chạy vài nghìn trận với mỗi bộ giá trị để so sánh.

## Điều chỉnh sau thử nghiệm
Ghi lại mọi thay đổi số liệu vào `05-tien-do.md` kèm lý do.
