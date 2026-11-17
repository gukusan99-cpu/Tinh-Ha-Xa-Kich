# 06. Kiến trúc

Trạng thái: giao thức Giai đoạn 0 và mô hình đồng bộ lượt **đã chốt** (2026-11-18). Phần "Giai đoạn 1" bên dưới là đặc tả triển khai.

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

## Giai đoạn 1: đặc tả triển khai

### Lưu trữ
- PostgreSQL và Redis chưa cài trên máy phát triển. Giai đoạn 1 dùng interface `AccountStore` với bản cài đặt trong bộ nhớ; trận đang chạy giữ trong bộ nhớ tiến trình. Bản PostgreSQL/Redis thay vào sau, không đổi giao thức.
- Mật khẩu băm bằng `scrypt` (salt ngẫu nhiên). Không bao giờ log mật khẩu.

### Dữ liệu
| File | Nội dung |
|---|---|
| `data/can-bang-v0.json` | Hằng số cân bằng và vật lý trận |
| `data/nhan-vat.json` | Máu gốc, tốc độ đi trên bản đồ, súng khởi đầu, danh sách cung |
| `data/sung.json` | Súng (Giai đoạn 1: một khẩu `thuoc_no_nho`) |
| `data/quai.json` | Quái |
| `data/ban-do/*.json` | Bản đồ thế giới (nhìn từ trên xuống) |
| `data/tran/*.json` | Bản đồ trận (nhìn ngang) |

### Luồng thông điệp
Giới hạn 4 KB chỉ áp cho thông điệp C→S. Lỗi mới: `not_allowed` (đúng định dạng nhưng sai thời điểm hoặc sai quyền). Mọi thông điệp vẫn có `"v": 1`.

**Tài khoản** (sau `welcome`):
| Hướng | `type` | Trường | Ghi chú |
|---|---|---|---|
| C→S | `register` | `username`, `password` | username 3–16 ký tự `[A-Za-z0-9_]`; password 6–64 ký tự |
| C→S | `login` | `username`, `password` | Đăng nhập lại ở kết nối mới sẽ ngắt kết nối cũ |
| S→C | `auth_ok` | `username`, `character: Character \| null` | |
| S→C | `auth_error` | `code`: `taken` \| `bad_credentials` \| `invalid` | |
| C→S | `create_character` | `name` (2–16 ký tự sau khi trim), `sign` | `sign` ∈ `bach_duong`, `kim_nguu`, `xu_nu`, `bao_binh`. Chỉ khi chưa có nhân vật. Khóa vĩnh viễn |
| S→C | `character` | `character: Character` | |

`Character = { name, sign, level, exp, gunId }`

**Thế giới** (cần đã đăng nhập và có nhân vật):
| Hướng | `type` | Trường | Ghi chú |
|---|---|---|---|
| C→S | `enter_world` | | Vào thành tại điểm xuất phát |
| S→C | `world_state` | `mapId`, `width`, `height`, `rows: string[]`, `you: entityId`, `entities: Entity[]` | Gửi khi vào bản đồ |
| C→S | `move_to` | `x`, `y` (số thực, đơn vị ô) | Máy chủ đi thẳng tới đích với tốc độ trong dữ liệu, dừng khi gặp tường. Không tìm đường |
| S→C | `world_tick` | `entities: Entity[]` | 10 lần/giây, gửi toàn bộ thực thể trong bản đồ |

`Entity = { id, kind: "player"|"monster", name, x, y, monsterId? }`. Bản đồ thế giới: `#` tường, `.` sàn; hàng 0 ở trên cùng; tọa độ (x, y) tính theo ô, ô (c, r) chiếm [c, c+1) × [r, r+1).
- Cổng: người chơi đứng trong hình chữ nhật cổng thì chuyển sang bản đồ đích, nhận `world_state` mới.
- Chạm quái: ở vùng săn, khoảng cách người chơi–quái ≤ `contactRadiusTiles` thì cả hai rời bản đồ, máy chủ tạo trận (Giai đoạn 1: một người với nhóm quái của bản đồ trận) và gửi `match_start`. Quái hồi sinh sau `monsterRespawnSeconds`.

**Trận**:
| Hướng | `type` | Trường |
|---|---|---|
| S→C | `match_start` | `matchId`, `map: { width, height, rows }`, `units: Unit[]`, `you: unitId`, `maxTurns` |
| S→C | `phase` | `turn`, `phase: "move"\|"aim"`, `deadline`, `serverTime` (ms) |
| C→S | `battle_move` | `col` (số nguyên). Chỉ trong pha `move`, gửi lại được |
| S→C | `moves_result` | `turn`, `moves: { unitId, path: number[], col, y }[]` |
| C→S | `battle_shot` | `angle` (độ), `power` (0–100), `facing` (−1 hoặc 1). Chỉ trong pha `aim`, gửi lại được |
| S→C | `turn_result` | xem `server/src/battle/types.ts` (`TurnResult`) |
| S→C | `match_end` | `matchId`, `result: "win"\|"lose"\|"draw"`, `rewards: { exp }`, `character` |

`Unit = { id, kind, name, team (0 người chơi, 1 quái), col, y, hp, maxHp, facing }`. Sau `match_end` máy chủ tự gửi `world_state` (người chơi về điểm xuất phát vùng săn).

Pha kết thúc sớm khi mọi người chơi còn kết nối đã gửi lệnh. Sau `turn_result`, máy chủ chờ `thời gian bay dài nhất + replayPaddingSeconds` rồi mới mở lượt mới.

### Luật vật lý trận
Mọi hằng số lấy từ `data/can-bang-v0.json`. Hợp đồng kiểu nằm ở `server/src/battle/types.ts`.
- **Lưới:** `rows[r][c]`, `#` đất, `.` trống; hàng 0 trên cùng; trục y hướng xuống. Ô (c, r) chiếm [c, c+1) × [r, r+1).
- **Đơn vị:** đứng ở cột `col`, chân tại `y` = chỉ số hàng của ô đất đầu tiên dưới nó (đứng trên mặt ô đó). Tâm thân: (col + 0.5, y − unitRadiusTiles). Hitbox là hình tròn bán kính `unitRadiusTiles`.
- **Di chuyển:** đi từng cột về phía `col` đích, tối đa `moveRangeTiles` cột; leo được bậc cao tối đa `maxClimbTiles`; gặp bậc cao hơn thì dừng. Ra khỏi mép bản đồ thì dừng ở mép.
- **Bắn:** tốc độ v = power/100 × `maxProjectileSpeed`; vx = facing × v × cos(angle), vy = −v × sin(angle). Điểm xuất phát là tâm thân người bắn. Bước mô phỏng 1/`simHz` giây, gia tốc `gravity`, bay tối đa `maxFlightSeconds`.
- **Độ lệch:** RNG có seed của lượt (mulberry32). Với mỗi phát, theo thứ tự `unitId` tăng dần: offset ~ U[−d, d] với d = `deviationMaxTiles` (Giai đoạn 1 chưa có chỉ số Chính xác; quái dùng `aiErrorTiles` của nó). T = max(0.5, 2·v·sin(max(angle, 10°))/g); vx += offset / T. Tiếp theo rút một số cho chí mạng: < `critChance` thì sát thương × `critMultiplier`.
- **Va chạm:** đạn dừng khi vào ô đất, khi chạm hitbox của đơn vị (bỏ qua người bắn trong `selfHitGraceSeconds` đầu), hoặc khi ra ngoài trái/phải/dưới (không nổ). Bay lên quá mép trên vẫn tiếp tục.
- **Đồng thời:** mọi quỹ đạo tính trên địa hình và vị trí đầu pha bắn. Sau đó áp dụng vụ nổ theo thứ tự thời điểm chạm (bằng nhau thì theo `unitId`).
- **Nổ:** xóa ô đất có tâm cách điểm nổ ≤ `blastRadiusTiles`. Sát thương mỗi đơn vị: dist = khoảng cách điểm nổ tới tâm thân; sát thương = round(damage × crit × max(0, 1 − dist/(blastRadius + unitRadius))). Trúng trực tiếp tính dist = 0.
- **Rơi:** sau mọi vụ nổ, đơn vị rơi xuống ô đất đầu tiên bên dưới; không còn đất thì chết.
- **Kết thúc:** hết người chơi sống → `lose`; hết quái → `win`; hết `maxTurns` → `draw`. Người chơi bỏ lỡ `disconnectMissedTurnsToKick` lượt liên tiếp thì bị loại (hp = 0).
- **Quái:** thử mọi góc từ `aiAngleStep` trong khoảng góc cho phép, power từ 10 tới 100 bước 5, hai hướng; mô phỏng không lệch; chọn phát có điểm chạm gần người chơi sống gần nhất, nhưng bỏ qua phát làm mất máu chính nó hoặc đồng đội (cùng công thức rơi sát thương, không lệch); nếu mọi phát đều gây hại thì chọn phát hại ít nhất. Quái không di chuyển ở Giai đoạn 1.
- **Lấy mẫu quỹ đạo:** gửi điểm mỗi `simHz/trajectorySampleHz` bước, làm tròn 2 chữ số, luôn kèm điểm cuối.

## Việc chưa chốt
- Thay bộ nhớ tạm bằng PostgreSQL/Redis (trước khi thử nghiệm qua Web).
