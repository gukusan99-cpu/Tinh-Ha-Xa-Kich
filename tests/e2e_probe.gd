extends SceneTree
# Thăm dò end-to-end: mở main.tscn, chờ welcome + pong từ máy chủ thật.

var _t := 0.0
var _sid := ""
var _ms := -1

func _initialize() -> void:
	var main = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)
	var net = root.get_node("Net")
	net.connected.connect(func(s): _sid = s; print("E2E connected ", s))
	net.latency_updated.connect(func(ms): _ms = ms; print("E2E pong ms=", ms))

func _process(delta: float) -> bool:
	_t += delta
	if _sid != "" and _ms >= 0:
		print("E2E PASS")
		quit(0)
	elif _t > 8.0:
		print("E2E FAIL sid=", _sid, " ms=", _ms)
		quit(1)
	return false
