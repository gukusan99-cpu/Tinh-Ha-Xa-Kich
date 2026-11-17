extends SceneTree
## Bot PvP end-to-end (cần máy chủ đang chạy). Chạy HAI tiến trình, mỗi tiến trình một vai:
##   E2E_ROLE=challenger|target   E2E_USER=<tên đăng nhập>   E2E_TARGET_NAME=<tên nhân vật của target>
##   (tùy chọn) E2E_NAME=<tên nhân vật, mặc định = E2E_TARGET_NAME nếu là target, ngược lại = E2E_USER>
##   E2E_SIGN=<cung, mặc định bao_binh>   E2E_PASS=<mật khẩu, mặc định matkhau123>
## Chạy main.tscn thật. Cách aim chỉ là ước lượng thô của bot test, không phải logic game của client.

const TIMEOUT := 240.0
const GRAVITY := 30.0
const MAX_SPEED := 40.0

var _t := 0.0
var _net: Node
var _main: Node
var _role := "challenger"
var _user := ""
var _pass := "matkhau123"
var _char_name := ""
var _target_name := ""
var _sign := "bao_binh"
var _guns := {}
var _map_id := ""
var _you_entity = null
var _entities: Array = []
var _you_unit = null
var _units: Array = []
var _errors: Array[String] = []
var _in_match := false
var _match_ended := false
var _back_in_world := false
var _sent_challenge := false
var _retry := 0.0
var _result := ""


func _initialize() -> void:
	_role = OS.get_environment("E2E_ROLE")
	_user = OS.get_environment("E2E_USER")
	_target_name = OS.get_environment("E2E_TARGET_NAME")
	if OS.get_environment("E2E_PASS") != "":
		_pass = OS.get_environment("E2E_PASS")
	if OS.get_environment("E2E_SIGN") != "":
		_sign = OS.get_environment("E2E_SIGN")
	_char_name = OS.get_environment("E2E_NAME")
	if _char_name == "":
		_char_name = _target_name if _role == "target" else _user
	if (_role != "challenger" and _role != "target") or _user == "" or _target_name == "":
		print("E2E FAIL thiếu biến môi trường E2E_ROLE/E2E_USER/E2E_TARGET_NAME")
		quit(2)
		return
	_main = load("res://scenes/main.tscn").instantiate()
	root.add_child(_main)
	_net = root.get_node("Net")
	_guns = GameData.load_guns()
	_net.connected.connect(_on_connected)
	_net.message_received.connect(_on_msg)


func _log(s: String) -> void:
	print("E2E[", _role, "] ", s)


func _on_connected(_sid: String) -> void:
	_log("welcome")
	_net.send_json(Protocol.build_register(_user, _pass))


func _on_msg(msg: Dictionary) -> void:
	match String(msg["type"]):
		"auth_error":
			if String(msg.get("code", "")) == "taken":
				_net.send_json(Protocol.build_login(_user, _pass))
			else:
				_errors.append("auth_error " + str(msg))
		"auth_ok":
			_log("auth_ok")
			if msg.get("character") == null:
				_net.send_json(Protocol.build_create_character(_char_name, _sign))
		"world_state":
			_map_id = String(msg["mapId"])
			_you_entity = msg["you"]
			_entities = msg["entities"]
			_log("world_state " + _map_id)
			if _match_ended:
				_back_in_world = true
		"world_tick":
			_entities = msg["entities"]
		"challenge_received":
			_log("challenge_received từ " + String(msg.get("fromName", "")))
			if _role == "target":
				_net.send_json(Protocol.build_challenge_reply(String(msg["challengeId"]), true))
		"challenge_sent":
			_log("challenge_sent")
		"challenge_closed":
			_log("challenge_closed " + String(msg.get("reason", "")))
			if String(msg.get("reason", "")) != "accepted":
				_sent_challenge = false
		"match_start":
			_in_match = true
			_you_unit = msg["you"]
			_units = msg["units"]
			var mode := String(msg.get("mode", ""))
			_log("match_start mode=%s units=%d" % [mode, _units.size()])
			if mode != "pvp":
				_errors.append("mode không phải pvp: " + mode)
		"phase":
			_apply_units(msg.get("units", []))
			if String(msg["phase"]) == "move":
				var me = _unit(_you_unit)
				if me != null:
					_net.send_json(Protocol.build_battle_move(int(me["col"])))
			else:
				_send_aim()
		"moves_result":
			for m in msg["moves"]:
				var u = _unit(m["unitId"])
				if u != null:
					u["col"] = m["col"]
					u["y"] = m["y"]
		"turn_result":
			for d in msg["damage"]:
				var u = _unit(d["unitId"])
				if u != null:
					u["hp"] = d["hpAfter"]
			for f in msg["falls"]:
				var u = _unit(f["unitId"])
				if u != null:
					u["y"] = f["y"]
			for id in msg["deaths"]:
				var u = _unit(id)
				if u != null:
					u["hp"] = 0
			_log("turn_result turn=%d shots=%d" % [int(msg["turn"]), msg["shots"].size()])
		"match_end":
			_match_ended = true
			_in_match = false
			_result = String(msg.get("result", ""))
			var ch = msg.get("character")
			var pvp = ch.get("pvp") if typeof(ch) == TYPE_DICTIONARY else null
			_log("match_end %s pvp=%s" % [_result, str(pvp)])
			if typeof(pvp) != TYPE_DICTIONARY:
				_errors.append("match_end thiếu character.pvp")
		"error":
			_errors.append("%s: %s" % [msg.get("code"), msg.get("message")])
			print("E2E server error ", msg)


func _apply_units(list: Array) -> void:
	for s in list:
		var u = _unit(s.get("id"))
		if u != null:
			for k in ["hp", "energy", "cooldowns", "statuses"]:
				if s.has(k):
					u[k] = s[k]


func _unit(id) -> Variant:
	for u in _units:
		if int(u["id"]) == int(id):
			return u
	return null


func _send_aim() -> void:
	var me = _unit(_you_unit)
	if me == null:
		return
	var target: Dictionary = {}
	for u in _units:
		if int(u["team"]) != int(me["team"]) and int(u["hp"]) > 0:
			target = u
	if target.is_empty():
		return
	var gun_id := ""
	var energy := int(me.get("energy", 0))
	var cds: Dictionary = me.get("cooldowns", {})
	var ids: Array = me.get("guns", [])
	if ids.has("thuoc_no_nho") and _guns.has("thuoc_no_nho") and GunInfo.availability(_guns["thuoc_no_nho"], energy, cds)["ok"]:
		gun_id = "thuoc_no_nho"
	else:
		for id in ids:
			var g: Dictionary = _guns.get(String(id), {})
			if not g.is_empty() and String(g.get("kind", "")) != "self" and GunInfo.availability(g, energy, cds)["ok"]:
				gun_id = String(id)
				break
	if gun_id == "":
		return
	var dx := float(target["col"]) - float(me["col"])
	var facing := 1 if dx >= 0 else -1
	var v := sqrt(absf(dx) * GRAVITY)
	var power := clampf(v / MAX_SPEED * 100.0, 10.0, 100.0)
	_net.send_json(Protocol.build_battle_shot(45.0, power, facing, gun_id))


func _process(delta: float) -> bool:
	_t += delta
	if _role == "challenger" and _map_id == "thanh" and not _sent_challenge and not _in_match and not _match_ended:
		_retry -= delta
		if _retry <= 0.0:
			_retry = 1.0
			for e in _entities:
				if String(e.get("kind", "")) == "player" and String(e.get("name", "")) == _target_name and e["id"] != _you_entity:
					_log("thấy %s, gửi thách đấu" % _target_name)
					_net.send_json(Protocol.build_challenge(int(e["id"])))
					_sent_challenge = true
					break
	if _back_in_world:
		var screens := ""
		for c in _main.get_children():
			if c.get_script() != null:
				screens += String(c.get_script().get_global_name()) + " "
		print("E2E screens: ", screens)
		print("E2E PASS" if _errors.is_empty() else "E2E PASS (có lỗi: %s)" % str(_errors))
		quit(0)
	elif _t > TIMEOUT:
		print("E2E FAIL timeout role=", _role, " map=", _map_id, " errors=", _errors)
		quit(1)
	return false
