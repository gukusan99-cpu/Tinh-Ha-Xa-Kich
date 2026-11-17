# data/

Thư mục chứa số liệu cân bằng dùng chung.

## can-bang-v0.json
Số liệu cân bằng v0. Giá trị khởi đầu lấy từ `docs/04-can-bang-v0.md`, `docs/03-chien-dau-luot.md` và `docs/06-kien-truc.md`. Sẽ được chỉnh sau khi mô phỏng.

- Chỉ máy chủ (`server/`) đọc file này để tính kết quả. Client chỉ được đọc để hiển thị (tên, mô tả), không dùng để tính.
- Số liệu không được hard-code trong code. Luôn đọc từ file này.
- Đơn vị nằm trong tên khóa: `Tiles` là ô, `Seconds` là giây, `Degrees` là độ, `Turns` là lượt, `KB` là kilobyte. Tỉ lệ viết dạng thập phân: `0.05` nghĩa là 5%.

## Quy ước null
- Giá trị `null` nghĩa là tài liệu có nhắc đến khái niệm nhưng chưa có con số.
- Mọi khóa đang `null` được liệt kê trong mảng `chuaCoSo`.
- Khi điền số, xóa khóa khỏi `chuaCoSo` và ghi lý do thay đổi vào `docs/05-tien-do.md`.
