# 09. Vùng săn thứ hai (Giai đoạn 2)

Giá trị do Claude đề xuất, người dùng có thể đổi. Số liệu nằm trong `data/`.

## Hẻm Vẫn Thạch (`vung_san_2`)
- Đi tới từ **cổng phía trên của thành**. Cổng yêu cầu **cấp 2** (`levelRequired` của cổng). Vùng 1 cho 20 exp mỗi quái, nên cần khoảng 3 trận thắng ở vùng 1.
- Khó hơn vùng 1: quái **biết di chuyển** trong trận, nên hiệu ứng chậm, choáng và đẩy lùi có giá trị trong PvE.
- Bản đồ trận `hem_van_thach_1`: hai cao nguyên hai bên, giữa là hẻm sâu. Đáy hẻm vẫn là đất (không rơi khỏi bản đồ), nhưng leo ra phải đi từng bậc.

## Quái mới
| id | Tên | Đặc điểm |
|---|---|---|
| `am_thach_gai` | Ám Thạch Gai | Đi theo nhóm 2, súng `gai_lua` gây cháy, di chuyển tối đa 3 cột mỗi lượt |
| `am_thach_lon` | Ám Thạch Lớn | Đi một mình, máu nhiều, súng `da_tang` nổ rộng, không di chuyển |

Mỗi điểm sinh quái chỉ sinh một loại. Chạm vào quái nào thì vào trận với nhóm quái loại đó.

## Quái di chuyển (`moveRangeTiles` trong `data/quai.json`)
- Trong pha di chuyển, mỗi quái có `moveRangeTiles > 0` chọn một cột đích trong tầm, bằng RNG có seed của lượt. Quái ưu tiên cột mà từ đó `chooseMonsterShot` chạm gần người chơi nhất; hai cột tốt bằng nhau thì chọn cột xa người chơi hơn. Lệnh di chuyển đi qua `applyMoves` như người chơi, nên choáng và chậm có tác dụng.
- Quái quyết định trước khi biết người chơi đi đâu, tức là đồng thời như người chơi.

## Cổng khóa cấp
- `portals[].levelRequired` (tùy chọn). Người chơi chưa đủ cấp đứng vào cổng thì không bị chuyển bản đồ, và nhận S→C `portal_locked` {`levelRequired`} tối đa một lần mỗi `portalLockedNoticeSeconds` giây.

## Mục tiêu cân bằng
- Vùng 2 phải khó hơn vùng 1 cho mọi cung: bot giỏi thắng ≥ 70%, bot trung bình thắng khoảng 30–45%, chênh lệch giữa các cung ≤ 15 điểm.
