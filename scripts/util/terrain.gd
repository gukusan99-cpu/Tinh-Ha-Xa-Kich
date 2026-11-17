class_name Terrain
extends RefCounted
## Mô hình địa hình để HIỂN THỊ. Chỉ áp dụng removedTiles từ máy chủ, không tự tính phá huỷ.

var width := 0
var height := 0
var _solid := PackedByteArray()


static func from_rows(rows: Array, w: int = -1, h: int = -1) -> Terrain:
	var t := Terrain.new()
	t.height = h if h > 0 else rows.size()
	var maxw := 0
	for r in rows:
		maxw = maxi(maxw, String(r).length())
	t.width = w if w > 0 else maxw
	t._solid.resize(t.width * t.height)
	t._solid.fill(0)
	for r in mini(rows.size(), t.height):
		var line := String(rows[r])
		for c in mini(line.length(), t.width):
			if line[c] == "#":
				t._solid[r * t.width + c] = 1
	return t


func in_bounds(c: int, r: int) -> bool:
	return c >= 0 and c < width and r >= 0 and r < height


func is_solid(c: int, r: int) -> bool:
	return in_bounds(c, r) and _solid[r * width + c] == 1


## Xoá các ô [col, row]; trả về số ô thực sự bị xoá.
func remove_tiles(tiles: Array) -> int:
	var n := 0
	for t in tiles:
		var c := int(t[0])
		var r := int(t[1])
		if is_solid(c, r):
			_solid[r * width + c] = 0
			n += 1
	return n


## Hàng đất đầu tiên từ from_row trở xuống ở cột col; -1 nếu không có. Chỉ dùng để vẽ hoạt ảnh.
func surface_row(col: int, from_row: int) -> int:
	for r in range(maxi(from_row, 0), height):
		if is_solid(col, r):
			return r
	return -1


func to_rows() -> Array:
	var out := []
	for r in height:
		var s := ""
		for c in width:
			s += "#" if _solid[r * width + c] == 1 else "."
		out.append(s)
	return out
