# 08. Thách đấu PvP (Giai đoạn 2)

Cụ thể hóa dòng "PvP: chỉ thách đấu trong thường ngày" của `01`. Đánh tự do trong sự kiện để Giai đoạn 4.

## Quy tắc (giá trị mặc định do Claude đề xuất, người dùng có thể đổi)
- **1 đấu 1**, chỉ khi **cả hai đang ở trong thành** (khu an toàn), không ở trong trận.
- **Không có phần thưởng** exp hay vật phẩm, để tránh hai tài khoản dàn xếp để cày. Chỉ ghi thành tích thắng, thua, hòa.
- Mỗi người chỉ có **một lời mời đang chờ** (gửi hoặc nhận). Lời mời hết hạn sau `challengeTimeoutSeconds`.
- Bị từ chối: phải đợi `challengeRetrySeconds` mới mời lại đúng người đó.
- Bản đồ trận đối xứng `dau_truong_1`. Người mời đứng bên trái (team 0), người nhận đứng bên phải (team 1), hai người quay mặt vào nhau.
- Luật lượt, nội lực, súng, nội tại giống trận PvE. Số lượt tối đa `pvpMaxTurns`, hết lượt thì hòa.
- Hai bên cùng chỉ số gốc. Giới hạn chênh lệch 15% của `04` chưa cần, vì chưa có cộng điểm chỉ số.
- Mất kết nối: bỏ lỡ `disconnectMissedTurnsToKick` lượt liên tiếp thì bị loại, tức là thua.
- Hết trận: cả hai về điểm xuất phát của thành và nhận `world_state`.

## Giao thức
| Hướng | `type` | Trường | Ghi chú |
|---|---|---|---|
| C→S | `challenge` | `targetEntityId` | Lỗi `not_allowed` nếu một trong hai không ở thành, đang trong trận, đang có lời mời, hoặc đang trong thời gian chờ mời lại |
| S→C | `challenge_sent` | `challengeId`, `targetName`, `expiresAt` | Gửi người mời |
| S→C | `challenge_received` | `challengeId`, `fromName`, `fromSign`, `fromLevel`, `expiresAt` | Gửi người nhận |
| C→S | `challenge_reply` | `challengeId`, `accept: boolean` | Chỉ người nhận |
| C→S | `challenge_cancel` | `challengeId` | Chỉ người mời |
| S→C | `challenge_closed` | `challengeId`, `reason`: `accepted` \| `declined` \| `expired` \| `cancelled` \| `unavailable` | Gửi cả hai. `unavailable`: một bên rời thành, mất kết nối, hoặc vào trận khác |

- `match_start` thêm `mode: "pve" | "pvp"`.
- `match_end.result` tính theo góc nhìn người nhận: đội mình còn người sống thì `win`.
- `Character` thêm `pvp: { wins, losses, draws }`.
- `world_state.entities[]` của người chơi thêm `sign`, `level` để client hiển thị trước khi mời.

## Engine
- `outcome` hiện tính theo team 0. Thêm hàm `winnerTeam(state, maxTurns): 0 | 1 | "draw" | null`. Match runner dùng hàm này cho cả PvE (team 0 thắng nghĩa là `win`) và PvP.
- Mỗi đơn vị trong trận PvP được dựng giống người chơi PvE: bộ súng của cung, nội tại, nội lực.

## Cân bằng
- Mô phỏng mọi cặp cung (10 cặp kể cả cùng cung), cả hai bên dùng bot `gioi` có di chuyển né. Mục tiêu theo `04`: không cung nào thắng quá 60% trước bất kỳ cung nào. Cặp cùng cung phải xấp xỉ 50%, nếu không là bản đồ thiên vị một bên.
