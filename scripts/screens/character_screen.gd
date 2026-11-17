class_name CharacterScreen
extends Control
## Tạo nhân vật: tên + chọn cung (khoá vĩnh viễn).

var signs: Array = []
var guns := {}  # id súng -> dữ liệu (để hiện tên súng)
var _name: LineEdit
var _status: Label
var _create_btn: Button
var _sign_buttons := {}  # sign id -> Button
var _selected := ""


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
	box.custom_minimum_size = Vector2(760, 0)
	box.add_theme_constant_override("separation", 14)
	center.add_child(box)

	var title := UiKit.label("Tạo nhân vật", 44)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(title)
	_name = UiKit.line_edit("Tên nhân vật (2-16 ký tự)")
	_name.max_length = 16
	box.add_child(_name)
	box.add_child(UiKit.label("Chọn cung:", 24))

	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_theme_constant_override("v_separation", 12)
	box.add_child(grid)
	var group := ButtonGroup.new()
	for s in signs:
		var d: Dictionary = s
		var cell := VBoxContainer.new()
		cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		cell.add_theme_constant_override("separation", 4)
		var b := UiKit.button(String(d.get("ten", d.get("id", "?"))), 28, 64.0)
		b.toggle_mode = true
		b.button_group = group
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var sid := String(d.get("id", ""))
		b.pressed.connect(func(): _selected = sid)
		cell.add_child(b)
		var info := UiKit.label(GunInfo.sign_summary(d, guns), 16, Color(0.8, 0.85, 0.95))
		info.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		info.custom_minimum_size = Vector2(340, 0)
		cell.add_child(info)
		grid.add_child(cell)
		_sign_buttons[sid] = b

	var warn := UiKit.label("Cảnh báo: cung đã chọn là vĩnh viễn, không thể đổi sau khi tạo.", 22, Color(1, 0.8, 0.3))
	warn.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(warn)
	_status = UiKit.label("", 22, Color(1, 0.45, 0.45))
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(_status)
	_create_btn = UiKit.button("Tạo nhân vật")
	_create_btn.pressed.connect(_on_create)
	box.add_child(_create_btn)


func _on_create() -> void:
	var n := _name.text.strip_edges()
	if n.length() < 2:
		_status.text = "Tên phải có ít nhất 2 ký tự."
		return
	if _selected.is_empty():
		_status.text = "Hãy chọn một cung."
		return
	_status.text = ""
	Net.send_json(Protocol.build_create_character(n, _selected))


func on_error(code: String, message: String) -> void:
	_status.text = UiText.server_error(code, message)
