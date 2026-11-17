class_name ClockSync
extends RefCounted
## Chênh lệch đồng hồ máy chủ - máy khách, chỉ để hiển thị đếm ngược.

static var offset_ms := 0.0  # serverTime ≈ local_ms + offset_ms


## server_time: mili giây Unix của máy chủ lúc gửi; rtt_ms < 0 nghĩa là chưa biết.
static func compute_offset(server_time: float, local_recv_ms: float, rtt_ms: float) -> float:
	var one_way := maxf(rtt_ms, 0.0) / 2.0
	return server_time + one_way - local_recv_ms


static func update(server_time: float, local_recv_ms: float, rtt_ms: float) -> void:
	offset_ms = compute_offset(server_time, local_recv_ms, rtt_ms)


static func server_now_ms(local_ms: float) -> float:
	return local_ms + offset_ms


## Số giây còn lại tới deadline (giờ máy chủ), không âm.
static func remaining_seconds(deadline_ms: float, local_ms: float) -> float:
	return maxf(0.0, (deadline_ms - server_now_ms(local_ms)) / 1000.0)
