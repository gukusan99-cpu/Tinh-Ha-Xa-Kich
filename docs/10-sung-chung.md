# 10. Súng thường và súng hiếm chung (Giai đoạn 2)

Cụ thể hóa bảng "Súng thường" và "Súng hiếm" của `02`. Trạng thái: **đề xuất của Claude, chờ người dùng xác nhận** (soạn khi người dùng vắng mặt). Code được viết theo đề xuất này để thử; mọi con số nằm trong `data/`.

## Cách có súng (đề xuất)
- Súng chung **rơi ra khi thắng trận PvE**: mỗi quái có bảng rơi `drops` [{gunId, chance}]. Mỗi trận thắng, mỗi quái bị hạ quay một lần theo bảng của nó.
- Nhân vật có **kho súng** `ownedGunIds` (không trùng). `thuoc_no_nho` có sẵn từ đầu.
- **Trang bị:** ngoài 3 súng cung, người chơi mang tối đa `extraGunSlots` (= 2) súng chung đã có. Đổi trang bị chỉ trong thành bằng C→S `set_loadout` {gunIds}. Máy chủ kiểm tra súng có trong kho và đủ số ô.
- Không mua bán, không nạp tiền (giữ quyết định "không bán lợi thế" của `01`).
- PvP dùng đúng trang bị hiện tại.

## Cơ chế mới
| Súng | Tầng | kind | Cơ chế |
|---|---|---|---|
| Súng ba tia | thường | `spread` | 3 viên cùng power, góc lệch `angleOffsets` (ví dụ −4°, 0, +4°) |
| Liên thanh | thường | `burst` | 5 viên, power lệch nhẹ; dùng lại `burst` |
| Súng hơi | thường | `projectile` | Sát thương thấp, đẩy lùi 2 cột |
| Thuốc nổ nhỏ | thường | `projectile` | Như hiện có |
| Laser | hiếm | `beam` | Tia thẳng theo góc bắn, không chịu trọng lực, dài `beamLengthTiles`; xuyên tối đa `pierceTiles` ô đất (không phá đất); gây sát thương cho mọi đơn vị địch mà tia đi qua (khoảng cách tới tâm ≤ unitRadius) |
| Tơ nhện | hiếm | `projectile` | Trúng thì gắn hiệu ứng **trói** (`root`): không di chuyển lượt kế tiếp; vẫn bắn được (khác choáng ở tên hiển thị, cùng cơ chế với choáng hiện tại) |
| Nọc độc | hiếm | `projectile` + `zone` | Tại điểm chạm tạo **vũng độc** bán kính `zone.radiusTiles`. Lượt bắn: chỉ hiện cảnh báo. Từ lượt kế tiếp, cuối mỗi lượt đơn vị địch trong vũng bị gắn độc; vũng tồn tại `zone.turns` lượt. Đây là vùng hiệu ứng kéo dài nên **được cảnh báo trước một lượt** theo `03` |
| Phun lửa | hiếm | `spread` | 5 viên power thấp, góc lệch rộng, tầm ngắn (power bị giới hạn `maxPower`), mỗi viên gây cháy. Gió chưa có trong game, nên bỏ qua dòng "ảnh hưởng bởi gió" |
| Lưới băng | hiếm | `projectile` | Nổ bán kính lớn, sát thương thấp, gắn chậm |
| Dây điện | hiếm | `projectile` + `chain` | Trúng đơn vị thì điện chuyền tới tối đa `chain.maxTargets` đơn vị địch khác trong `chain.radiusTiles`, mỗi bước giảm `chain.falloff` |

Hiệu ứng mới: **độc** (`poison`): như cháy, theo `03` (tối đa 2 lượt). **Trói** (`root`): tối đa 1 lượt.

## Giao thức
- `Character` thêm `ownedGunIds`, `loadout` (danh sách súng chung đang mang).
- C→S `set_loadout` {gunIds} → S→C `character`. Lỗi `not_allowed` nếu không ở thành hoặc súng không hợp lệ.
- `match_end` thêm `drops: string[]` (súng mới nhận; súng đã có thì không tính).
- `turn_result` thêm `zones` (vũng đang tồn tại sau lượt: {id, x, y, radius, turnsLeft, active}) và `chainHits` [{fromUnitId, toUnitId, amount}]. `ShotResult.beam` {from, to} cho laser.
- `phase` gửi kèm `zones` để client vẽ cảnh báo.

## Cân bằng
- Súng chung phải là **lựa chọn ngang hàng**, không mạnh hơn súng cung: mô phỏng PvE theo cung, có và không có súng chung, chênh lệch tỉ lệ thắng của bot trung bình ≤ 8 điểm. PvP: không cặp nào vượt 60%.
