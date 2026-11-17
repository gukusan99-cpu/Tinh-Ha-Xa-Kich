class_name UiKit
extends RefCounted
## Trợ giúp dựng giao diện cảm ứng bằng code (không dùng asset ngoài).


static func label(text: String, size: int = 24, color: Color = Color.WHITE) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


static func button(text: String, size: int = 28, min_h: float = 72.0) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(0, min_h)
	b.add_theme_font_size_override("font_size", size)
	return b


static func line_edit(placeholder: String, secret: bool = false) -> LineEdit:
	var e := LineEdit.new()
	e.placeholder_text = placeholder
	e.secret = secret
	e.custom_minimum_size = Vector2(0, 64)
	e.add_theme_font_size_override("font_size", 28)
	return e


static func circle_texture(diameter: int, color: Color) -> ImageTexture:
	var img := Image.create(diameter, diameter, false, Image.FORMAT_RGBA8)
	var c := (diameter - 1) / 2.0
	for y in diameter:
		for x in diameter:
			var inside := Vector2(x - c, y - c).length() <= diameter / 2.0 - 0.5
			img.set_pixel(x, y, color if inside else Color(0, 0, 0, 0))
	return ImageTexture.create_from_image(img)


## Thanh trượt to, dễ chạm.
static func style_slider(s: HSlider) -> void:
	s.custom_minimum_size = Vector2(0, 56)
	var knob := circle_texture(44, Color(1.0, 0.85, 0.3))
	s.add_theme_icon_override("grabber", knob)
	s.add_theme_icon_override("grabber_highlight", knob)
	s.add_theme_icon_override("grabber_disabled", knob)
	var track := StyleBoxFlat.new()
	track.bg_color = Color(0.3, 0.35, 0.5)
	track.content_margin_top = 8
	track.content_margin_bottom = 8
	track.set_corner_radius_all(6)
	s.add_theme_stylebox_override("slider", track)


static func panel_style(color: Color) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = color
	sb.set_content_margin_all(12)
	sb.set_corner_radius_all(10)
	return sb
