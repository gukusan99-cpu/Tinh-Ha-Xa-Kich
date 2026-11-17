# 07. Đặc tả 4 cung và súng (Giai đoạn 2)

Cụ thể hóa `02-nhan-vat-va-sung.md` để code. Mọi con số nằm trong `data/sung.json` và `data/nhan-vat.json`. Các số dưới đây chỉ là giá trị khởi đầu, sẽ chỉnh bằng mô phỏng.

## Quyết định đã chốt (2026-11-18)
- Thiên thạch và sao băng nổ ngay trong lượt bắn. Chỉ vùng hiệu ứng kéo dài trên mặt đất mới được cảnh báo trước (bộ súng Giai đoạn 2 chưa có vùng nào như vậy).
- Bạch Dương: lệnh bắn gửi trong `earlyShotSeconds` giây đầu của pha ngắm thì được cộng sát thương.
- Xử Nữ: nội tại giảm độ lệch. Súng kính cho lượt sau có đường ngắm dự đoán do máy chủ tính, và phát bắn lượt đó không bị lệch.

## Bộ súng của người chơi
- Mỗi nhân vật mang **3 súng của cung mình**, cộng súng chung `thuoc_no_nho`.
- Lệnh bắn có thêm `gunId`. Súng phải nằm trong bộ súng của đơn vị, đủ nội lực và hết thời gian hồi; nếu không, máy chủ trả `not_allowed`.
- **Dòng riêng** chỉ áp dụng khi súng thuộc đúng cung của người bắn. Ở Giai đoạn 2 điều này luôn đúng, nhưng code vẫn phải kiểm tra.

## Nội lực và thời gian hồi
- Vào trận với `energyStart`. Đầu mỗi lượt (lượt 2 trở đi) cộng `energyRegenPerTurn`, tối đa `energyMax`.
- Bắn thì trừ `energyCost`. `cooldownTurns` = số lượt không dùng lại được súng đó sau lượt bắn.
- Quái không dùng nội lực.

## Kiểu súng (`kind`)
| kind | Cơ chế |
|---|---|
| `projectile` | Một viên đạn như Giai đoạn 1 |
| `burst` | `count` viên cùng góc; power lệch theo `powerOffsets`; mỗi viên có độ lệch riêng |
| `shower` | Một viên dẫn đường. Tại điểm chạm, `count` viên sao băng rơi thẳng đứng từ mép trên bản đồ, tại các x trải đều trong [−`spreadTiles`, +`spreadTiles`] quanh điểm chạm; mỗi viên nổ riêng |
| `self` | Không bắn đạn; áp hiệu ứng `selfEffect` lên chính người bắn |

Thuộc tính tùy chọn khi trúng: `burn` {turns, damagePerTurn}, `slow` {turns, tiles}, `stun` {turns}, `knockbackTiles`, `craterDepthTiles` (hố sâu thêm theo chiều dọc), `digBelowOnHit` (sao băng Bảo Bình: đào thêm ô ngay dưới đơn vị bị trúng).

## Hiệu ứng trạng thái
- **Cháy:** cuối lượt, mất `damagePerTurn`, giảm 1 lượt còn lại.
- **Choáng:** pha di chuyển kế tiếp không di chuyển được.
- **Chậm:** pha di chuyển kế tiếp giảm `tiles` cột quãng đi (tối thiểu 0).
- **Khiên** (`selfEffect` của Khiên đạn): hấp thụ tối đa `amount` sát thương, kéo dài tới hết lượt kế tiếp.
- **Ngắm chuẩn** (`selfEffect` của Súng kính): ở lượt kế tiếp, phát bắn không bị lệch và client được gửi đường ngắm dự đoán.
- Thời lượng tối đa theo `03`. Cùng một hiệu ứng từ hai nguồn trong một lượt: giữ cái mạnh hơn (số lượt lớn hơn, hoặc trị số lớn hơn nếu bằng lượt).
- Thứ tự cuối lượt: nổ → hiệu ứng khi trúng → đẩy lùi → rơi → cháy → giảm thời lượng → chết.
- Hiệu ứng `self` áp dụng **trước** các vụ nổ cùng lượt, nên khiên chặn được đạn bay tới ngay trong lượt đó.

## Nội tại cung
| Cung | Nội tại | Dòng riêng (đúng cung) |
|---|---|---|
| Bạch Dương | Bắn trong `earlyShotSeconds` giây đầu pha ngắm: +`earlyShotDamageBonus` sát thương | +`lineBonus` vào mức cộng đó |
| Kim Ngưu | Giảm `damageTakenReduction` sát thương nhận vào | +`lineBonus` vào mức giảm (theo súng bắn ở lượt đó) |
| Xử Nữ | Độ lệch × (1 − `deviationReduction`) | Độ lệch × thêm (1 − `lineBonus`) |
| Bảo Bình | Sao băng trúng đơn vị thì đào thêm ô dưới chân (đẩy xuống) | Pháo sao băng: +`lineBonusStones` viên; Đạn sao và Thiên thạch: +`lineBonus` sát thương |

## Đường ngắm dự đoán (Súng kính)
- C→S `aim_preview` {gunId, angle, power, facing}. Chỉ hợp lệ trong pha ngắm và khi đơn vị có hiệu ứng Ngắm chuẩn. Tối đa `aimPreviewPerSecond` lần/giây; vượt thì bỏ qua lặng lẽ.
- S→C `aim_preview` {points}: phần đầu quỹ đạo, dài `aimPreviewFraction` thời gian bay, tính trên địa hình hiện tại, không lệch.

## Thay đổi giao thức
- `battle_shot` thêm `gunId`.
- `match_start.units[]` và `phase` thêm cho mỗi đơn vị: `energy`, `cooldowns` {gunId: lượt}, `statuses[]`, `guns[]` (chỉ người chơi).
- `turn_result` thêm: `shots[].gunId`, `shots[].parentIndex` (viên con của burst/shower trỏ về phát gốc), `statusEvents[]`, `shieldAbsorbed[]`, `knockbacks[]`, `burnTicks[]`.
Hợp đồng chi tiết: `server/src/battle/types.ts`.
