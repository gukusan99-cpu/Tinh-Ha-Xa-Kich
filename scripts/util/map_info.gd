class_name MapInfo
extends RefCounted
## Tra cứu dữ liệu chỉ để HIỂN THỊ: tên bản đồ, cổng, kiểu vẽ quái. Không tính kết quả.

const MONSTER_STYLES := {
	"am_thach_nho": {"color": Color(0.9, 0.2, 0.2), "scale": 1.0},
	"am_thach_gai": {"color": Color(1.0, 0.55, 0.1), "scale": 1.0},
	"am_thach_lon": {"color": Color(0.35, 0.12, 0.45), "scale": 1.5},
}
const DEFAULT_STYLE := {"color": Color(0.9, 0.2, 0.2), "scale": 1.0}


## id bản đồ (vung_san_1) -> đường dẫn tệp (vung-san-1.json) trong thư mục dir.
static func map_path(dir: String, map_id: String) -> String:
	return "res://data/%s/%s.json" % [dir, map_id.replace("_", "-")]


## Đọc bản đồ thế giới hoặc bản đồ trận theo id; {} nếu không có.
static func load_map(map_id: String, battle := false) -> Dictionary:
	if map_id.is_empty():
		return {}
	var d: Variant = GameData.load_json(map_path("tran" if battle else "ban-do", map_id))
	return d if typeof(d) == TYPE_DICTIONARY else {}


## Tên hiển thị; rơi về id nếu không có `ten`.
static func map_name(map_id: String, battle := false) -> String:
	var n := String(load_map(map_id, battle).get("ten", ""))
	return n if not n.is_empty() else map_id


static func monster_style(monster_id: String) -> Dictionary:
	return MONSTER_STYLES.get(monster_id, DEFAULT_STYLE)


## Tên quái theo id; rơi về id.
static func monster_name(monsters: Dictionary, monster_id: String) -> String:
	return String(monsters.get(monster_id, {}).get("ten", monster_id))


## id quái -> dòng dữ liệu (data/quai.json).
static func load_monsters() -> Dictionary:
	var out := {}
	var d: Variant = GameData.load_json("res://data/quai.json")
	if typeof(d) == TYPE_DICTIONARY and typeof(d.get("monsters")) == TYPE_ARRAY:
		for m in d["monsters"]:
			if typeof(m) == TYPE_DICTIONARY and m.has("id"):
				out[String(m["id"])] = m
	return out


## Tìm id quái theo tên hiển thị (đơn vị trong trận chỉ có tên); "" nếu không thấy.
static func monster_id_by_name(monsters: Dictionary, unit_name: String) -> String:
	for id in monsters.keys():
		if String(monsters[id].get("ten", "")) == unit_name:
			return String(id)
	return ""


static func portal_is_locked(level_required: int, level: int) -> bool:
	return level_required > level
