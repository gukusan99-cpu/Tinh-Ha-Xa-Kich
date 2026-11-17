class_name ReplayPlan
extends RefCounted
## Lập lịch phát lại turn_result (chỉ trình diễn dữ liệu máy chủ đã tính).
## Thời gian bay của mỗi viên lấy từ flightSeconds; điểm quỹ đạo phân bố đều theo thời gian.

const MIN_FLIGHT := 0.05
const FALL_DELAY := 0.4
const TAIL := 1.0


static func build(result: Dictionary) -> Dictionary:
	var flights := []
	var dur_by_unit := {}
	var crit_by_unit := {}
	var max_flight := 0.0
	for s in result.get("shots", []):
		var shot: Dictionary = s
		var uid := int(shot["unitId"])
		var d := maxf(float(shot.get("flightSeconds", 0.0)), MIN_FLIGHT)
		var crit := bool(shot.get("crit", false))
		flights.append({
			"unitId": uid, "points": shot.get("points", []), "duration": d,
			"crit": crit, "hasImpact": shot.get("impact") != null,
		})
		dur_by_unit[uid] = d
		crit_by_unit[uid] = crit
		max_flight = maxf(max_flight, d)

	var damages: Array = result.get("damage", [])
	var events := []
	var idx := 0
	for e in result.get("explosions", []):
		var ex: Dictionary = e
		var uid := int(ex["unitId"])
		var dmg := []
		for dd in damages:
			if int(dd["sourceUnitId"]) == uid:
				dmg.append(dd)
		events.append({
			"t": float(dur_by_unit.get(uid, 0.0)), "idx": idx, "explosion": ex,
			"crit": bool(crit_by_unit.get(uid, false)), "damages": dmg,
		})
		idx += 1
	events.sort_custom(func(a, b): return a["t"] < b["t"] if a["t"] != b["t"] else a["idx"] < b["idx"])

	var last_t := max_flight
	if not events.is_empty():
		last_t = float(events[events.size() - 1]["t"])
	var fall_t := last_t + FALL_DELAY
	return {
		"turn": int(result.get("turn", 0)),
		"flights": flights,
		"events": events,
		"falls": result.get("falls", []),
		"deaths": result.get("deaths", []),
		"fall_time": fall_t,
		"duration": fall_t + TAIL,
	}


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
