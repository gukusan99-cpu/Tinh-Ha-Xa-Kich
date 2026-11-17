extends Control
## Điều khiển luồng màn hình: Đăng nhập -> Tạo nhân vật -> Thế giới -> Trận -> Thế giới.
## Chỉ hiển thị và gửi ý định; mọi kết quả do máy chủ quyết định.

var balance := {}
var signs: Array = []
var character: Variant = null
var _screen: Node = null
var _pending_world := {}
var _status: Label
var _reconnect: Button
var _toast: Label
var _toast_age := 99.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	balance = GameData.load_balance()
	signs = GameData.load_signs()
	_build_topbar()
	Net.connected.connect(_on_connected)
	Net.disconnected.connect(_on_disconnected)
	Net.latency_updated.connect(func(_ms): _refresh_status())
	Net.message_received.connect(_on_message)
	_show_login()
	_connect()


func _connect() -> void:
	_status.text = "Đang kết nối..."
	_reconnect.visible = false
	Net.connect_to_server()


func _build_topbar() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 100
	add_child(layer)
	var bar := HBoxContainer.new()
	bar.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	bar.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	bar.offset_top = 4
	bar.offset_right = -8
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(bar)
	_status = UiKit.label("", 18, Color(0.8, 0.9, 1.0))
	bar.add_child(_status)
	_reconnect = UiKit.button("Kết nối lại", 18, 36.0)
	_reconnect.visible = false
	_reconnect.pressed.connect(_connect)
	bar.add_child(_reconnect)
	_toast = UiKit.label("", 22, Color(1, 0.8, 0.4))
	_toast.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	_toast.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_toast.offset_top = 70
	_toast.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(_toast)


func _process(delta: float) -> void:
	_toast_age += delta
	_toast.modulate.a = clampf(3.0 - _toast_age, 0.0, 1.0)


func _show_toast(text: String) -> void:
	_toast.text = text
	_toast_age = 0.0


func _refresh_status() -> void:
	if Net.online:
		var ping := "-" if Net.latency_ms < 0 else str(Net.latency_ms)
		_status.text = "Trực tuyến | Ping: %s ms" % ping


# ---------------- Kết nối ----------------

func _on_connected(_sid: String) -> void:
	_refresh_status()
	_reconnect.visible = false
	if _screen is LoginScreen:
		_screen.set_online(true)


func _on_disconnected() -> void:
	_status.text = "Mất kết nối"
	_reconnect.visible = true
	_pending_world = {}
	character = null
	if not (_screen is LoginScreen):
		_show_login()
	_screen.set_online(false)


func _sync_clock(msg: Dictionary, with_rtt: bool) -> void:
	if msg.has("serverTime"):
		var rtt := float(Net.latency_ms) if with_rtt else -1.0
		ClockSync.update(float(msg["serverTime"]), float(Time.get_ticks_msec()), rtt)


# ---------------- Màn hình ----------------

func _set_screen(node: Node) -> void:
	if _screen != null:
		remove_child(_screen)
		_screen.queue_free()
	_screen = node
	add_child(node)


func _show_login() -> void:
	var s := LoginScreen.new()
	s._online = Net.online
	_set_screen(s)


func _show_character() -> void:
	var s := CharacterScreen.new()
	s.signs = signs
	s.guns = GameData.load_guns()
	_set_screen(s)


func _show_world(state: Dictionary) -> void:
	var s := WorldScreen.new()
	if not state.is_empty():
		s.apply_state(state)
	_set_screen(s)


func _show_battle(msg: Dictionary) -> void:
	var s := BattleScreen.new()
	s.setup(msg, balance)
	s.finished.connect(_on_battle_finished)
	_pending_world = {}
	_set_screen(s)


func _on_battle_finished() -> void:
	var st := _pending_world
	_pending_world = {}
	_show_world(st)  # nếu world_state chưa tới, WorldScreen chờ rồi nhận qua _on_message


# ---------------- Thông điệp ----------------

func _on_message(msg: Dictionary) -> void:
	match String(msg.get("type")):
		"welcome":
			_sync_clock(msg, false)
		"pong":
			_sync_clock(msg, true)
		"auth_ok":
			character = msg.get("character")
			if character == null:
				_show_character()
			else:
				Net.send_json(Protocol.build_enter_world())
		"auth_error":
			if _screen is LoginScreen:
				_screen.on_message(msg)
		"character":
			character = msg.get("character")
			if _screen is CharacterScreen:
				Net.send_json(Protocol.build_enter_world())
		"world_state":
			if _screen is BattleScreen:
				_pending_world = msg
			elif _screen is WorldScreen:
				_screen.apply_state(msg)
			else:
				_show_world(msg)
		"world_tick":
			if _screen is WorldScreen:
				_screen.on_tick(msg)
		"match_start":
			_show_battle(msg)
		"phase":
			_sync_clock(msg, true)
			if _screen is BattleScreen:
				_screen.on_message(msg)
		"moves_result", "turn_result":
			if _screen is BattleScreen:
				_screen.on_message(msg)
		"match_end":
			if msg.get("character") != null:
				character = msg["character"]
			if _screen is BattleScreen:
				_screen.on_message(msg)
		"error":
			var code := String(msg.get("code", ""))
			var text := String(msg.get("message", ""))
			if _screen != null and _screen.has_method("on_error"):
				_screen.on_error(code, text)
			else:
				_show_toast(UiText.server_error(code, text))
