extends RefCounted
## Các ca kiểm thử cho Protocol. Mỗi hàm test_* trả về mảng lỗi (rỗng = đạt).


func test_build_hello() -> Array:
	var d: Dictionary = JSON.parse_string(Protocol.build_hello("1.2.3"))
	return _check([
		[int(d["v"]) == 1, "v phải là 1"],
		[d["type"] == "hello", "type phải là hello"],
		[d["clientVersion"] == "1.2.3", "clientVersion sai"],
	])


func test_build_ping() -> Array:
	var d: Dictionary = JSON.parse_string(Protocol.build_ping(7))
	return _check([
		[d["type"] == "ping", "type phải là ping"],
		[int(d["seq"]) == 7, "seq sai"],
		[int(d["v"]) == 1, "v phải là 1"],
	])


func test_parse_valid() -> Array:
	var d := Protocol.parse('{"v":1,"type":"pong","seq":3,"serverTime":123}')
	return _check([
		[d.get("type") == "pong", "phải đọc được type"],
		[int(d.get("seq", -1)) == 3, "seq sai"],
	])


func test_parse_roundtrip() -> Array:
	var d := Protocol.parse(Protocol.build_ping(5))
	return _check([[int(d.get("seq", -1)) == 5, "round trip seq"]])


func test_parse_invalid() -> Array:
	var bad := [
		"", "not json", "[1,2]", "42", "{}",
		'{"v":1}', '{"type":"x"}', '{"v":2,"type":"x"}',
		'{"v":"1","type":"x"}', '{"v":1,"type":5}', '{"v":1,"type":""}',
	]
	var checks := []
	for s in bad:
		checks.append([Protocol.parse(s).is_empty(), "phải bị từ chối: '%s'" % s])
	return _check(checks)


func test_parse_too_large() -> Array:
	var big := '{"v":1,"type":"x","pad":"' + "a".repeat(5000) + '"}'
	return _check([[Protocol.parse(big).is_empty(), "quá 4KB phải bị từ chối"]])


func test_parse_server_allows_large() -> Array:
	var big := '{"v":1,"type":"world_state","pad":"' + "a".repeat(9000) + '"}'
	return _check([
		[Protocol.parse_server(big).get("type") == "world_state", "S→C lớn phải được chấp nhận"],
		[Protocol.parse_server("{}").is_empty(), "parse_server vẫn kiểm tra v/type"],
	])


func test_build_register_login() -> Array:
	var r: Dictionary = JSON.parse_string(Protocol.build_register("alice", "secret1"))
	var l: Dictionary = JSON.parse_string(Protocol.build_login("alice", "secret1"))
	return _check([
		[r["type"] == "register" and l["type"] == "login", "type sai"],
		[r["username"] == "alice" and r["password"] == "secret1", "register trường sai"],
		[l["username"] == "alice" and l["password"] == "secret1", "login trường sai"],
		[int(r["v"]) == 1 and int(l["v"]) == 1, "v phải là 1"],
	])


func test_build_create_character() -> Array:
	var d: Dictionary = JSON.parse_string(Protocol.build_create_character("  Linh ", "xu_nu"))
	return _check([
		[d["type"] == "create_character", "type sai"],
		[d["name"] == "Linh", "tên phải được trim"],
		[d["sign"] == "xu_nu", "sign sai"],
	])


func test_build_enter_world() -> Array:
	var d: Dictionary = JSON.parse_string(Protocol.build_enter_world())
	return _check([[d["type"] == "enter_world", "type sai"], [int(d["v"]) == 1, "v sai"], [d.size() == 2, "không có trường thừa"]])


func test_build_move_to() -> Array:
	var d: Dictionary = JSON.parse_string(Protocol.build_move_to(3.5, 7.25))
	return _check([
		[d["type"] == "move_to", "type sai"],
		[is_equal_approx(float(d["x"]), 3.5) and is_equal_approx(float(d["y"]), 7.25), "toạ độ sai"],
	])


func test_build_battle_move() -> Array:
	var d: Dictionary = JSON.parse_string(Protocol.build_battle_move(12))
	return _check([[d["type"] == "battle_move", "type sai"], [int(d["col"]) == 12, "col sai"]])


func test_build_battle_shot() -> Array:
	var d: Dictionary = JSON.parse_string(Protocol.build_battle_shot(45.0, 60.0, -1))
	var hi: Dictionary = JSON.parse_string(Protocol.build_battle_shot(10.0, 250.0, 5))
	var lo: Dictionary = JSON.parse_string(Protocol.build_battle_shot(10.0, -3.0, 0))
	return _check([
		[d["type"] == "battle_shot", "type sai"],
		[is_equal_approx(float(d["angle"]), 45.0) and is_equal_approx(float(d["power"]), 60.0), "angle/power sai"],
		[int(d["facing"]) == -1, "facing -1"],
		[is_equal_approx(float(hi["power"]), 100.0) and int(hi["facing"]) == 1, "power kẹp 100, facing chuẩn hoá +1"],
		[is_equal_approx(float(lo["power"]), 0.0), "power kẹp 0"],
	])


func test_client_messages_under_limit() -> Array:
	var ok := true
	for s in [Protocol.build_register("a".repeat(16), "p".repeat(64)), Protocol.build_battle_shot(45.123456, 99.5, 1)]:
		ok = ok and s.to_utf8_buffer().size() <= Protocol.MAX_MESSAGE_BYTES
	return _check([[ok, "thông điệp C→S phải ≤ 4 KB"]])


func _check(pairs: Array) -> Array:
	var errors := []
	for p in pairs:
		if not p[0]:
			errors.append(p[1])
	return errors
