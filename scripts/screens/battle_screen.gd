class_name BattleScreen
extends Control
## Trận theo lượt. Chỉ hiển thị dữ liệu máy chủ (match_start, phase, moves_result, turn_result,
## match_end) và gửi ý định (battle_move, battle_shot). Không mô phỏng vật lý hay tính sát thương.

signal finished

const MOVE_ANIM_SPEED := 8.0   # ô/giây, chỉ cho hoạt ảnh
const FALL_ANIM_SPEED := 14.0
const TOP_BAR := 84.0
const BOTTOM_PANEL := 250.0
const AIM_LINE_TILES := 2.5
const AIM_PREVIEW_PER_SEC := 5.0   # máy chủ giới hạn tối đa 5 lần/giây
const SLIDE_SPEED := 6.0
const FX_BUBBLE := 0.9

var _bal := {}
var _guns := {}         # id súng -> dữ liệu (chỉ hiển thị)
var _energy_max := 10
var _gun_id := ""
var _gun_box: HBoxContainer
var _energy_bar: ProgressBar
var _energy_lbl: Label
var _preview_points := []
var _preview_dirty := false
var _last_preview_ms := -1.0
var _next_extra := 0
var _fx := []
var _terrain: Terrain
var _units := {}        # id -> Dictionary
var _you := -1
var _pvp := false
var _vs_lbl: Label
var _max_turns := 0
var _turn := 0
var _phase := ""
var _deadline := 0.0
var _mode := "idle"     # idle | moves | replay
var _ts := 20.0
var _origin := Vector2.ZERO
var _radius := 0.75
var _move_target := -1
var _status_text := ""
var _pending_end := {}
var _end_shown := false

var _move_anims := []
var _plan := {}
var _rt := 0.0
var _next_event := 0
var _fall_started := false
var _flashes := []
var _floaters := []

# UI
var _info: Label
var _panel: PanelContainer
var _aim_box: Control
var _move_hint: Label
var _angle: HSlider
var _power: HSlider
var _angle_lbl: Label
var _power_lbl: Label
var _facing_btn: Button
var _facing := 1
var _status_lbl: Label
var _popup: Control


func setup(msg: Dictionary, balance: Dictionary) -> void:
	_bal = balance
	_radius = float(balance.get("unitRadiusTiles", 0.75))
	var map: Dictionary = msg.get("map", {})
	_terrain = Terrain.from_rows(map.get("rows", []), int(map.get("width", -1)), int(map.get("height", -1)))
	_you = int(msg.get("you", -1))
	_pvp = String(msg.get("mode", "pve")) == "pvp"
	_max_turns = int(msg.get("maxTurns", 0))
	for u in msg.get("units", []):
		var d: Dictionary = u
		var id := int(d["id"])
		_units[id] = {
			"id": id, "name": String(d.get("name", "")), "team": int(d.get("team", 0)),
			"col": int(d.get("col", 0)), "y": float(d.get("y", 0)),
			"hp": int(d.get("hp", 0)), "maxHp": maxi(int(d.get("maxHp", 1)), 1),
			"facing": -1 if int(d.get("facing", 1)) < 0 else 1,
			"alive": int(d.get("hp", 0)) > 0, "alpha": 1.0,
			"pos": Vector2(int(d.get("col", 0)) + 0.5, float(d.get("y", 0))),
			"fall_to": -999.0, "slide_to": -999.0,
			"guns": [], "energy": 0, "cooldowns": {}, "statuses": [],
		}
		GunInfo.apply_unit_state(_units[id], d)
	_guns = GameData.load_guns()
	var nv: Variant = GameData.load_json("res://data/nhan-vat.json")
	if typeof(nv) == TYPE_DICTIONARY:
		_energy_max = maxi(int(nv.get("energyMax", 10)), 1)
	if _units.has(_you):
		_facing = _units[_you]["facing"]


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	_build_ui()
	resized.connect(_layout)
	_layout()


func _build_ui() -> void:
	_info = UiKit.label("", 26)
	_info.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	_info.offset_top = 14
	_info.offset_bottom = 50.0
	_info.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(_info)
	_vs_lbl = UiKit.label("", 20)
	_vs_lbl.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	_vs_lbl.offset_top = 50
	_vs_lbl.offset_bottom = TOP_BAR
	_vs_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_vs_lbl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_vs_lbl)

	_panel = PanelContainer.new()
	_panel.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	_panel.offset_top = -BOTTOM_PANEL
	_panel.offset_bottom = 0
	_panel.add_theme_stylebox_override("panel", UiKit.panel_style(Color(0.1, 0.12, 0.22, 0.95)))
	add_child(_panel)
	var holder := VBoxContainer.new()
	_panel.add_child(holder)
	_status_lbl = UiKit.label("", 20, Color(0.8, 0.9, 1.0))
	holder.add_child(_status_lbl)

	_move_hint = UiKit.label("Chạm vào một cột trên bản đồ để chọn nơi di chuyển.", 26)
	_move_hint.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_move_hint.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	holder.add_child(_move_hint)

	var aim_vbox := VBoxContainer.new()
	aim_vbox.size_flags_vertical = Control.SIZE_EXPAND_FILL
	aim_vbox.add_theme_constant_override("separation", 6)
	_aim_box = aim_vbox
	holder.add_child(aim_vbox)

	# Hàng súng + nội lực
	var gun_row := HBoxContainer.new()
	gun_row.add_theme_constant_override("separation", 10)
	aim_vbox.add_child(gun_row)
	var en_col := VBoxContainer.new()
	en_col.custom_minimum_size = Vector2(150, 0)
	_energy_lbl = UiKit.label("", 20, Color(0.6, 0.9, 1.0))
	en_col.add_child(_energy_lbl)
	_energy_bar = ProgressBar.new()
	_energy_bar.min_value = 0
	_energy_bar.max_value = _energy_max
	_energy_bar.show_percentage = false
	_energy_bar.custom_minimum_size = Vector2(0, 18)
	en_col.add_child(_energy_bar)
	gun_row.add_child(en_col)
	_gun_box = HBoxContainer.new()
	_gun_box.add_theme_constant_override("separation", 8)
	_gun_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	gun_row.add_child(_gun_box)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 20)
	aim_vbox.add_child(row)

	var a_min := float(_bal.get("aimAngleMinDegrees", -30))
	var a_max := float(_bal.get("aimAngleMaxDegrees", 80))
	var col1 := VBoxContainer.new()
	col1.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_angle_lbl = UiKit.label("", 22)
	col1.add_child(_angle_lbl)
	_angle = HSlider.new()
	_angle.min_value = a_min
	_angle.max_value = a_max
	_angle.step = 1
	_angle.value = clampf(45.0, a_min, a_max)
	UiKit.style_slider(_angle)
	_angle.value_changed.connect(func(_v):
		_preview_dirty = true
		_refresh_labels())
	col1.add_child(_angle)
	row.add_child(col1)

	var col2 := VBoxContainer.new()
	col2.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_power_lbl = UiKit.label("", 22)
	col2.add_child(_power_lbl)
	_power = HSlider.new()
	_power.min_value = 0
	_power.max_value = 100
	_power.step = 1
	_power.value = 50
	UiKit.style_slider(_power)
	_power.value_changed.connect(func(_v):
		_preview_dirty = true
		_refresh_labels())
	col2.add_child(_power)
	row.add_child(col2)

	_facing_btn = UiKit.button("", 26, 80.0)
	_facing_btn.custom_minimum_size = Vector2(150, 80)
	_facing_btn.pressed.connect(func():
		_facing = -_facing
		_preview_dirty = true
		_refresh_labels())
	row.add_child(_facing_btn)
	var shoot := UiKit.button("Bắn", 32, 80.0)
	shoot.custom_minimum_size = Vector2(150, 80)
	shoot.pressed.connect(_on_shoot)
	row.add_child(shoot)
	_refresh_labels()
	_refresh_guns()
	_update_phase_ui()


## Dựng lại hàng nút súng và thanh nội lực từ trạng thái đơn vị của mình (chỉ hiển thị).
func _refresh_guns() -> void:
	if _gun_box == null:
		return
	for c in _gun_box.get_children():
		_gun_box.remove_child(c)
		c.queue_free()
	if not _units.has(_you):
		return
	var u: Dictionary = _units[_you]
	var energy := int(u["energy"])
	var cds: Dictionary = u["cooldowns"]
	var ids: Array = u["guns"]
	_energy_bar.max_value = _energy_max
	_energy_bar.value = energy
	_energy_lbl.text = "Nội lực: %d/%d" % [energy, _energy_max]
	var cur_ok: bool = _guns.has(_gun_id) and ids.has(_gun_id) and GunInfo.availability(_guns[_gun_id], energy, cds)["ok"]
	if not cur_ok:
		_gun_id = GunInfo.first_available(ids, _guns, energy, cds)
	for id in ids:
		var gid := String(id)
		var g: Dictionary = _guns.get(gid, {"id": gid, "ten": gid})
		var b := UiKit.button(GunInfo.gun_button_text(g, energy, cds), 18, 64.0)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.toggle_mode = true
		b.button_pressed = gid == _gun_id
		b.disabled = not GunInfo.availability(g, energy, cds)["ok"]
		b.pressed.connect(func():
			_gun_id = gid
			_preview_dirty = true
			_refresh_guns())
		_gun_box.add_child(b)
	_preview_dirty = true


func _refresh_labels() -> void:
	_angle_lbl.text = "Góc: %d°" % int(_angle.value)
	_power_lbl.text = "Lực: %d" % int(_power.value)
	_facing_btn.text = "<< Trái" if _facing < 0 else "Phải >>"


func _layout() -> void:
	var vs := size
	if _terrain == null or _terrain.width <= 0 or _terrain.height <= 0:
		return
	var area := Rect2(0, TOP_BAR, vs.x, maxf(vs.y - TOP_BAR - BOTTOM_PANEL, 50.0))
	_ts = clampf(minf(area.size.x / _terrain.width, area.size.y / _terrain.height), 4.0, 28.0)
	var map_size := Vector2(_terrain.width, _terrain.height) * _ts
	_origin = area.position + (area.size - map_size) / 2.0


func _update_phase_ui() -> void:
	if _panel == null:
		return
	var alive := _self_alive()
	_aim_box.visible = _phase == "aim" and alive
	_move_hint.visible = not _aim_box.visible
	if not alive:
		_move_hint.text = "Bạn đã bị loại, đang theo dõi trận."
	elif _phase == "move":
		_move_hint.text = "Chạm vào một cột trên bản đồ để chọn nơi di chuyển."
	elif _phase == "aim":
		_move_hint.text = ""
	else:
		_move_hint.text = "Đang chờ máy chủ..."


func _self_alive() -> bool:
	return _units.has(_you) and _units[_you]["alive"] and _units[_you]["hp"] > 0


# ---------------- Thông điệp từ máy chủ ----------------

func on_message(msg: Dictionary) -> void:
	match String(msg.get("type")):
		"phase":
			_turn = int(msg.get("turn", _turn))
			_phase = String(msg.get("phase", ""))
			_deadline = float(msg.get("deadline", 0))
			_move_target = -1
			_status_text = ""
			_preview_points = []
			_last_preview_ms = -1.0
			_apply_unit_states(msg.get("units", []))
			_refresh_guns()
			_update_phase_ui()
		"aim_preview":
			if _phase == "aim":
				_preview_points = msg.get("points", [])
		"moves_result":
			_begin_moves(msg)
		"turn_result":
			_begin_replay(msg)
		"match_end":
			_pending_end = msg


func _apply_unit_states(list: Variant) -> void:
	if typeof(list) != TYPE_ARRAY:
		return
	for s in list:
		if typeof(s) == TYPE_DICTIONARY and s.has("id") and _units.has(int(s["id"])):
			GunInfo.apply_unit_state(_units[int(s["id"])], s)


func _surface_for(col: int, from_y: float) -> float:
	var r := _terrain.surface_row(col, int(from_y) - 2)
	return float(r) if r >= 0 else from_y


func _begin_moves(msg: Dictionary) -> void:
	_move_anims.clear()
	for m in msg.get("moves", []):
		var d: Dictionary = m
		var id := int(d["unitId"])
		if not _units.has(id):
			continue
		var u: Dictionary = _units[id]
		var pts := []
		for c in d.get("path", []):
			pts.append(Vector2(int(c) + 0.5, _surface_for(int(c), u["y"])))
		_move_anims.append({"id": id, "pts": pts, "i": 0, "col": int(d["col"]), "y": float(d["y"])})
	_mode = "moves"
	_phase = ""
	_update_phase_ui()


func _tick_moves(delta: float) -> void:
	var all_done := true
	for a in _move_anims:
		var u: Dictionary = _units[a["id"]]
		if a["i"] < a["pts"].size():
			var target: Vector2 = a["pts"][a["i"]]
			u["pos"] = (u["pos"] as Vector2).move_toward(target, MOVE_ANIM_SPEED * delta)
			if (u["pos"] as Vector2).is_equal_approx(target):
				a["i"] += 1
			all_done = false
	if all_done:
		for a in _move_anims:
			var u: Dictionary = _units[a["id"]]
			u["col"] = a["col"]
			u["y"] = a["y"]
			u["pos"] = Vector2(a["col"] + 0.5, a["y"])
		_move_anims.clear()
		_mode = "idle"


func _begin_replay(msg: Dictionary) -> void:
	var pos := {}
	for id in _units.keys():
		pos[id] = (_units[id]["pos"] as Vector2) + Vector2(0, -_radius)
	_plan = ReplayPlan.build(msg, _guns, pos)
	_rt = 0.0
	_next_event = 0
	_next_extra = 0
	_preview_points = []
	_fall_started = false
	_mode = "replay"
	_phase = ""
	_update_phase_ui()


func _tick_replay(delta: float) -> void:
	_rt += delta
	var events: Array = _plan["events"]
	while _next_event < events.size() and events[_next_event]["t"] <= _rt:
		_fire_explosion(events[_next_event])
		_next_event += 1
	var extra: Array = _plan["extra"]
	while _next_extra < extra.size() and extra[_next_extra]["t"] <= _rt:
		_fire_extra(extra[_next_extra])
		_next_extra += 1
	for id in _units.keys():
		var su: Dictionary = _units[id]
		if su["slide_to"] > -900.0:
			var sp: Vector2 = su["pos"]
			sp.x = move_toward(sp.x, su["slide_to"], SLIDE_SPEED * delta)
			su["pos"] = sp
	if not _fall_started and _rt >= _plan["fall_time"]:
		_fall_started = true
		for f in _plan["falls"]:
			var id := int(f["unitId"])
			if _units.has(id):
				var fy := float(f["y"])
				_units[id]["fall_to"] = fy if fy >= 0 else float(_terrain.height + 3)
				if fy >= 0:
					_units[id]["y"] = fy
	if _fall_started:
		var deaths: Array = _plan["deaths"]
		for id in _units.keys():
			var u: Dictionary = _units[id]
			if u["fall_to"] > -900.0:
				var pos: Vector2 = u["pos"]
				pos.y = move_toward(pos.y, u["fall_to"], FALL_ANIM_SPEED * delta)
				u["pos"] = pos
			if deaths.has(id) or deaths.has(float(id)):
				u["alpha"] = maxf(0.0, u["alpha"] - delta * 1.5)
	if _rt >= _plan["duration"]:
		_finish_replay()


func _fire_explosion(ev: Dictionary) -> void:
	var ex: Dictionary = ev["explosion"]
	var center := Vector2(float(ex["x"]), float(ex["y"]))
	_flashes.append({"pos": center, "radius": float(ex["radius"]), "age": 0.0})
	_terrain.remove_tiles(ex.get("removedTiles", []))
	if ev["crit"]:
		_floaters.append({"text": "CHÍ MẠNG", "pos": center + Vector2(0, -1.2), "age": 0.0, "color": Color(1, 0.85, 0.2)})
	for dmg in ev["damages"]:
		var uid := int(dmg["unitId"])
		if not _units.has(uid):
			continue
		var u: Dictionary = _units[uid]
		u["hp"] = int(dmg["hpAfter"])
		var p: Vector2 = u["pos"]
		_floaters.append({"text": "-%d" % int(dmg["amount"]), "pos": p + Vector2(0, -_radius * 2.2), "age": 0.0, "color": Color(1, 0.4, 0.4)})


func _unit_label_pos(id: int) -> Vector2:
	if not _units.has(id):
		return Vector2.ZERO
	return (_units[id]["pos"] as Vector2) + Vector2(0, -_radius * 2.2)


func _float_text(text: String, pos: Vector2, color: Color) -> void:
	_floaters.append({"text": text, "pos": pos, "age": 0.0, "color": color})


## Hiệu ứng ngoài vụ nổ: self, khiên hấp thụ, trạng thái, đẩy lùi, cháy.
func _fire_extra(x: Dictionary) -> void:
	var ev: Dictionary = x["ev"]
	var uid := int(ev.get("unitId", -1))
	if not _units.has(uid):
		return
	var u: Dictionary = _units[uid]
	match String(x["kind"]):
		"self", "status":
			var st: Dictionary = ev.get("status", {})
			var type := String(st.get("type", ""))
			u["statuses"] = GunInfo.put_status(u["statuses"], st)
			_float_text(GunInfo.status_text(st), _unit_label_pos(uid), GunInfo.status_color(type))
			if String(x["kind"]) == "self":
				_fx.append({"type": "bubble" if type == "shield" else "glow", "uid": uid, "age": 0.0})
		"shield":
			_float_text("-%d khiên" % int(ev.get("amount", 0)), _unit_label_pos(uid) + Vector2(0, -0.6), GunInfo.status_color("shield"))
			_fx.append({"type": "bubble", "uid": uid, "age": 0.0})
		"knockback":
			u["col"] = int(ev.get("toCol", u["col"]))
			u["slide_to"] = float(u["col"]) + 0.5
		"burn":
			u["hp"] = int(ev.get("hpAfter", u["hp"]))
			_float_text("-%d cháy" % int(ev.get("amount", 0)), _unit_label_pos(uid), GunInfo.status_color("burn"))


func _finish_replay() -> void:
	for id in _units.keys():
		var u: Dictionary = _units[id]
		if u["fall_to"] > -900.0 and u["fall_to"] <= _terrain.height:
			u["pos"] = Vector2(u["col"] + 0.5, u["y"])
		elif u["slide_to"] > -900.0:
			u["pos"] = Vector2(u["col"] + 0.5, (u["pos"] as Vector2).y)
		u["fall_to"] = -999.0
		u["slide_to"] = -999.0
	_apply_unit_states(_plan.get("units", []))
	for d in _plan["deaths"]:
		var id := int(d)
		if _units.has(id):
			_units[id]["alive"] = false
			_units[id]["alpha"] = 0.0
			_units[id]["hp"] = 0
	_plan = {}
	_mode = "idle"
	_refresh_guns()
	_update_phase_ui()


# ---------------- Gửi ý định ----------------

func _unhandled_input_tap(pos: Vector2) -> void:
	if _phase != "move" or _mode != "idle" or not _self_alive():
		return
	var col := int(floor((pos.x - _origin.x) / _ts))
	if col < 0 or col >= _terrain.width:
		return
	_move_target = col
	Net.send_json(Protocol.build_battle_move(col))
	_status_text = "Đã chọn cột %d (chạm cột khác để đổi)." % col


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_unhandled_input_tap(event.position)


func _on_shoot() -> void:
	if _phase != "aim" or _mode != "idle":
		return
	if _gun_id.is_empty():
		_status_text = "Không có súng nào dùng được."
		return
	Net.send_json(Protocol.build_battle_shot(_angle.value, _power.value, _facing, _gun_id))
	_status_text = "Đã gửi lệnh bắn %s (góc %d°, lực %d). Có thể sửa và bắn lại trước hạn chót." % [GunInfo.gun_name(_guns, _gun_id), int(_angle.value), int(_power.value)]


## Gửi aim_preview khi có Ngắm chuẩn, tối đa AIM_PREVIEW_PER_SEC lần/giây.
func _maybe_send_preview() -> void:
	if not _preview_dirty or _phase != "aim" or _mode != "idle" or not _self_alive() or _gun_id.is_empty():
		return
	if not GunInfo.has_status(_units[_you]["statuses"], "trueAim"):
		_preview_points = []
		_preview_dirty = false
		return
	if String(_guns.get(_gun_id, {}).get("kind", "")) == "self":
		_preview_points = []
		_preview_dirty = false
		return
	var now := float(Time.get_ticks_msec())
	if not GunInfo.preview_due(now, _last_preview_ms, AIM_PREVIEW_PER_SEC):
		return
	_last_preview_ms = now
	_preview_dirty = false
	Net.send_json(Protocol.build_aim_preview(_gun_id, _angle.value, _power.value, _facing))


# ---------------- Vòng lặp & vẽ ----------------

func _process(delta: float) -> void:
	match _mode:
		"moves":
			_tick_moves(delta)
		"replay":
			_tick_replay(delta)
	_maybe_send_preview()
	for f in _fx:
		f["age"] += delta
	_fx = _fx.filter(func(f): return f["age"] < FX_BUBBLE)
	for f in _flashes:
		f["age"] += delta
	_flashes = _flashes.filter(func(f): return f["age"] < 0.5)
	for f in _floaters:
		f["age"] += delta
	_floaters = _floaters.filter(func(f): return f["age"] < 1.4)
	_update_info()
	if _mode == "idle" and not _pending_end.is_empty() and not _end_shown:
		_show_end()
	queue_redraw()


func _update_info() -> void:
	var turn_txt := "Lượt %d" % _turn
	if _max_turns > 0:
		turn_txt += "/%d" % _max_turns
	var txt := ("Thách đấu - " if _pvp else "") + turn_txt
	if _mode == "replay":
		txt += " - Đang phát lại"
	elif _mode == "moves":
		txt += " - Di chuyển"
	elif _phase != "":
		var left := ClockSync.remaining_seconds(_deadline, float(Time.get_ticks_msec()))
		txt += " - %s - %ds" % [UiText.phase_name(_phase), int(ceil(left))]
	_info.text = txt
	_status_lbl.text = _status_text
	_vs_lbl.text = _vs_text()


func _my_team() -> int:
	return int(_units[_you]["team"]) if _units.has(_you) else 0


func _is_enemy(u: Dictionary) -> bool:
	return int(u["team"]) != _my_team()


func _vs_text() -> String:
	if not _pvp or not _units.has(_you):
		return ""
	var me: Dictionary = _units[_you]
	var txt := "%s %d/%d" % [me["name"], maxi(int(me["hp"]), 0), int(me["maxHp"])]
	for id in _units.keys():
		var u: Dictionary = _units[id]
		if _is_enemy(u):
			txt += "   |   Đối thủ %s %d/%d" % [u["name"], maxi(int(u["hp"]), 0), int(u["maxHp"])]
	return txt


func _to_screen(p: Vector2) -> Vector2:
	return _origin + p * _ts


func _draw() -> void:
	if _terrain == null:
		return
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.07, 0.1, 0.2))
	var map_rect := Rect2(_origin, Vector2(_terrain.width, _terrain.height) * _ts)
	draw_rect(map_rect, Color(0.14, 0.2, 0.38))
	var earth := Color(0.45, 0.33, 0.2)
	for r in _terrain.height:
		var start := -1
		for c in _terrain.width + 1:
			var solid := _terrain.is_solid(c, r)
			if solid and start < 0:
				start = c
			elif not solid and start >= 0:
				draw_rect(Rect2(_origin + Vector2(start, r) * _ts, Vector2(c - start, 1) * _ts), earth)
				start = -1
	_draw_move_marker()
	var font := ThemeDB.fallback_font
	for id in _units.keys():
		_draw_unit(font, _units[id])
	_draw_aim_line()
	_draw_fx()
	_draw_projectiles()
	for f in _flashes:
		var k: float = f["age"] / 0.5
		var rad: float = f["radius"] * _ts * (0.4 + 0.6 * k)
		draw_circle(_to_screen(f["pos"]), rad, Color(1.0, 0.8, 0.3, 0.7 * (1.0 - k)))
	for f in _floaters:
		var p := _to_screen(f["pos"]) + Vector2(0, -f["age"] * 30.0)
		var col: Color = f["color"]
		col.a = clampf(1.6 - f["age"], 0.0, 1.0)
		draw_string(font, p + Vector2(-60, 0), f["text"], HORIZONTAL_ALIGNMENT_CENTER, 120, 22, col)


func _draw_move_marker() -> void:
	if _move_target < 0 or _phase != "move":
		return
	var top := _origin + Vector2(_move_target, 0) * _ts
	draw_rect(Rect2(top, Vector2(_ts, _terrain.height * _ts)), Color(1, 1, 0.4, 0.15))
	var y := 0.0
	if _units.has(_you):
		y = _surface_for(_move_target, _units[_you]["y"])
	var tip := _to_screen(Vector2(_move_target + 0.5, y))
	draw_colored_polygon(PackedVector2Array([tip, tip + Vector2(-_ts * 0.6, -_ts * 1.2), tip + Vector2(_ts * 0.6, -_ts * 1.2)]), Color(1, 0.9, 0.2))


func _draw_unit(font: Font, u: Dictionary) -> void:
	if not u["alive"] and u["alpha"] <= 0.0:
		return
	var a: float = u["alpha"]
	var feet: Vector2 = u["pos"]
	var center := _to_screen(feet + Vector2(0, -_radius))
	var is_self: bool = u["id"] == _you
	var col := Color(0.9, 0.25, 0.25) if _is_enemy(u) else (Color(0.3, 0.85, 1.0) if is_self else Color(0.4, 0.9, 0.5))
	col.a = a
	var rpx := _radius * _ts
	draw_circle(center, rpx, col)
	if is_self:
		draw_arc(center, rpx + 2, 0, TAU, 24, Color(1, 1, 1, a), 2.0)
	draw_circle(center + Vector2(u["facing"] * rpx * 0.5, -rpx * 0.2), maxf(rpx * 0.2, 1.5), Color(0, 0, 0, a))
	# Thanh máu
	var bw := maxf(_ts * 2.0, 30.0)
	var bp := center + Vector2(-bw / 2.0, -rpx - 12)
	draw_rect(Rect2(bp, Vector2(bw, 6)), Color(0.15, 0.05, 0.05, a))
	var frac := clampf(float(u["hp"]) / float(u["maxHp"]), 0.0, 1.0)
	draw_rect(Rect2(bp, Vector2(bw * frac, 6)), Color(0.3, 0.9, 0.3, a))
	var enemy_pvp: bool = _pvp and _is_enemy(u)
	var nm := ("Đối thủ: " if enemy_pvp else "") + String(u["name"])
	var nc := Color(1, 0.4, 0.4, a) if enemy_pvp else Color(1, 1, 1, a)
	draw_string(font, bp + Vector2(-20, -4), nm, HORIZONTAL_ALIGNMENT_CENTER, bw + 40, 14, nc)
	# Trạng thái: nhãn xếp chồng phía trên tên; khiên có vòng bao quanh
	var statuses: Array = u["statuses"]
	var line := 0
	for s in statuses:
		var sc := GunInfo.status_color(String(s.get("type", "")))
		sc.a = a
		if String(s.get("type", "")) == "shield":
			draw_arc(center, rpx + 5, 0, TAU, 28, Color(sc.r, sc.g, sc.b, 0.8 * a), 2.0)
		draw_string(font, bp + Vector2(-20, -20 - line * 15), GunInfo.status_text(s), HORIZONTAL_ALIGNMENT_CENTER, bw + 40, 13, sc)
		line += 1


func _draw_aim_line() -> void:
	if _phase != "aim" or _mode != "idle" or not _self_alive():
		return
	var u: Dictionary = _units[_you]
	if GunInfo.has_status(u["statuses"], "trueAim") and _preview_points.size() >= 2:
		for i in _preview_points.size() - 1:
			var a := _to_screen(Vector2(_preview_points[i][0], _preview_points[i][1]))
			var b := _to_screen(Vector2(_preview_points[i + 1][0], _preview_points[i + 1][1]))
			draw_dashed_line(a, b, Color(1, 1, 0.5), 3.0, 8.0)
		return
	var rad := deg_to_rad(_angle.value)
	var dir := Vector2(_facing * cos(rad), -sin(rad))
	var start := _to_screen((u["pos"] as Vector2) + Vector2(0, -_radius))
	draw_line(start, start + dir * AIM_LINE_TILES * _ts, Color(1, 1, 0.5), 3.0)


func _draw_fx() -> void:
	for f in _fx:
		var uid := int(f["uid"])
		if not _units.has(uid):
			continue
		var center := _to_screen((_units[uid]["pos"] as Vector2) + Vector2(0, -_radius))
		var k: float = f["age"] / FX_BUBBLE
		var rpx := _radius * _ts
		if f["type"] == "bubble":
			draw_circle(center, rpx * (1.3 + 0.4 * k), Color(0.4, 0.9, 1.0, 0.35 * (1.0 - k)))
			draw_arc(center, rpx * (1.3 + 0.4 * k), 0, TAU, 32, Color(0.7, 1.0, 1.0, 1.0 - k), 3.0)
		else:
			draw_circle(center, rpx * (1.0 + 1.2 * k), Color(1.0, 1.0, 0.5, 0.45 * (1.0 - k)))


func _draw_projectiles() -> void:
	if _mode != "replay" or _plan.is_empty():
		return
	for f in _plan["flights"]:
		var local: float = _rt - float(f["start"])
		if local < 0.0 or local > f["duration"]:
			continue
		var frac: float = local / f["duration"]
		var trail := ReplayPlan.points_upto(f["points"], frac)
		var child: bool = f["isChild"]
		if trail.size() >= 2:
			var scr := PackedVector2Array()
			for p in trail:
				scr.append(_to_screen(p))
			draw_polyline(scr, Color(0.8, 0.7, 1.0, 0.6) if child else Color(1, 0.85, 0.4, 0.6), 2.0)
		if trail.size() >= 1:
			draw_circle(_to_screen(trail[trail.size() - 1]), maxf(_ts * 0.25, 3.0), Color(0.85, 0.8, 1.0) if child else Color(1, 0.95, 0.6))


# ---------------- Kết thúc trận ----------------

func _show_end() -> void:
	_end_shown = true
	var rewards: Dictionary = _pending_end.get("rewards", {})
	var exp_gain := int(rewards.get("exp", 0))
	_popup = Control.new()
	_popup.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(_popup)
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.6)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_popup.add_child(dim)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_popup.add_child(center)
	var pc := PanelContainer.new()
	pc.custom_minimum_size = Vector2(460, 0)
	pc.add_theme_stylebox_override("panel", UiKit.panel_style(Color(0.12, 0.14, 0.28)))
	center.add_child(pc)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 16)
	pc.add_child(box)
	var res := String(_pending_end.get("result", ""))
	var t := UiKit.label(UiText.pvp_result(res) if _pvp else UiText.match_result(res), 48, Color(1, 0.9, 0.4))
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(t)
	var ch: Variant = _pending_end.get("character")
	if _pvp:
		var rec := UiKit.label(UiText.pvp_record(ch.get("pvp") if typeof(ch) == TYPE_DICTIONARY else null), 28)
		rec.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		box.add_child(rec)
	else:
		var e := UiKit.label("Kinh nghiệm nhận được: +%d EXP" % exp_gain, 28)
		e.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		box.add_child(e)
	if not _pvp and typeof(ch) == TYPE_DICTIONARY:
		var lv := UiKit.label("Cấp %d (%d EXP)" % [int(ch.get("level", 1)), int(ch.get("exp", 0))], 24, Color(0.8, 0.9, 1.0))
		lv.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		box.add_child(lv)
	var ok := UiKit.button("Tiếp tục")
	ok.pressed.connect(func(): finished.emit())
	box.add_child(ok)
