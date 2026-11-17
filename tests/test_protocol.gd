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


func _check(pairs: Array) -> Array:
	var errors := []
	for p in pairs:
		if not p[0]:
			errors.append(p[1])
	return errors
