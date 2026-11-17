class_name WorldScreen
extends Node2D
## Bản đồ thế giới nhìn từ trên xuống. Chỉ vẽ dữ liệu máy chủ và gửi move_to.

const TILE := 32.0
const ENTITY_RADIUS := 12.0

var _rows: Array = []
var _width := 0
var _height := 0
var _you := -1
var _map_id := ""
var _tracks := {}    # id -> EntityTrack
var _info := {}      # id -> {kind, name}
var _tick_dur := 0.1
var _camera: Camera2D
var _tap_pos := Vector2.ZERO
var _tap_age := 99.0
var _hint: Label
var _has_state := false
var _portals: Array = []   # {rect (ô), name, req}
var _monsters := {}        # id quái -> dữ liệu (tên hiển thị)

# Thách đấu (chỉ hiển thị + gửi ý định)
var _sign_names := {}
var _sel_id := -1               # thực thể đang được chọn trong bảng
var _out := {}                  # lời mời đã gửi: {id, name, expires}
var _in := {}                   # lời mời nhận: {id, text, expires}
var _sel_panel: PanelContainer
var _sel_lbl: Label
var _sel_btn: Button
var _banner: PanelContainer
var _banner_lbl: Label
var _modal: Control
var _modal_lbl: Label
var _toast: Label
var _toast_age := 99.0


func _ready() -> void:
	for s in GameData.load_signs():
		_sign_names[String(s.get("id", ""))] = String(s.get("ten", ""))
	var hz := float(GameData.load_balance().get("worldTickHz", 10))
	_tick_dur = 1.0 / maxf(hz, 1.0)
	_monsters = MapInfo.load_monsters()
	_camera = Camera2D.new()
	add_child(_camera)
	_camera.make_current()
	var layer := CanvasLayer.new()
	add_child(layer)
	_hint = UiKit.label("Đang tải bản đồ...", 22)
	_hint.position = Vector2(16, 40)
	layer.add_child(_hint)
	_build_challenge_ui(layer)
	if _has_state:
		_update_hint()


func _build_challenge_ui(layer: CanvasLayer) -> void:
	# Bảng thông tin người chơi được chạm
	_sel_panel = PanelContainer.new()
	_sel_panel.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	_sel_panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_sel_panel.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_sel_panel.offset_bottom = -24
	_sel_panel.add_theme_stylebox_override("panel", UiKit.panel_style(Color(0.1, 0.12, 0.22, 0.95)))
	_sel_panel.visible = false
	layer.add_child(_sel_panel)
	var sv := VBoxContainer.new()
	sv.add_theme_constant_override("separation", 8)
	_sel_panel.add_child(sv)
	_sel_lbl = UiKit.label("", 22)
	sv.add_child(_sel_lbl)
	var sr := HBoxContainer.new()
	sr.add_theme_constant_override("separation", 10)
	sv.add_child(sr)
	_sel_btn = UiKit.button("Thách đấu", 24, 64.0)
	_sel_btn.custom_minimum_size = Vector2(200, 64)
	_sel_btn.pressed.connect(_on_challenge_pressed)
	sr.add_child(_sel_btn)
	var close := UiKit.button("Đóng", 24, 64.0)
	close.custom_minimum_size = Vector2(120, 64)
	close.pressed.connect(func(): _select(-1))
	sr.add_child(close)

	# Biểu ngữ chờ trả lời
	_banner = PanelContainer.new()
	_banner.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	_banner.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_banner.offset_top = 100
	_banner.add_theme_stylebox_override("panel", UiKit.panel_style(Color(0.25, 0.18, 0.1, 0.95)))
	_banner.visible = false
	layer.add_child(_banner)
	var bh := HBoxContainer.new()
	bh.add_theme_constant_override("separation", 12)
	_banner.add_child(bh)
	_banner_lbl = UiKit.label("", 22)
	bh.add_child(_banner_lbl)
	var cancel := UiKit.button("Hủy", 22, 56.0)
	cancel.custom_minimum_size = Vector2(100, 56)
	cancel.pressed.connect(func():
		if not _out.is_empty():
			Net.send_json(Protocol.build_challenge_cancel(String(_out["id"]))))
	bh.add_child(cancel)

	# Hộp thoại nhận lời thách đấu
	_modal = Control.new()
	_modal.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_modal.visible = false
	layer.add_child(_modal)
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.6)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_modal.add_child(dim)
	var cc := CenterContainer.new()
	cc.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_modal.add_child(cc)
	var mp := PanelContainer.new()
	mp.custom_minimum_size = Vector2(480, 0)
	mp.add_theme_stylebox_override("panel", UiKit.panel_style(Color(0.12, 0.14, 0.28)))
	cc.add_child(mp)
	var mv := VBoxContainer.new()
	mv.add_theme_constant_override("separation", 14)
	mp.add_child(mv)
	_modal_lbl = UiKit.label("", 26)
	_modal_lbl.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_modal_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	mv.add_child(_modal_lbl)
	var mr := HBoxContainer.new()
	mr.add_theme_constant_override("separation", 12)
	mv.add_child(mr)
	var yes := UiKit.button("Nhận", 28, 72.0)
	yes.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	yes.pressed.connect(func(): _reply(true))
	mr.add_child(yes)
	var no := UiKit.button("Từ chối", 28, 72.0)
	no.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	no.pressed.connect(func(): _reply(false))
	mr.add_child(no)

	_toast = UiKit.label("", 24, Color(1, 0.85, 0.4))
	_toast.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	_toast.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_toast.offset_top = 160
	_toast.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(_toast)


func _reply(accept: bool) -> void:
	if _in.is_empty():
		return
	Net.send_json(Protocol.build_challenge_reply(String(_in["id"]), accept))
	_in = {}
	_modal.visible = false


func _toast_show(text: String) -> void:
	if _toast != null:
		_toast.text = text
		_toast_age = 0.0


func _select(id: int) -> void:
	_sel_id = id
	_refresh_sel()


func _refresh_sel() -> void:
	if _sel_panel == null:
		return
	if _sel_id < 0 or not _info.has(_sel_id):
		_sel_id = -1
		_sel_panel.visible = false
		return
	var inf: Dictionary = _info[_sel_id]
	var txt := "%s - %s - cấp %d" % [inf["name"], _sign_names.get(inf["sign"], inf["sign"]), int(inf["level"])]
	var rec := UiText.pvp_record(inf.get("pvp"))
	if not rec.is_empty():
		txt += "\n" + rec
	_sel_lbl.text = txt
	_sel_btn.disabled = not _out.is_empty() or not _in.is_empty()
	_sel_panel.visible = true


func _on_challenge_pressed() -> void:
	if _sel_id < 0 or not _out.is_empty() or not _in.is_empty():
		return
	Net.send_json(Protocol.build_challenge(_sel_id))
	_select(-1)


## Nhận challenge_sent / challenge_received / challenge_closed từ main.
func on_challenge_message(msg: Dictionary) -> void:
	match String(msg.get("type")):
		"challenge_sent":
			_out = {"id": String(msg.get("challengeId", "")), "name": String(msg.get("targetName", "")), "expires": float(msg.get("expiresAt", 0))}
		"challenge_received":
			var sg := String(msg.get("fromSign", ""))
			_in = {
				"id": String(msg.get("challengeId", "")),
				"text": "%s (%s, cấp %d) thách đấu bạn" % [msg.get("fromName", ""), _sign_names.get(sg, sg), int(msg.get("fromLevel", 1))],
				"expires": float(msg.get("expiresAt", 0)),
			}
			_modal.visible = true
		"challenge_closed":
			var cid := String(msg.get("challengeId", ""))
			if (not _out.is_empty() and _out["id"] == cid) or (not _in.is_empty() and _in["id"] == cid):
				_toast_show(UiText.challenge_closed(String(msg.get("reason", ""))))
			if not _out.is_empty() and _out["id"] == cid:
				_out = {}
			if not _in.is_empty() and _in["id"] == cid:
				_in = {}
				_modal.visible = false
	_refresh_sel()


func on_error(code: String, message: String) -> void:
	_toast_show(UiText.server_error(code, message))


func _update_challenge_ui(delta: float) -> void:
	if _banner == null:
		return
	var now := float(Time.get_ticks_msec())
	_banner.visible = not _out.is_empty()
	if _banner.visible:
		_banner_lbl.text = "Đang chờ %s trả lời… (%ds)" % [_out["name"], int(ceil(ClockSync.remaining_seconds(_out["expires"], now)))]
	if _modal.visible and not _in.is_empty():
		_modal_lbl.text = "%s\n(còn %ds)" % [_in["text"], int(ceil(ClockSync.remaining_seconds(_in["expires"], now)))]
	_toast_age += delta
	_toast.modulate.a = clampf(3.0 - _toast_age, 0.0, 1.0)


func apply_state(msg: Dictionary) -> void:
	_map_id = String(msg.get("mapId", ""))
	_width = int(msg.get("width", 0))
	_height = int(msg.get("height", 0))
	_rows = msg.get("rows", [])
	_you = int(msg.get("you", -1))
	_tracks.clear()
	_info.clear()
	_has_state = true
	_load_portals(msg)
	_apply_entities(msg.get("entities", []), true)
	if _hint != null:
		_update_hint()


## Cổng: ưu tiên world_state.portals nếu máy chủ gửi; không thì đọc tệp bản đồ (chỉ để hiển thị).
func _load_portals(msg: Dictionary) -> void:
	var list: Variant = msg.get("portals")
	if typeof(list) != TYPE_ARRAY:
		list = MapInfo.load_map(_map_id).get("portals", [])
	_portals = []
	for p in list:
		if typeof(p) != TYPE_DICTIONARY:
			continue
		var to_id := String(p.get("toMapId", ""))
		_portals.append({
			"rect": Rect2(float(p.get("x", 0)), float(p.get("y", 0)), float(p.get("w", 1)), float(p.get("h", 1))),
			"name": MapInfo.map_name(to_id),
			"req": int(p.get("levelRequired", 0)),
		})


func _update_hint() -> void:
	_hint.text = "Bản đồ: %s - chạm vào bản đồ để di chuyển" % MapInfo.map_name(_map_id)


func on_tick(msg: Dictionary) -> void:
	_apply_entities(msg.get("entities", []), false)


func _now() -> float:
	return Time.get_ticks_msec() / 1000.0


func _apply_entities(list: Array, snap: bool) -> void:
	var now := _now()
	var seen := {}
	for e in list:
		var d: Dictionary = e
		var id := int(d["id"])
		var p := Vector2(float(d["x"]), float(d["y"]))
		seen[id] = true
		_info[id] = {
			"kind": String(d.get("kind", "player")), "name": String(d.get("name", "")),
			"sign": String(d.get("sign", "")), "monsterId": String(d.get("monsterId", "")), "level": int(d.get("level", 1)), "pvp": d.get("pvp"),
		}
		if _tracks.has(id) and not snap:
			_tracks[id].push(p, now)
		else:
			_tracks[id] = EntityTrack.new(p, now, _tick_dur)
	for id in _tracks.keys():
		if not seen.has(id):
			_tracks.erase(id)
			_info.erase(id)
	_refresh_sel()


## Người chơi khác gần điểm chạm (chỉ trong thành), hoặc -1.
func _player_at(world: Vector2) -> int:
	if _map_id != "thanh":
		return -1
	var now := _now()
	var best := -1
	var best_d := ENTITY_RADIUS + 14.0
	for id in _tracks.keys():
		if int(id) == _you or String(_info.get(id, {}).get("kind", "")) != "player":
			continue
		var d: float = ((_tracks[id].sample(now) * TILE) - world).length()
		if d < best_d:
			best_d = d
			best = int(id)
	return best


func _unhandled_input(event: InputEvent) -> void:
	if not _has_state:
		return
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var world := get_global_mouse_position()
		var hit := _player_at(world)
		if hit >= 0:
			_select(hit)
			return
		var tile := world / TILE
		_tap_pos = world
		_tap_age = 0.0
		Net.send_json(Protocol.build_move_to(tile.x, tile.y))


func _process(delta: float) -> void:
	_tap_age += delta
	_update_challenge_ui(delta)
	if _tracks.has(_you):
		_camera.position = _tracks[_you].sample(_now()) * TILE
	queue_redraw()


func _draw() -> void:
	if not _has_state:
		return
	var wall := Color(0.18, 0.2, 0.3)
	var floor_c := Color(0.32, 0.4, 0.3)
	draw_rect(Rect2(-2000, -2000, 4000 + _width * TILE, 4000 + _height * TILE), Color(0.03, 0.04, 0.08))
	draw_rect(Rect2(0, 0, _width * TILE, _height * TILE), floor_c)
	for r in _rows.size():
		var line := String(_rows[r])
		var start := -1
		for c in line.length() + 1:
			var is_wall := c < line.length() and line[c] == "#"
			if is_wall and start < 0:
				start = c
			elif not is_wall and start >= 0:
				draw_rect(Rect2(start * TILE, r * TILE, (c - start) * TILE, TILE), wall)
				start = -1
	var font := ThemeDB.fallback_font
	var now := _now()
	var my_level: int = int(_info.get(_you, {}).get("level", 1))
	for pt in _portals:
		var r: Rect2 = pt["rect"]
		var locked := MapInfo.portal_is_locked(int(pt["req"]), my_level)
		var px := Rect2(r.position * TILE, r.size * TILE)
		draw_rect(px, Color(0.45, 0.2, 0.2, 0.7) if locked else Color(0.3, 0.5, 1.0, 0.7))
		draw_rect(px, Color(1, 1, 1, 0.8), false, 2.0)
		var c := px.position + Vector2(px.size.x / 2.0, 0)
		var label := String(pt["name"])
		if locked:
			label += " (%s)" % UiText.portal_lock_tag(int(pt["req"]))
		draw_string(font, c + Vector2(-100, -8), label, HORIZONTAL_ALIGNMENT_CENTER, 200, 14, Color(1, 0.8, 0.6) if locked else Color.WHITE)
	for id in _tracks.keys():
		var p: Vector2 = _tracks[id].sample(now) * TILE
		var info: Dictionary = _info.get(id, {})
		var is_self: bool = int(id) == _you
		var monster: bool = String(info.get("kind", "")) == "monster"
		var col := Color(0.3, 0.85, 1.0) if is_self else Color(0.4, 0.9, 0.4)
		var rad := ENTITY_RADIUS
		var txt := String(info.get("name", ""))
		if monster:
			var mid := String(info.get("monsterId", ""))
			var st := MapInfo.monster_style(mid)
			col = st["color"]
			rad = ENTITY_RADIUS * float(st["scale"])
			if txt.is_empty():
				txt = MapInfo.monster_name(_monsters, mid)
		draw_circle(p, rad, col)
		if is_self:
			draw_arc(p, rad + 3, 0, TAU, 32, Color.WHITE, 2.0)
		draw_string(font, p + Vector2(-60, -rad - 6), txt, HORIZONTAL_ALIGNMENT_CENTER, 120, 14, Color.WHITE)
	if _tap_age < 0.6:
		var a := 1.0 - _tap_age / 0.6
		draw_arc(_tap_pos, 6 + _tap_age * 30, 0, TAU, 24, Color(1, 1, 1, a), 2.0)
