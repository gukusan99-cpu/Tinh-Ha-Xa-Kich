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


func _ready() -> void:
	var hz := float(GameData.load_balance().get("worldTickHz", 10))
	_tick_dur = 1.0 / maxf(hz, 1.0)
	_camera = Camera2D.new()
	add_child(_camera)
	_camera.make_current()
	var layer := CanvasLayer.new()
	add_child(layer)
	_hint = UiKit.label("Đang tải bản đồ...", 22)
	_hint.position = Vector2(16, 40)
	layer.add_child(_hint)
	if _has_state:
		_update_hint()


func apply_state(msg: Dictionary) -> void:
	_map_id = String(msg.get("mapId", ""))
	_width = int(msg.get("width", 0))
	_height = int(msg.get("height", 0))
	_rows = msg.get("rows", [])
	_you = int(msg.get("you", -1))
	_tracks.clear()
	_info.clear()
	_has_state = true
	_apply_entities(msg.get("entities", []), true)
	if _hint != null:
		_update_hint()


func _update_hint() -> void:
	_hint.text = "Bản đồ: %s - chạm vào bản đồ để di chuyển" % _map_id


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
		_info[id] = {"kind": String(d.get("kind", "player")), "name": String(d.get("name", ""))}
		if _tracks.has(id) and not snap:
			_tracks[id].push(p, now)
		else:
			_tracks[id] = EntityTrack.new(p, now, _tick_dur)
	for id in _tracks.keys():
		if not seen.has(id):
			_tracks.erase(id)
			_info.erase(id)


func _unhandled_input(event: InputEvent) -> void:
	if not _has_state:
		return
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var world := get_global_mouse_position()
		var tile := world / TILE
		_tap_pos = world
		_tap_age = 0.0
		Net.send_json(Protocol.build_move_to(tile.x, tile.y))


func _process(delta: float) -> void:
	_tap_age += delta
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
	for id in _tracks.keys():
		var p: Vector2 = _tracks[id].sample(now) * TILE
		var info: Dictionary = _info.get(id, {})
		var is_self: bool = int(id) == _you
		var monster: bool = String(info.get("kind", "")) == "monster"
		var col := Color(0.9, 0.2, 0.2) if monster else (Color(0.3, 0.85, 1.0) if is_self else Color(0.4, 0.9, 0.4))
		draw_circle(p, ENTITY_RADIUS, col)
		if is_self:
			draw_arc(p, ENTITY_RADIUS + 3, 0, TAU, 32, Color.WHITE, 2.0)
		var txt := String(info.get("name", ""))
		draw_string(font, p + Vector2(-60, -ENTITY_RADIUS - 6), txt, HORIZONTAL_ALIGNMENT_CENTER, 120, 14, Color.WHITE)
	if _tap_age < 0.6:
		var a := 1.0 - _tap_age / 0.6
		draw_arc(_tap_pos, 6 + _tap_age * 30, 0, TAU, 24, Color(1, 1, 1, a), 2.0)
