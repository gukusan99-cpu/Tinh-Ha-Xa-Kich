class_name UiText
extends RefCounted
## Chuỗi giao diện tiếng Việt.


static func auth_error(code: String) -> String:
	match code:
		"taken":
			return "Tên đăng nhập đã được sử dụng."
		"bad_credentials":
			return "Sai tên đăng nhập hoặc mật khẩu."
		"invalid":
			return "Tên đăng nhập 3-16 ký tự (chữ, số, _); mật khẩu 6-64 ký tự."
	return "Lỗi đăng nhập (%s)." % code


static func server_error(code: String, message: String) -> String:
	match code:
		"not_allowed":
			return "Thao tác không được phép lúc này."
		"bad_message":
			return "Dữ liệu gửi lên không hợp lệ."
	return "Lỗi máy chủ: %s" % (message if not message.is_empty() else code)


static func match_result(result: String) -> String:
	match result:
		"win":
			return "CHIẾN THẮNG"
		"lose":
			return "THẤT BẠI"
		"draw":
			return "HÒA"
	return result.to_upper()


static func phase_name(phase: String) -> String:
	match phase:
		"move":
			return "Di chuyển"
		"aim":
			return "Ngắm bắn"
	return phase


static func challenge_closed(reason: String) -> String:
	match reason:
		"accepted":
			return "Lời thách đấu đã được nhận."
		"declined":
			return "Lời thách đấu bị từ chối."
		"expired":
			return "Lời thách đấu đã hết hạn."
		"cancelled":
			return "Lời thách đấu đã bị hủy."
		"unavailable":
			return "Đối thủ không còn sẵn sàng."
	return "Lời thách đấu đã đóng."


static func pvp_record(pvp: Variant) -> String:
	if typeof(pvp) != TYPE_DICTIONARY:
		return ""
	return "PvP: %dT - %dB - %dH" % [int(pvp.get("wins", 0)), int(pvp.get("losses", 0)), int(pvp.get("draws", 0))]

static func pvp_result(result: String) -> String:
	match result:
		"win":
			return "Thắng"
		"lose":
			return "Thua"
		"draw":
			return "Hòa"
	return result


static func portal_locked(level_required: int) -> String:
	return "Cần đạt cấp %d để vào" % level_required


static func portal_lock_tag(level_required: int) -> String:
	return "Khóa - Cấp %d" % level_required

