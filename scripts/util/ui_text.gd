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
