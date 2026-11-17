class_name GunInventory
extends Control
## Kho súng chung (thường/hiếm). Chọn tối đa extraGunSlots súng để mang, "Lưu" gửi set_loadout.
## Chỉ hiển thị và gửi ý định; máy chủ kiểm tra kho súng và số ô.

var _guns := {}
var _slots := 2
var _owned: Array = []
var _selected: Array = []
var _list: VBoxContainer
var _title: Label
var _msg: Label
var _saving := false


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	visible = false
	_guns = GameData.load_guns()
	var nv: Variant = GameData.load_json("res://data/nhan-vat.json")
	if typeof(nv) == TYPE_DICTIONARY:
		_slots = int(nv.get("extraGunSlots", 2))
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.7)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(dim)
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 24)
	add_child(margin)
	var pc := PanelContainer.new()
	pc.add_theme_stylebox_override("panel", UiKit.panel_style(Color(0.12, 0.14, 0.28)))
	margin.add_child(pc)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	pc.add_child(box)
	_title = UiKit.label("", 28, Color(1, 0.9, 0.4))
	box.add_child(_title)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	box.add_child(scroll)
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 8)
	scroll.add_child(_list)
	_msg = UiKit.label("", 22, Color(1, 0.8, 0.4))
	box.add_child(_msg)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	box.add_child(row)
	var save := UiKit.button("Lưu", 28, 72.0)
	save.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	save.pressed.connect(_on_save)
	row.add_child(save)
	var close := UiKit.button("Đóng", 28, 72.0)
	close.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	close.pressed.connect(func(): visible = false)
	row.add_child(close)
	_rebuild()


func open_panel() -> void:
	_msg.text = ""
	visible = true
	_rebuild()


## Nhận nhân vật từ máy chủ (auth_ok / character): cập nhật kho và trang bị.
func set_character(ch: Variant) -> void:
	if typeof(ch) != TYPE_DICTIONARY:
		return
	_owned = GunInfo.owned_common(ch.get("ownedGunIds"), _guns)
	_selected = []
	var lo: Variant = ch.get("loadout")
	if typeof(lo) == TYPE_ARRAY:
		for id in lo:
			if _owned.has(String(id)) and _selected.size() < _slots:
				_selected.append(String(id))
	if _saving:
		_saving = false
		if _msg != null:
			_msg.text = "Đã lưu trang bị."
	_rebuild()


func show_error(text: String) -> void:
	_saving = false
	if _msg != null:
		_msg.text = text


func _rebuild() -> void:
	if _list == null:
		return
	for c in _list.get_children():
		_list.remove_child(c)
		c.queue_free()
	_title.text = "Kho súng - đã chọn %d/%d" % [_selected.size(), _slots]
	if _owned.is_empty():
		_list.add_child(UiKit.label("Chưa có súng chung nào.", 22))
		return
	for id in _owned:
		var g: Dictionary = _guns[id]
		var txt := "%s  [%s]\n%s" % [String(g.get("ten", id)), GunInfo.tier_name(g), GunInfo.describe(g)]
		var b := UiKit.button(txt, 20, 80.0)
		b.toggle_mode = true
		b.button_pressed = _selected.has(id)
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var tc := GunInfo.tier_color(g)
		for cn in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
			b.add_theme_color_override(cn, tc)
		b.pressed.connect(func():
			_selected = GunInfo.toggle_loadout(_selected, String(id), _slots)
			_rebuild())
		_list.add_child(b)


func _on_save() -> void:
	_saving = true
	_msg.text = "Đang lưu..."
	Net.send_json(Protocol.build_set_loadout(_selected))
