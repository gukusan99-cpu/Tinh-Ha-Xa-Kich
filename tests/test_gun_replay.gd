extends RefCounted
## Kiểm thử GunInfo và ReplayPlan với súng phụ (burst, shower, self, khiên, đẩy lùi, cháy).


func _guns() -> Dictionary:
	return {
		"a": {"id": "a", "ten": "Súng A", "kind": "projectile", "energyCost": 0},
		"b": {"id": "b", "ten": "Súng B", "kind": "projectile", "energyCost": 3},
		"burst": {"id": "burst", "ten": "Liên", "kind": "burst", "energyCost": 0},
		"rain": {"id": "rain", "ten": "Mưa", "kind": "shower", "energyCost": 3},
	}


func test_gun_availability() -> Array:
	var g := _guns()
	return _check([
		[GunInfo.availability(g["a"], 0, {})["ok"], "súng 0 nội lực luôn dùng được"],
		[not GunInfo.availability(g["b"], 2, {})["ok"] and GunInfo.availability(g["b"], 2, {})["reason"] == "energy", "thiếu nội lực"],
		[GunInfo.availability(g["b"], 3, {})["ok"], "đủ nội lực"],
		[not GunInfo.availability(g["a"], 9, {"a": 2})["ok"] and GunInfo.availability(g["a"], 9, {"a": 2})["cooldown"] == 2, "đang hồi"],
		[GunInfo.availability(g["a"], 9, {"a": 0})["ok"], "hồi 0 lượt thì dùng được"],
		[GunInfo.first_available(["b", "a"], g, 1, {}) == "a", "chọn súng dùng được đầu tiên"],
		[GunInfo.first_available(["b"], g, 1, {}) == "", "không súng nào dùng được"],
		[GunInfo.gun_button_text(g["b"], 5, {"b": 1}).contains("Hồi: 1"), "nhãn có hồi chiêu"],
		[GunInfo.gun_button_text(g["b"], 5, {}).contains("Nội lực: 3"), "nhãn có nội lực"],
	])


func test_status_helpers() -> Array:
	var sts := [{"type": "burn", "turns": 2, "damagePerTurn": 8}, {"type": "shield", "turns": 1, "amount": 40}]
	var put := GunInfo.put_status(sts, {"type": "shield", "turns": 1, "amount": 12})
	return _check([
		[GunInfo.status_text(sts[0]) == "Cháy", "Cháy"],
		[GunInfo.status_text(sts[1]) == "Khiên 40", "Khiên có số"],
		[GunInfo.status_text({"type": "trueAim"}) == "Ngắm chuẩn", "Ngắm chuẩn"],
		[GunInfo.status_text({"type": "slow"}) == "Chậm" and GunInfo.status_text({"type": "stun"}) == "Choáng", "Chậm/Choáng"],
		[GunInfo.has_status(sts, "burn") and not GunInfo.has_status(sts, "stun"), "has_status"],
		[put.size() == 2 and GunInfo.status_text(put[1]) == "Khiên 12", "put_status thay cùng loại"],
	])


func test_apply_unit_state() -> Array:
	var u := {"hp": 100, "energy": 3, "cooldowns": {}, "statuses": [], "guns": ["a"]}
	GunInfo.apply_unit_state(u, {"id": 1, "hp": 80, "energy": 5, "cooldowns": {"a": 1}, "statuses": [{"type": "stun", "turns": 1}]})
	var v := {"hp": 50, "guns": ["x"]}
	GunInfo.apply_unit_state(v, {"id": 2, "energy": 7})
	return _check([
		[u["hp"] == 80 and u["energy"] == 5, "hp/energy cập nhật"],
		[u["cooldowns"]["a"] == 1 and u["statuses"].size() == 1, "cooldowns/statuses cập nhật"],
		[u["guns"] == ["a"], "guns giữ nguyên khi không có"],
		[v["hp"] == 50 and v["energy"] == 7, "trường vắng mặt không bị ghi đè"],
	])


func test_preview_throttle() -> Array:
	return _check([
		[GunInfo.preview_due(1000.0, -1.0, 5.0), "lần đầu được gửi"],
		[not GunInfo.preview_due(1100.0, 1000.0, 5.0), "100ms < 200ms"],
		[GunInfo.preview_due(1200.0, 1000.0, 5.0), "đủ 200ms"],
	])


func test_sign_summary() -> Array:
	var s := {"id": "kim_nguu", "gunIds": ["a", "b", "zzz"], "passive": {"type": "toughness", "damageTakenReduction": 0.15}}
	var t := GunInfo.sign_summary(s, _guns())
	var real := GameData.load_signs()
	var guns := GameData.load_guns()
	var all_have := true
	for sg in real:
		if GunInfo.sign_summary(sg, guns).is_empty():
			all_have = false
	return _check([
		[t.contains("Súng A") and t.contains("Súng B") and t.contains("zzz"), "tên súng (id lạ giữ nguyên)"],
		[t.contains("15%"), "nội tại có phần trăm"],
		[all_have, "mọi cung trong data đều có mô tả"],
		[guns.has("sung_kinh"), "đọc được sung.json"],
	])


func _shot(uid: int, gid: String, parent: Variant, pts: Array, dur: float, impact: Variant) -> Dictionary:
	return {"unitId": uid, "gunId": gid, "parentIndex": parent, "points": pts, "impact": impact,
		"hitUnitId": null, "crit": false, "flightSeconds": dur}


func test_replay_burst_children_fly_together() -> Array:
	var r := {
		"turn": 1, "selfEffects": [],
		"shots": [
			_shot(1, "burst", null, [[0, 0], [5, 0]], 1.0, {"x": 5, "y": 0}),
			_shot(1, "burst", 0, [[0, 0], [6, 0]], 1.2, {"x": 6, "y": 0}),
			_shot(1, "burst", 0, [[0, 0], [4, 0]], 0.8, {"x": 4, "y": 0}),
		],
		"explosions": [
			{"unitId": 1, "x": 4, "y": 0, "radius": 1, "removedTiles": []},
			{"unitId": 1, "x": 5, "y": 0, "radius": 1, "removedTiles": []},
			{"unitId": 1, "x": 6, "y": 0, "radius": 1, "removedTiles": []},
		],
		"damage": [], "falls": [], "deaths": [],
	}
	var p := ReplayPlan.build(r, _guns())
	var f: Array = p["flights"]
	var ev: Array = p["events"]
	return _check([
		[f[0]["start"] == 0.0 and f[1]["start"] == 0.0 and f[2]["start"] == 0.0, "burst cùng xuất phát"],
		[f[1]["isChild"] and not f[0]["isChild"], "đánh dấu viên con"],
		[is_equal_approx(ev[0]["t"], 0.8) and is_equal_approx(ev[1]["t"], 1.0) and is_equal_approx(ev[2]["t"], 1.2), "nổ ghép đúng viên theo điểm chạm"],
		[is_equal_approx(p["fall_time"], 1.2 + ReplayPlan.FALL_DELAY), "rơi sau vụ nổ cuối"],
	])


func test_replay_shower_after_parent_and_self_first() -> Array:
	var r := {
		"turn": 2,
		"selfEffects": [{"unitId": 1, "sourceUnitId": 1, "status": {"type": "shield", "turns": 2, "amount": 40}}],
		"shots": [
			_shot(1, "rain", null, [[0, 5], [8, 5]], 1.0, {"x": 8, "y": 5}),
			_shot(1, "rain", 0, [[7, 0], [7, 5]], 0.5, {"x": 7, "y": 5}),
			_shot(1, "rain", 0, [[9, 0], [9, 5]], 0.5, {"x": 9, "y": 5}),
		],
		"explosions": [
			{"unitId": 1, "x": 8, "y": 5, "radius": 1, "removedTiles": []},
			{"unitId": 1, "x": 7, "y": 5, "radius": 1, "removedTiles": []},
			{"unitId": 1, "x": 9, "y": 5, "radius": 1, "removedTiles": []},
		],
		"damage": [{"unitId": 2, "sourceUnitId": 1, "amount": 10, "hpAfter": 90}],
		"shieldAbsorbed": [{"unitId": 2, "amount": 12}],
		"statusEvents": [{"unitId": 2, "sourceUnitId": 1, "status": {"type": "slow", "turns": 1, "tiles": 2}}],
		"knockbacks": [{"unitId": 2, "fromCol": 9, "toCol": 10}],
		"burnTicks": [{"unitId": 2, "sourceUnitId": 1, "amount": 8, "hpAfter": 82}],
		"falls": [], "deaths": [], "units": [{"id": 2, "hp": 82}],
	}
	var base := ReplayPlan.SELF_TIME
	var p := ReplayPlan.build(r, _guns(), {2: Vector2(9, 5)})
	var f: Array = p["flights"]
	var ex: Array = p["extra"]
	var kinds := []
	for x in ex:
		kinds.append(x["kind"])
	var last_t: float = p["events"][p["events"].size() - 1]["t"]
	var order_ok := true
	for i in ex.size() - 1:
		if ex[i]["t"] > ex[i + 1]["t"]:
			order_ok = false
	var burn_t := 0.0
	var kb_t := 0.0
	for x in ex:
		if x["kind"] == "burn":
			burn_t = x["t"]
		if x["kind"] == "knockback":
			kb_t = x["t"]
	return _check([
		[kinds[0] == "self" and is_equal_approx(ex[0]["t"], 0.0), "hiệu ứng self đầu tiên, t=0"],
		[is_equal_approx(f[0]["start"], base), "phát gốc chờ self xong"],
		[is_equal_approx(f[1]["start"], base + 1.0) and is_equal_approx(f[2]["start"], base + 1.0), "sao băng bắt đầu khi phát gốc chạm"],
		[is_equal_approx(last_t, base + 1.5), "vụ nổ cuối của sao băng"],
		[order_ok, "extra theo thứ tự thời gian"],
		[kinds.has("shield") and kinds.has("status") and kinds.has("knockback") and kinds.has("burn"), "đủ loại extra"],
		[kb_t > last_t, "đẩy lùi sau vụ nổ"],
		[p["fall_time"] > kb_t, "rơi sau đẩy lùi"],
		[burn_t > p["fall_time"], "cháy sau khi rơi"],
		[p["duration"] > burn_t, "duration bao trùm cháy"],
		[p["events"][2]["damages"].size() == 1, "số sát thương gán vụ nổ gần đơn vị nhất (x=9)"],
		[p["units"].size() == 1, "giữ snapshot units"],
	])


func _check(pairs: Array) -> Array:
	var errors := []
	for p in pairs:
		if not p[0]:
			errors.append(p[1])
	return errors
