class_name GunInfo
extends RefCounted
## Hàm thuần cho giao diện súng/trạng thái. Chỉ để hiển thị; máy chủ vẫn kiểm tra mọi thứ.

const STATUS_NAMES := {
	"burn": "Cháy", "slow": "Chậm", "stun": "Choáng", "shield": "Khiên", "trueAim": "Ngắm chuẩn",
	"poison": "Độc", "root": "Trói",
}
const TIER_NAMES := {"thuong": "Thường", "hiem": "Hiếm", "cung": "Cung", "quai": "Quái"}


static func tier_name(gun: Dictionary) -> String:
	var t := String(gun.get("tang", ""))
	return TIER_NAMES.get(t, t)


static func tier_color(gun: Dictionary) -> Color:
	match String(gun.get("tang", "")):
		"thuong":
			return Color(0.75, 0.9, 0.75)
		"hiem":
			return Color(0.75, 0.6, 1.0)
		"quai":
			return Color(1.0, 0.6, 0.55)
	return Color.WHITE


## Súng chung (thường/hiếm) mới thuộc kho súng.
static func is_common_or_rare(gun: Dictionary) -> bool:
	return String(gun.get("tang", "")) in ["thuong", "hiem"]


## Mô tả cơ chế ngắn, suy ra từ các trường dữ liệu súng (chỉ hiển thị).
static func describe(g: Dictionary) -> String:
	var parts := []
	match String(g.get("kind", "")):
		"spread":
			parts.append("Bắn %d viên tỏa góc" % int(g.get("count", 1)))
		"burst":
			parts.append("Bắn liên tiếp %d viên" % int(g.get("count", 1)))
		"beam":
			parts.append("Tia thẳng, xuyên %d ô đất" % int(g.get("pierceTiles", 0)))
		"shower":
			parts.append("Mưa %d viên" % int(g.get("count", 1)))
		"self":
			parts.append("Hiệu ứng lên bản thân")
	if int(g.get("damage", 0)) > 0:
		parts.append("Sát thương %d" % int(g["damage"]))
	if g.has("knockbackTiles"):
		parts.append("đẩy lùi %d cột" % int(g["knockbackTiles"]))
	if g.has("maxPower"):
		parts.append("tầm ngắn")
	if g.get("burn") is Dictionary:
		parts.append("gây cháy")
	if g.get("slow") is Dictionary:
		parts.append("gây chậm")
	if g.get("stun") is Dictionary:
		parts.append("gây choáng")
	if g.get("root") is Dictionary:
		parts.append("trói mục tiêu")
	if g.get("zone") is Dictionary:
		parts.append("tạo vũng độc %d lượt" % int(g["zone"].get("turns", 0)))
	if g.get("chain") is Dictionary:
		parts.append("điện lan tới %d mục tiêu" % int(g["chain"].get("maxTargets", 0)))
	if parts.is_empty():
		return ""
	return ", ".join(parts) + "."


## Bật/tắt súng trong trang bị; tối đa max_slots. Trả mảng mới.
static func toggle_loadout(selected: Array, id: String, max_slots: int) -> Array:
	var out := selected.duplicate()
	if out.has(id):
		out.erase(id)
	elif out.size() < max_slots:
		out.append(id)
	return out


## Danh sách súng chung trong kho (theo thứ tự kho), lọc theo dữ liệu súng.
static func owned_common(owned: Variant, guns: Dictionary) -> Array:
	var out := []
	if typeof(owned) != TYPE_ARRAY:
		return out
	for id in owned:
		var s := String(id)
		if guns.has(s) and is_common_or_rare(guns[s]) and not out.has(s):
			out.append(s)
	return out


static func drops_text(drops: Variant, guns: Dictionary) -> String:
	if typeof(drops) != TYPE_ARRAY or drops.is_empty():
		return ""
	var names := []
	for d in drops:
		names.append(gun_name(guns, String(d)))
	return "Nhận được: " + ", ".join(names)


## Toạ độ từ {x,y} hoặc [x,y].
static func to_vec(v: Variant) -> Vector2:
	if typeof(v) == TYPE_DICTIONARY:
		return Vector2(float(v.get("x", 0)), float(v.get("y", 0)))
	if typeof(v) == TYPE_ARRAY and v.size() >= 2:
		return Vector2(float(v[0]), float(v[1]))
	return Vector2.ZERO


## Đường gấp khúc (tia điện) giữa a và b; xác định, không ngẫu nhiên.
static func zigzag(a: Vector2, b: Vector2, segments: int, amp: float) -> PackedVector2Array:
	var out := PackedVector2Array()
	out.append(a)
	var n := maxi(segments, 2)
	var d := b - a
	var perp := d.orthogonal().normalized() * amp
	for i in range(1, n):
		var side := 1.0 if i % 2 == 1 else -1.0
		out.append(a + d * (float(i) / n) + perp * side)
	out.append(b)
	return out


static func zone_label(z: Dictionary) -> String:
	var turns := int(z.get("turnsLeft", 0))
	if bool(z.get("active", false)):
		return "Vũng độc (%d)" % turns
	return "Cảnh báo (%d)" % turns


static func gun_name(guns: Dictionary, id: String) -> String:
	if guns.has(id):
		return String(guns[id].get("ten", id))
	return id


## {"ok": bool, "reason": String, "cooldown": int}. Chỉ phục vụ hiển thị.
static func availability(gun: Dictionary, energy: int, cooldowns: Dictionary) -> Dictionary:
	var cd := int(cooldowns.get(String(gun.get("id", "")), 0))
	var cost := int(gun.get("energyCost", 0))
	if cd > 0:
		return {"ok": false, "reason": "cooldown", "cooldown": cd}
	if energy < cost:
		return {"ok": false, "reason": "energy", "cooldown": 0}
	return {"ok": true, "reason": "", "cooldown": 0}


## Nhãn nút súng: tên, nội lực, hồi chiêu còn lại.
static func gun_button_text(gun: Dictionary, energy: int, cooldowns: Dictionary) -> String:
	var a := availability(gun, energy, cooldowns)
	var t := "%s\nNội lực: %d" % [String(gun.get("ten", gun.get("id", "?"))), int(gun.get("energyCost", 0))]
	if int(a["cooldown"]) > 0:
		t += " | Hồi: %d lượt" % int(a["cooldown"])
	return t


## Súng đầu tiên dùng được trong danh sách (để chọn mặc định); "" nếu không có.
static func first_available(gun_ids: Array, guns: Dictionary, energy: int, cooldowns: Dictionary) -> String:
	for id in gun_ids:
		if guns.has(String(id)) and availability(guns[String(id)], energy, cooldowns)["ok"]:
			return String(id)
	return ""


static func status_text(s: Dictionary) -> String:
	var t := String(s.get("type", ""))
	var n: String = STATUS_NAMES.get(t, t)
	if t == "shield":
		return "%s %d" % [n, int(s.get("amount", 0))]
	return n


static func status_color(type: String) -> Color:
	match type:
		"burn":
			return Color(1.0, 0.55, 0.2)
		"slow":
			return Color(0.5, 0.8, 1.0)
		"stun":
			return Color(1.0, 0.9, 0.3)
		"shield":
			return Color(0.4, 0.9, 1.0)
		"trueAim":
			return Color(1.0, 1.0, 0.6)
		"poison":
			return Color(0.55, 0.9, 0.35)
		"root":
			return Color(0.85, 0.8, 0.65)
	return Color.WHITE


static func has_status(statuses: Array, type: String) -> bool:
	for s in statuses:
		if String(s.get("type", "")) == type:
			return true
	return false


## Thay (hoặc thêm) trạng thái cùng loại; trả về mảng mới.
static func put_status(statuses: Array, status: Dictionary) -> Array:
	var out := []
	var t := String(status.get("type", ""))
	for s in statuses:
		if String(s.get("type", "")) != t:
			out.append(s)
	out.append(status)
	return out


## Gộp trạng thái đơn vị từ phần dữ liệu máy chủ (phase.units[] hoặc turn_result.units[]).
## Chỉ ghi đè các trường có mặt.
static func apply_unit_state(u: Dictionary, src: Dictionary) -> void:
	if src.has("hp"):
		u["hp"] = int(src["hp"])
	if src.has("energy"):
		u["energy"] = int(src["energy"])
	if src.has("cooldowns") and typeof(src["cooldowns"]) == TYPE_DICTIONARY:
		u["cooldowns"] = src["cooldowns"]
	if src.has("statuses") and typeof(src["statuses"]) == TYPE_ARRAY:
		u["statuses"] = src["statuses"]
	if src.has("guns") and typeof(src["guns"]) == TYPE_ARRAY:
		u["guns"] = src["guns"]


## Giới hạn tần suất gửi (ms). last_ms < 0: chưa gửi lần nào.
static func preview_due(now_ms: float, last_ms: float, per_second: float) -> bool:
	if last_ms < 0.0 or per_second <= 0.0:
		return true
	return now_ms - last_ms >= 1000.0 / per_second


static func passive_text(p: Variant) -> String:
	if typeof(p) != TYPE_DICTIONARY:
		return ""
	match String(p.get("type", "")):
		"earlyShot":
			return "Bắn trong %d giây đầu pha ngắm: +%d%% sát thương." % [int(p.get("earlyShotSeconds", 0)), _pct(p.get("earlyShotDamageBonus", 0))]
		"toughness":
			return "Giảm %d%% sát thương nhận vào." % _pct(p.get("damageTakenReduction", 0))
		"precision":
			return "Giảm %d%% độ lệch khi bắn." % _pct(p.get("deviationReduction", 0))
		"meteorPush":
			return "Sao băng trúng thì đào thêm ô dưới chân mục tiêu."
	return ""


static func sign_summary(sign: Dictionary, guns: Dictionary) -> String:
	var names := []
	for id in sign.get("gunIds", []):
		names.append(gun_name(guns, String(id)))
	var parts := []
	if not names.is_empty():
		parts.append("Súng: " + ", ".join(names) + ".")
	var pt := passive_text(sign.get("passive"))
	if not pt.is_empty():
		parts.append("Nội tại: " + pt)
	return " ".join(parts)


static func _pct(v: Variant) -> int:
	return int(round(float(v) * 100.0))
