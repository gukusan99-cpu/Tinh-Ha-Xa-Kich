class_name Protocol
extends RefCounted
## Hàm thuần cho giao thức (xem docs/06-kien-truc.md). Dễ kiểm thử.
## Client chỉ gửi ý định; không bao giờ gửi kết quả.

const VERSION := 1
const MAX_MESSAGE_BYTES := 4096  # giới hạn C→S


static func _envelope(type: String, fields: Dictionary = {}) -> Dictionary:
	var msg := {"v": VERSION, "type": type}
	msg.merge(fields)
	return msg


static func _encode(type: String, fields: Dictionary = {}) -> String:
	return JSON.stringify(_envelope(type, fields))


# ---- Giai đoạn 0 ----

static func build_hello(client_version: String) -> String:
	return _encode("hello", {"clientVersion": client_version})


static func build_ping(seq: int) -> String:
	return _encode("ping", {"seq": seq})


# ---- Tài khoản ----

static func build_register(username: String, password: String) -> String:
	return _encode("register", {"username": username, "password": password})


static func build_login(username: String, password: String) -> String:
	return _encode("login", {"username": username, "password": password})


static func build_create_character(char_name: String, sign: String) -> String:
	return _encode("create_character", {"name": char_name.strip_edges(), "sign": sign})


# ---- Thế giới ----

static func build_enter_world() -> String:
	return _encode("enter_world")


## x, y: toạ độ theo ô (số thực).
static func build_move_to(x: float, y: float) -> String:
	return _encode("move_to", {"x": x, "y": y})


# ---- Trận ----

static func build_battle_move(col: int) -> String:
	return _encode("battle_move", {"col": col})


## angle: độ; power: 0..100 (kẹp); facing: -1 hoặc 1 (giá trị khác được chuẩn hoá theo dấu).
static func build_battle_shot(angle: float, power: float, facing: int, gun_id: String) -> String:
	var f := -1 if facing < 0 else 1
	return _encode("battle_shot", {"angle": angle, "power": clampf(power, 0.0, 100.0), "facing": f, "gunId": gun_id})


## Xin đường ngắm dự đoán (chỉ có tác dụng khi có hiệu ứng Ngắm chuẩn; máy chủ giới hạn tần suất).
static func build_aim_preview(gun_id: String, angle: float, power: float, facing: int) -> String:
	var f := -1 if facing < 0 else 1
	return _encode("aim_preview", {"gunId": gun_id, "angle": angle, "power": clampf(power, 0.0, 100.0), "facing": f})


# ---- Thách đấu PvP ----

static func build_challenge(target_entity_id: int) -> String:
	return _encode("challenge", {"targetEntityId": target_entity_id})


static func build_challenge_reply(challenge_id: String, accept: bool) -> String:
	return _encode("challenge_reply", {"challengeId": challenge_id, "accept": accept})


static func build_challenge_cancel(challenge_id: String) -> String:
	return _encode("challenge_cancel", {"challengeId": challenge_id})

## Trả về Dictionary đã kiểm tra hợp lệ, hoặc {} nếu text không hợp lệ. Giới hạn 4 KB.
static func parse(text: String) -> Dictionary:
	return _parse(text, MAX_MESSAGE_BYTES)


## Cho thông điệp S→C (không giới hạn 4 KB: world_state, turn_result có thể lớn).
static func parse_server(text: String) -> Dictionary:
	return _parse(text, 0)


static func _parse(text: String, max_bytes: int) -> Dictionary:
	if text.is_empty():
		return {}
	if max_bytes > 0 and text.to_utf8_buffer().size() > max_bytes:
		return {}
	var json := JSON.new()
	if json.parse(text) != OK:
		return {}
	var data: Variant = json.data
	if typeof(data) != TYPE_DICTIONARY:
		return {}
	var d: Dictionary = data
	# JSON số luôn là float trong Godot; chấp nhận số nguyên dạng float.
	if not d.has("v") or typeof(d["v"]) not in [TYPE_INT, TYPE_FLOAT] or int(d["v"]) != VERSION:
		return {}
	if not d.has("type") or typeof(d["type"]) != TYPE_STRING or String(d["type"]).is_empty():
		return {}
	return d
