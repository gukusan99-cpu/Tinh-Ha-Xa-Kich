extends SceneTree
## Chạy: godot --headless --path . --script res://tests/run_tests.gd

const SUITES := [
	"res://tests/test_protocol.gd",
	"res://tests/test_helpers.gd",
]


func _init() -> void:
	var failed := 0
	var total := 0
	for path in SUITES:
		var suite: Object = load(path).new()
		for m in suite.get_method_list():
			var name: String = m["name"]
			if not name.begins_with("test_"):
				continue
			total += 1
			var errors: Array = suite.call(name)
			if errors.is_empty():
				print("PASS ", path.get_file(), "::", name)
			else:
				failed += 1
				print("FAIL ", path.get_file(), "::", name, " -> ", errors)
	print("%d/%d đạt" % [total - failed, total])
	quit(1 if failed > 0 else 0)
