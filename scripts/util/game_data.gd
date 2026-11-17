class_name GameData
extends RefCounted
## Đọc data/ (chỉ để hiển thị: tên cung, phạm vi thanh trượt). Không tính kết quả.

const DEFAULT_BALANCE := {
	"aimAngleMinDegrees": -30,
	"aimAngleMaxDegrees": 80,
	"unitRadiusTiles": 0.75,
	"worldTickHz": 10,
}
const DEFAULT_SIGNS := [
	{"id": "bach_duong", "ten": "Bạch Dương"},
	{"id": "kim_nguu", "ten": "Kim Ngưu"},
	{"id": "xu_nu", "ten": "Xử Nữ"},
	{"id": "bao_binh", "ten": "Bảo Bình"},
]


static func load_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		return null
	var json := JSON.new()
	if json.parse(FileAccess.get_file_as_string(path)) != OK:
		return null
	return json.data


static func load_balance() -> Dictionary:
	var out: Dictionary = DEFAULT_BALANCE.duplicate()
	var d: Variant = load_json("res://data/can-bang-v0.json")
	if typeof(d) == TYPE_DICTIONARY:
		out.merge(d, true)
	return out


## id súng -> dòng dữ liệu (chỉ để hiển thị tên, nội lực, hồi chiêu).
static func load_guns() -> Dictionary:
	var out := {}
	var d: Variant = load_json("res://data/sung.json")
	if typeof(d) == TYPE_DICTIONARY and d.has("guns") and typeof(d["guns"]) == TYPE_ARRAY:
		for g in d["guns"]:
			if typeof(g) == TYPE_DICTIONARY and g.has("id"):
				out[String(g["id"])] = g
	return out


static func load_signs() -> Array:
	var d: Variant = load_json("res://data/nhan-vat.json")
	if typeof(d) == TYPE_DICTIONARY and d.has("signs") and typeof(d["signs"]) == TYPE_ARRAY:
		return d["signs"]
	return DEFAULT_SIGNS.duplicate(true)
