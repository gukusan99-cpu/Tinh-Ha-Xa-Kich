class_name Protocol
extends RefCounted
## Hàm thuần cho giao thức Giai đoạn 0 (xem docs/06-kien-truc.md). Dễ kiểm thử.

const VERSION := 1
const MAX_MESSAGE_BYTES := 4096


static func _envelope(type: String, fields: Dictionary = {}) -> Dictionary:
	var msg := {"v": VERSION, "type": type}
	msg.merge(fields)
	return msg


static func build_hello(client_version: String) -> String:
	return JSON.stringify(_envelope("hello", {"clientVersion": client_version}))


static func build_ping(seq: int) -> String:
	return JSON.stringify(_envelope("ping", {"seq": seq}))


## Trả về Dictionary đã kiểm tra hợp lệ, hoặc {} nếu text không hợp lệ.
static func parse(text: String) -> Dictionary:
	if text.is_empty() or text.to_utf8_buffer().size() > MAX_MESSAGE_BYTES:
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
