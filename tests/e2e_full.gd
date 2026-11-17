extends SceneTree
## Bot end-to-end (cần máy chủ đang chạy): chạy main.tscn thật, gửi lệnh như người chơi,
## đi hết luồng đăng ký → tạo nhân vật → thành → cổng → chạm quái → trận → về thế giới.
## Cách aim của bot chỉ là ước lượng của bot test, không phải logic game của client.

const TIMEOUT := 240.0
const GRAVITY := 30.0  # chỉ để bot ước lượng lực bắn
const MAX_SPEED := 40.0

var _t := 0.0
var _net: Node
var _main: Node
var _you_entity = null
var _map_id := ""
var _entities: Array = []
var _you_unit = null
var _units: Array = []
var _steps: Array[String] = []
var _errors: Array[String] = []
var _match_ended := false
var _back_in_world := false
var _retarget := 0.0


func _initialize() -> void:
	_main = load("res://scenes/main.tscn").instantiate()
	root.add_child(_main)
	_net = root.get_node("Net")
	_net.connected.connect(_on_connected)
	_net.message_received.connect(_on_msg)


func _step(s: String) -> void:
	_steps.append(s)
	print("E2E ", s)
	# Chụp màn hình khi chạy có cửa sổ và đặt biến môi trường E2E_SHOTS=<thư mục>.
	var dir := OS.get_environment("E2E_SHOTS")
	if dir != "" and DisplayServer.get_name() != "headless":
		_capture.call_deferred(dir, "%02d_%s" % [_steps.size(), s.get_slice(" ", 0)])


func _capture(dir: String, name: String) -> void:
	await create_timer(1.5).timeout
	root.get_viewport().get_texture().get_image().save_png(dir.path_join(name + ".png"))


func _on_connected(_sid: String) -> void:
	_step("welcome")
	var user := "bot%d" % (randi() % 1000000)
	_net.send_json(Protocol.build_register(user, "matkhau123"))


func _on_msg(msg: Dictionary) -> void:
	match String(msg["type"]):
		"auth_ok":
			_step("auth_ok")
			if msg.get("character") == null:
				_net.send_json(Protocol.build_create_character("Xạ Thủ Bot", "bao_binh"))
		"character":
			_step("character")
		"world_state":
			_map_id = String(msg["mapId"])
			_you_entity = msg["you"]
			_entities = msg["entities"]
			_step("world_state " + _map_id)
			if _match_ended:
				_back_in_world = true
			elif _map_id == "thanh":
				_net.send_json(Protocol.build_move_to(28.5, 9.5))
		"world_tick":
			_entities = msg["entities"]
		"match_start":
			_you_unit = msg["you"]
			_units = msg["units"]
			_step("match_start units=%d" % _units.size())
		"phase":
			if String(msg["phase"]) == "move":
				_net.send_json(Protocol.build_battle_move(int(_unit(_you_unit)["col"])))
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
			_step("turn_result turn=%d shots=%d" % [int(msg["turn"]), msg["shots"].size()])
		"match_end":
			_match_ended = true
			_step("match_end %s exp=%s" % [msg["result"], str(msg["rewards"]["exp"])])
		"error":
			_errors.append("%s: %s" % [msg.get("code"), msg.get("message")])
			print("E2E server error ", msg)


func _unit(id) -> Variant:
	for u in _units:
		if u["id"] == id:
			return u
	return null


func _send_aim() -> void:
	var me = _unit(_you_unit)
	var target: Dictionary = {}
	for u in _units:
		if int(u["team"]) == 1 and int(u["hp"]) > 0:
			if target.is_empty() or absf(u["col"] - me["col"]) < absf(target["col"] - me["col"]):
				target = u
	if target.is_empty():
		return
	var dx := float(target["col"]) - float(me["col"])
	var facing := 1 if dx >= 0 else -1
	var v := sqrt(absf(dx) * GRAVITY)  # tầm xa 45° trên mặt phẳng
	var power := clampf(v / MAX_SPEED * 100.0, 10.0, 100.0)
	_net.send_json(Protocol.build_battle_shot(45.0, power, facing, "thuoc_no_nho"))


func _process(delta: float) -> bool:
	_t += delta
	if _map_id == "vung_san_1" and not _match_ended and _you_unit == null:
		_retarget -= delta
		if _retarget <= 0.0:
			_retarget = 0.3
			_chase_monster()
	if _back_in_world:
		var screen_name := ""
		for c in _main.get_children():
			if c.get_script() != null:
				screen_name += String(c.get_script().get_global_name()) + " "
		print("E2E screens: ", screen_name)
		print("E2E PASS" if _errors.is_empty() else "E2E PASS (có lỗi máy chủ: %s)" % str(_errors))
		quit(0)
	elif _t > TIMEOUT:
		print("E2E FAIL timeout, steps=", _steps, " errors=", _errors)
		quit(1)
	return false


func _chase_monster() -> void:
	var me: Dictionary = {}
	for e in _entities:
		if e["id"] == _you_entity:
			me = e
	if me.is_empty():
		return
	var best: Dictionary = {}
	var best_d := INF
	for e in _entities:
		if e["kind"] == "monster":
			var d := Vector2(e["x"] - me["x"], e["y"] - me["y"]).length()
			if d < best_d:
				best_d = d
				best = e
	if not best.is_empty():
		_net.send_json(Protocol.build_move_to(float(best["x"]), float(best["y"])))
