extends RefCounted
## Kiểm thử các hàm thuần: Terrain, ClockSync, EntityTrack, ReplayPlan, UiText.


func test_terrain_from_rows() -> Array:
	var t := Terrain.from_rows(["...", ".#.", "###"])
	return _check([
		[t.width == 3 and t.height == 3, "kích thước"],
		[not t.is_solid(0, 0) and t.is_solid(1, 1) and t.is_solid(2, 2), "ô đất"],
		[not t.is_solid(-1, 0) and not t.is_solid(5, 5), "ngoài biên không đặc"],
		[t.to_rows() == ["...", ".#.", "###"], "to_rows round trip"],
	])


func test_terrain_remove_tiles() -> Array:
	var t := Terrain.from_rows(["###", "###"])
	var n := t.remove_tiles([[0.0, 0.0], [1, 1], [1, 1], [9, 9]])
	return _check([
		[n == 2, "chỉ đếm ô thực sự bị xoá (%d)" % n],
		[t.to_rows() == [".##", "#.#"], "kết quả sau xoá: %s" % str(t.to_rows())],
	])


func test_terrain_surface_row() -> Array:
	var t := Terrain.from_rows(["...", "...", ".#.", "###"])
	return _check([
		[t.surface_row(1, 0) == 2, "mặt đất cột 1"],
		[t.surface_row(0, 0) == 3, "mặt đất cột 0"],
		[t.surface_row(1, 3) == 3, "bắt đầu từ from_row"],
		[t.surface_row(7, 0) == -1, "ngoài biên"],
	])


func test_clock_offset() -> Array:
	var off := ClockSync.compute_offset(10000.0, 4000.0, 200.0)
	var off_unknown := ClockSync.compute_offset(10000.0, 4000.0, -1.0)
	return _check([
		[is_equal_approx(off, 6100.0), "offset có rtt: %f" % off],
		[is_equal_approx(off_unknown, 6000.0), "offset không rtt"],
	])


func test_clock_remaining() -> Array:
	ClockSync.offset_ms = 6000.0
	var r := ClockSync.remaining_seconds(15000.0, 4000.0)  # server now = 10000
	var past := ClockSync.remaining_seconds(15000.0, 20000.0)
	ClockSync.offset_ms = 0.0
	return _check([
		[is_equal_approx(r, 5.0), "còn 5 giây (%f)" % r],
		[past == 0.0, "không âm"],
	])


func test_entity_track() -> Array:
	var tr := EntityTrack.new(Vector2(0, 0), 0.0, 0.1)
	tr.push(Vector2(10, 0), 1.0)
	var mid := tr.sample(1.05)
	var end := tr.sample(5.0)
	var start := tr.sample(1.0)
	tr.push(Vector2(10, 10), 1.05)  # bắt đầu từ vị trí hiện tại
	var cont := tr.sample(1.05)
	return _check([
		[is_equal_approx(mid.x, 5.0), "giữa tick"],
		[end == Vector2(10, 0) and start == Vector2(0, 0), "đầu/cuối"],
		[cont.is_equal_approx(Vector2(5, 0)), "liên tục khi push"],
	])


func _sample_result() -> Dictionary:
	return {
		"turn": 1,
		"shots": [
			{"unitId": 1, "points": [[0, 0], [2, -2], [4, 0]], "impact": {"x": 4, "y": 0}, "hitUnitId": null, "crit": true, "flightSeconds": 1.0},
			{"unitId": 2, "points": [[10, 0], [9, 1]], "impact": {"x": 9, "y": 1}, "hitUnitId": 1, "crit": false, "flightSeconds": 0.5},
			{"unitId": 3, "points": [[0, 0], [-5, 0]], "impact": null, "hitUnitId": null, "crit": false, "flightSeconds": 0.7},
		],
		"explosions": [
			{"unitId": 2, "x": 9, "y": 1, "radius": 2, "removedTiles": [[9, 2]]},
			{"unitId": 1, "x": 4, "y": 0, "radius": 2, "removedTiles": []},
		],
		"damage": [{"unitId": 1, "sourceUnitId": 2, "amount": 20, "hpAfter": 80}],
		"falls": [{"unitId": 1, "y": 5}],
		"deaths": [],
	}


func test_replay_plan_order() -> Array:
	var p := ReplayPlan.build(_sample_result())
	var ev: Array = p["events"]
	return _check([
		[p["flights"].size() == 3, "3 viên đạn"],
		[ev.size() == 2, "2 vụ nổ"],
		[int(ev[0]["explosion"]["unitId"]) == 2 and is_equal_approx(ev[0]["t"], 0.5), "nổ sớm trước"],
		[int(ev[1]["explosion"]["unitId"]) == 1 and ev[1]["crit"] == true, "nổ muộn, chí mạng"],
		[ev[0]["damages"].size() == 1 and ev[1]["damages"].size() == 0, "gán sát thương theo nguồn"],
		[is_equal_approx(p["fall_time"], 1.0 + ReplayPlan.FALL_DELAY), "fall_time"],
		[p["duration"] > p["fall_time"], "duration"],
		[p["flights"][2]["hasImpact"] == false, "đạn bay ra ngoài không có điểm chạm"],
	])


func test_replay_plan_empty() -> Array:
	var p := ReplayPlan.build({"turn": 2, "shots": [], "explosions": [], "damage": [], "falls": [], "deaths": []})
	return _check([[p["events"].is_empty() and p["duration"] > 0.0, "lượt không ai bắn vẫn hợp lệ"]])


func test_replay_points() -> Array:
	var pts := [[0, 0], [2, -2], [4, 0]]
	var mid := ReplayPlan.point_at(pts, 0.5)
	var q := ReplayPlan.point_at(pts, 0.25)
	var up := ReplayPlan.points_upto(pts, 0.75)
	return _check([
		[mid == Vector2(2, -2), "giữa quỹ đạo"],
		[q == Vector2(1, -1), "nội suy 1/4"],
		[ReplayPlan.point_at(pts, 1.0) == Vector2(4, 0), "điểm cuối"],
		[up.size() == 3 and up[2] == Vector2(3, -1), "vệt đạn"],
		[ReplayPlan.point_at([], 0.5) == Vector2.ZERO, "rỗng"],
	])


func test_ui_text() -> Array:
	return _check([
		[UiText.auth_error("taken").contains("đã được sử dụng"), "taken"],
		[UiText.auth_error("bad_credentials").contains("Sai"), "bad_credentials"],
		[UiText.auth_error("invalid").contains("3-16"), "invalid"],
		[UiText.auth_error("zzz").contains("zzz"), "mã lạ"],
		[UiText.match_result("win") == "CHIẾN THẮNG", "win"],
	])


func test_game_data_fallback() -> Array:
	var b := GameData.load_balance()
	var s := GameData.load_signs()
	return _check([
		[b.has("aimAngleMinDegrees") and b.has("aimAngleMaxDegrees"), "có khoảng góc"],
		[s.size() == 4, "4 cung"],
	])


func _check(pairs: Array) -> Array:
	var errors := []
	for p in pairs:
		if not p[0]:
			errors.append(p[1])
	return errors


func test_map_info() -> Array:
	var mons := {"am_thach_gai": {"ten": "Gai"}, "am_thach_lon": {"ten": "Lon"}}
	return _check([
		[MapInfo.map_path("ban-do", "vung_san_1") == "res://data/ban-do/vung-san-1.json", "đường dẫn bản đồ"],
		[MapInfo.map_name("thanh") != "" and MapInfo.map_name("khong_co") == "khong_co", "tên bản đồ / rơi về id"],
		[MapInfo.monster_id_by_name(mons, "Lon") == "am_thach_lon" and MapInfo.monster_id_by_name(mons, "x") == "", "tìm quái theo tên"],
		[MapInfo.monster_style("am_thach_lon")["scale"] > MapInfo.monster_style("la")["scale"], "quái lớn to hơn mặc định"],
		[MapInfo.monster_style("am_thach_gai")["color"] != MapInfo.monster_style("am_thach_lon")["color"], "màu khác nhau"],
		[MapInfo.portal_is_locked(2, 1) and not MapInfo.portal_is_locked(2, 2) and not MapInfo.portal_is_locked(0, 1), "khóa cổng theo cấp"],
		[UiText.portal_locked(2) == "Cần đạt cấp 2 để vào", "toast cổng khóa"],
	])


func test_unit_monster_id() -> Array:
	var mons := {"am_thach_gai": {"ten": "Gai"}, "am_thach_lon": {"ten": "Lon"}}
	return _check([
		[MapInfo.unit_monster_id(mons, {"kind": "monster", "name": "Lon", "monsterId": "am_thach_gai"}) == "am_thach_gai", "monsterId của máy chủ được ưu tiên"],
		[MapInfo.unit_monster_id(mons, {"kind": "monster", "name": "Lon"}) == "am_thach_lon", "không có monsterId thì tra theo tên"],
		[MapInfo.unit_monster_id(mons, {"kind": "monster", "name": "x"}) == "", "tên lạ thì rỗng"],
		[MapInfo.unit_monster_id(mons, {"kind": "player", "name": "Lon"}) == "", "người chơi không phải quái"],
	])


func test_battle_map_id() -> Array:
	var mons := {
		"am_thach_gai": {"ten": "Gai", "battleMapId": "hem_van_thach_1"},
		"am_thach_lon": {"ten": "Lon", "battleMapId": "hem_van_thach_1"},
	}
	var gai := {"kind": "monster", "name": "Gai"}
	return _check([
		[MapInfo.battle_map_id({"battleMapId": "dau_truong_1", "units": [{"kind": "player", "name": "A"}]}, mons) == "dau_truong_1", "PvP: battleMapId của máy chủ"],
		[MapInfo.battle_map_id({"battleMapId": "dong_am_thach_1", "mapId": "vung_san_1"}, mons) == "dong_am_thach_1", "battleMapId ưu tiên hơn mapId"],
		[MapInfo.battle_map_id({"mapId": "vung_san_1", "units": [gai]}, mons) == "vung_san_1", "không có battleMapId thì rơi về mapId"],
		[MapInfo.battle_map_id({"units": [gai]}, mons) == "hem_van_thach_1", "thiếu cả hai: lấy battleMapId của quái"],
		[MapInfo.battle_map_id({"units": [{"kind": "monster", "monsterId": "am_thach_lon"}]}, mons) == "hem_van_thach_1", "quái có monsterId cũng dùng được"],
		[MapInfo.battle_map_id({"units": [{"kind": "monster", "name": "x"}]}, mons) == "", "không tìm thấy thì rỗng"],
		[MapInfo.map_name("dau_truong_1", true) == "Đấu Trường Tinh Tú", "tên bản đồ PvP từ data/tran"],
	])
