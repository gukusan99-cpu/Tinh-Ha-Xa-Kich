class_name ReplayPlan
extends RefCounted
## Lập lịch phát lại turn_result (chỉ trình diễn dữ liệu máy chủ đã tính).
## Thời gian bay của mỗi viên lấy từ flightSeconds; điểm quỹ đạo phân bố đều theo thời gian.
##
## Thứ tự thời gian: hiệu ứng self (t=0) -> đạn bay (sau SELF_TIME nếu có self) -> nổ
## -> trạng thái/khiên hấp thụ -> đẩy lùi -> rơi -> cháy -> kết thúc.
## Viên con (parentIndex != null): burst bay cùng lúc với phát gốc; shower (sao băng)
## bắt đầu khi phát gốc chạm đất.

const MIN_FLIGHT := 0.05
const FALL_DELAY := 0.4
const TAIL := 1.0
const SELF_TIME := 0.8
const KNOCK_TIME := 0.35
const BURN_DELAY := 0.6
const BURN_STEP := 0.15
const BEAM_TIME := 0.3
const CHAIN_STEP := 0.2


## guns: id -> dữ liệu súng (để biết kind). unit_pos: id -> Vector2 (tâm đơn vị, chỉ để gán số sát thương
## cho đúng vụ nổ khi một người bắn có nhiều vụ nổ). Cả hai đều tuỳ chọn.
static func build(result: Dictionary, guns: Dictionary = {}, unit_pos: Dictionary = {}) -> Dictionary:
	var self_effects: Array = result.get("selfEffects", [])
	var base := SELF_TIME if not self_effects.is_empty() else 0.0
	var shots: Array = result.get("shots", [])

	var durs := []
	for s in shots:
		var dur := maxf(float((s as Dictionary).get("flightSeconds", 0.0)), MIN_FLIGHT)
		if (s as Dictionary).get("beam") != null:
			dur = BEAM_TIME
		durs.append(dur)
	var starts := []
	starts.resize(shots.size())
	for i in shots.size():
		_resolve_start(i, shots, durs, starts, guns, base, 0)

	var flights := []
	for i in shots.size():
		var shot: Dictionary = shots[i]
		flights.append({
			"unitId": int(shot["unitId"]), "points": shot.get("points", []), "duration": durs[i],
			"start": starts[i], "crit": bool(shot.get("crit", false)),
			"hasImpact": shot.get("impact") != null, "gunId": String(shot.get("gunId", "")),
			"isChild": shot.get("parentIndex") != null, "beam": shot.get("beam"),
		})
	var max_end := base
	for i in shots.size():
		max_end = maxf(max_end, starts[i] + durs[i])

	# Ghép mỗi vụ nổ với viên đạn gây ra nó (cùng người bắn, cùng điểm chạm).
	var used := {}
	var events := []
	var ex_list: Array = result.get("explosions", [])
	var idx := 0
	for e in ex_list:
		var ex: Dictionary = e
		var uid := int(ex["unitId"])
		var si := _match_shot(ex, uid, shots, used)
		var t := base
		var crit := false
		if si >= 0:
			used[si] = true
			t = starts[si] + durs[si]
			crit = bool(shots[si].get("crit", false))
		else:
			for j in shots.size():
				if int(shots[j]["unitId"]) == uid:
					t = maxf(t, starts[j] + durs[j])
		events.append({"t": t, "idx": idx, "explosion": ex, "crit": crit, "damages": []})
		idx += 1

	for dd in result.get("damage", []):
		var tgt := _pick_event(events, dd, unit_pos)
		if tgt >= 0:
			events[tgt]["damages"].append(dd)
	events.sort_custom(func(a, b): return a["t"] < b["t"] if a["t"] != b["t"] else a["idx"] < b["idx"])

	var last_t := max_end
	if not events.is_empty():
		last_t = maxf(base, float(events[events.size() - 1]["t"]))
	if shots.is_empty() and events.is_empty():
		last_t = base

	var extra := []
	for e in self_effects:
		extra.append({"t": 0.0, "kind": "self", "ev": e})
	for sa in result.get("shieldAbsorbed", []):
		var st := last_t
		for ev in events:
			var hit := false
			for d in ev["damages"]:
				if int(d["unitId"]) == int(sa["unitId"]):
					hit = true
			if hit:
				st = float(ev["t"])
				break
		extra.append({"t": st, "kind": "shield", "ev": sa})
	for se in result.get("statusEvents", []):
		extra.append({"t": last_t + 0.05, "kind": "status", "ev": se})
	var ci := 0
	for ch in result.get("chainHits", []):
		extra.append({"t": last_t + 0.05 + ci * CHAIN_STEP, "kind": "chain", "ev": ch})
		ci += 1
	var kbs: Array = result.get("knockbacks", [])
	for kb in kbs:
		extra.append({"t": last_t + 0.1, "kind": "knockback", "ev": kb})
	var fall_t := last_t + FALL_DELAY + (KNOCK_TIME if not kbs.is_empty() else 0.0)
	var end_t := fall_t
	var bi := 0
	for bt in result.get("burnTicks", []):
		var t2 := fall_t + BURN_DELAY + bi * BURN_STEP
		extra.append({"t": t2, "kind": "burn", "ev": bt})
		end_t = maxf(end_t, t2 + 0.5)
		bi += 1
	for pt in result.get("poisonTicks", []):
		var t3 := fall_t + BURN_DELAY + bi * BURN_STEP
		extra.append({"t": t3, "kind": "poison", "ev": pt})
		end_t = maxf(end_t, t3 + 0.5)
		bi += 1
	_stable_sort(extra)

	return {
		"turn": int(result.get("turn", 0)),
		"flights": flights,
		"events": events,
		"extra": extra,
		"falls": result.get("falls", []),
		"deaths": result.get("deaths", []),
		"zones": result.get("zones"),
		"units": result.get("units", []),
		"fall_time": fall_t,
		"duration": end_t + TAIL,
	}


static func _resolve_start(i: int, shots: Array, durs: Array, starts: Array, guns: Dictionary, base: float, depth: int) -> float:
	if starts[i] != null:
		return starts[i]
	var shot: Dictionary = shots[i]
	var pv: Variant = shot.get("parentIndex")
	var st := base
	if pv != null and depth < 8:
		var p := int(pv)
		if p >= 0 and p < shots.size() and p != i:
			var ps := _resolve_start(p, shots, durs, starts, guns, base, depth + 1)
			st = ps + (durs[p] if _is_shower_child(shot, shots[p], guns) else 0.0)
	starts[i] = st
	return st


static func _is_shower_child(child: Dictionary, parent: Dictionary, guns: Dictionary) -> bool:
	var gid := String(child.get("gunId", ""))
	if guns.has(gid):
		return String(guns[gid].get("kind", "")) == "shower"
	# Không có dữ liệu súng: sao băng không xuất phát cùng chỗ với phát gốc.
	var cp: Array = child.get("points", [])
	var pp: Array = parent.get("points", [])
	if cp.is_empty() or pp.is_empty():
		return false
	return Vector2(cp[0][0], cp[0][1]).distance_to(Vector2(pp[0][0], pp[0][1])) > 0.5


static func _match_shot(ex: Dictionary, uid: int, shots: Array, used: Dictionary) -> int:
	var best := -1
	var best_d := 0.1
	for i in shots.size():
		if used.has(i) or int(shots[i]["unitId"]) != uid:
			continue
		var imp: Variant = shots[i].get("impact")
		if imp == null:
			continue
		var d := Vector2(float(imp["x"]), float(imp["y"])).distance_to(Vector2(float(ex["x"]), float(ex["y"])))
		if d <= best_d:
			best = i
			best_d = d
	return best


## Chọn vụ nổ để hiển thị số sát thương: cùng nguồn; nếu có nhiều thì vụ gần đơn vị nhất.
static func _pick_event(events: Array, dd: Dictionary, unit_pos: Dictionary) -> int:
	var src := int(dd["sourceUnitId"])
	var cands := []
	for i in events.size():
		if int(events[i]["explosion"]["unitId"]) == src:
			cands.append(i)
	if cands.is_empty():
		return -1
	if cands.size() == 1:
		return cands[0]
	var uid := int(dd["unitId"])
	if unit_pos.has(uid):
		var p: Vector2 = unit_pos[uid]
		var best: int = cands[0]
		var bd := INF
		for i in cands:
			var ex: Dictionary = events[i]["explosion"]
			var d := p.distance_to(Vector2(float(ex["x"]), float(ex["y"])))
			if d < bd:
				bd = d
				best = i
		return best
	var last: int = cands[0]
	for i in cands:
		if events[i]["t"] >= events[last]["t"]:
			last = i
	return last


static func _stable_sort(arr: Array) -> void:
	for i in arr.size():
		arr[i]["_i"] = i
	arr.sort_custom(func(a, b): return a["t"] < b["t"] if a["t"] != b["t"] else a["_i"] < b["_i"])


## Vị trí trên quỹ đạo tại phần frac (0..1), nội suy tuyến tính giữa các điểm lấy mẫu.
static func point_at(points: Array, frac: float) -> Vector2:
	var n := points.size()
	if n == 0:
		return Vector2.ZERO
	if n == 1:
		return Vector2(points[0][0], points[0][1])
	var pos := clampf(frac, 0.0, 1.0) * (n - 1)
	var i := mini(int(floor(pos)), n - 2)
	var a := Vector2(points[i][0], points[i][1])
	var b := Vector2(points[i + 1][0], points[i + 1][1])
	return a.lerp(b, pos - i)


## Các điểm từ đầu quỹ đạo đến vị trí frac (để vẽ vệt đạn).
static func points_upto(points: Array, frac: float) -> PackedVector2Array:
	var out := PackedVector2Array()
	var n := points.size()
	if n == 0:
		return out
	var pos := clampf(frac, 0.0, 1.0) * (n - 1)
	var whole := mini(int(floor(pos)), n - 1)
	for i in whole + 1:
		out.append(Vector2(points[i][0], points[i][1]))
	var cur := point_at(points, frac)
	if out.is_empty() or out[out.size() - 1] != cur:
		out.append(cur)
	return out
