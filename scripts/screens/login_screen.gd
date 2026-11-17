class_name LoginScreen
extends Control
## Đăng nhập / đăng ký. Chỉ gửi ý định, hiển thị lỗi theo mã auth_error.

var _user: LineEdit
var _pass: LineEdit
var _error: Label
var _login_btn: Button
var _reg_btn: Button
var _online := false


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var bg := ColorRect.new()
	bg.color = Color(0.05, 0.07, 0.15)
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(center)
	var box := VBoxContainer.new()
	box.custom_minimum_size = Vector2(480, 0)
	box.add_theme_constant_override("separation", 16)
	center.add_child(box)

	var title := UiKit.label("Tinh Hà Xạ Kích", 52)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(title)
	_user = UiKit.line_edit("Tên đăng nhập")
	_user.max_length = 16
	box.add_child(_user)
	_pass = UiKit.line_edit("Mật khẩu", true)
	_pass.max_length = 64
	_pass.text_submitted.connect(func(_t): _on_login())
	box.add_child(_pass)
	_error = UiKit.label("", 22, Color(1, 0.45, 0.45))
	_error.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_error.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_error.custom_minimum_size = Vector2(0, 56)
	box.add_child(_error)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 16)
	box.add_child(row)
	_login_btn = UiKit.button("Đăng nhập")
	_login_btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_login_btn.pressed.connect(_on_login)
	row.add_child(_login_btn)
	_reg_btn = UiKit.button("Đăng ký")
	_reg_btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_reg_btn.pressed.connect(_on_register)
	row.add_child(_reg_btn)
	set_online(_online)


func set_online(online: bool) -> void:
	_online = online
	if _login_btn == null:
		return
	_login_btn.disabled = not online
	_reg_btn.disabled = not online
	if not online:
		_error.text = "Chưa kết nối máy chủ."
	elif _error.text == "Chưa kết nối máy chủ.":
		_error.text = ""


func _on_login() -> void:
	_error.text = ""
	Net.send_json(Protocol.build_login(_user.text.strip_edges(), _pass.text))


func _on_register() -> void:
	_error.text = ""
	Net.send_json(Protocol.build_register(_user.text.strip_edges(), _pass.text))


func on_message(msg: Dictionary) -> void:
	if String(msg.get("type")) == "auth_error":
		_error.text = UiText.auth_error(String(msg.get("code", "")))


func on_error(code: String, message: String) -> void:
	_error.text = UiText.server_error(code, message)
