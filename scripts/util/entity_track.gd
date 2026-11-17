class_name EntityTrack
extends RefCounted
## Nội suy vị trí thực thể giữa hai world_tick. Chỉ hiển thị.

var prev := Vector2.ZERO
var target := Vector2.ZERO
var t0 := 0.0
var duration := 0.1


func _init(p: Vector2 = Vector2.ZERO, now: float = 0.0, dur: float = 0.1) -> void:
	prev = p
	target = p
	t0 = now
	duration = maxf(dur, 0.001)


func sample(now: float) -> Vector2:
	var f := clampf((now - t0) / duration, 0.0, 1.0)
	return prev.lerp(target, f)


## Nhận vị trí mới; bắt đầu nội suy từ vị trí đang hiển thị để không giật.
func push(p: Vector2, now: float) -> void:
	prev = sample(now)
	target = p
	t0 = now
