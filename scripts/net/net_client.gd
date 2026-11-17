extends Node
## Autoload "Net": kết nối WebSocket tới máy chủ. Chỉ hiển thị, không tính kết quả game.

signal connected(session_id: String)
signal disconnected
signal message_received(msg: Dictionary)
signal latency_updated(ms: int)

const CLIENT_VERSION := "0.0.1"
const PING_INTERVAL := 2.0
const CONNECT_TIMEOUT := 5.0
const DEFAULT_URL := "ws://localhost:8080"
const SETTING_URL := "tinh_ha/network/server_url"

var session_id := ""
var latency_ms := -1
var online := false

var _peer: WebSocketPeer
var _prev_state := WebSocketPeer.STATE_CLOSED
var _hello_sent := false
var _welcomed := false
var _ping_seq := 0
var _ping_timer := 0.0
var _connect_elapsed := 0.0
var _ping_sent_at := {}  # seq -> ticks_msec


func _ready() -> void:
	set_process(false)


func get_server_url() -> String:
	var url := String(ProjectSettings.get_setting(SETTING_URL, DEFAULT_URL))
	if url.is_empty() and OS.has_feature("web"):
		var host := String(JavaScriptBridge.eval("window.location.host"))
		var secure := String(JavaScriptBridge.eval("window.location.protocol")) == "https:"
		url = ("wss://" if secure else "ws://") + host
	elif url.is_empty():
		url = DEFAULT_URL
	return url


func connect_to_server() -> void:
	disconnect_from_server()
	_peer = WebSocketPeer.new()
	_peer.inbound_buffer_size = 1 << 20  # turn_result/world_state có thể lớn hơn 64 KB mặc định
	_peer.max_queued_packets = 4096
	var url := get_server_url()
	var err := _peer.connect_to_url(url)
	if err != OK:
		push_warning("Net: không thể kết nối tới %s (lỗi %d)" % [url, err])
		_peer = null
		disconnected.emit()
		return
	_prev_state = WebSocketPeer.STATE_CONNECTING
	_hello_sent = false
	_welcomed = false
	_ping_seq = 0
	_ping_timer = 0.0
	_connect_elapsed = 0.0
	_ping_sent_at.clear()
	set_process(true)


func disconnect_from_server() -> void:
	if _peer != null:
		_peer.close()
		_peer = null
	set_process(false)
	_reset_session()


func _reset_session() -> void:
	var was := online
	online = false
	session_id = ""
	latency_ms = -1
	if was:
		disconnected.emit()


func send_json(text: String) -> void:
	if _peer != null and _peer.get_ready_state() == WebSocketPeer.STATE_OPEN:
		_peer.send_text(text)


func _process(delta: float) -> void:
	if _peer == null:
		return
	_peer.poll()
	var state := _peer.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		if not _hello_sent:
			_hello_sent = true
			send_json(Protocol.build_hello(CLIENT_VERSION))
		while _peer.get_available_packet_count() > 0:
			var pkt := _peer.get_packet()
			if not _peer.was_string_packet():
				continue
			_handle_text(pkt.get_string_from_utf8())
		if _welcomed:
			_ping_timer += delta
			if _ping_timer >= PING_INTERVAL:
				_ping_timer = 0.0
				_send_ping()
	elif state == WebSocketPeer.STATE_CONNECTING:
		_connect_elapsed += delta
		if _connect_elapsed >= CONNECT_TIMEOUT:
			push_warning("Net: hết thời gian chờ kết nối")
			_peer.close()
			_peer = null
			set_process(false)
			disconnected.emit()
	elif state == WebSocketPeer.STATE_CLOSED:
		var code := _peer.get_close_code()
		print("Net: đã đóng kết nối (mã %d)" % code)
		_peer = null
		set_process(false)
		var was := online
		_reset_session()
		if not was:
			disconnected.emit()  # kết nối chưa từng thành công
	_prev_state = state


func _send_ping() -> void:
	var seq := _ping_seq
	_ping_seq += 1
	_ping_sent_at[seq] = Time.get_ticks_msec()
	send_json(Protocol.build_ping(seq))


func _handle_text(text: String) -> void:
	var msg := Protocol.parse_server(text)
	if msg.is_empty():
		push_warning("Net: bỏ qua thông điệp không hợp lệ")
		return
	match String(msg["type"]):
		"welcome":
			session_id = String(msg.get("sessionId", ""))
			online = true
			_welcomed = true
			connected.emit(session_id)
		"pong":
			var seq := int(msg.get("seq", -1))
			if _ping_sent_at.has(seq):
				latency_ms = Time.get_ticks_msec() - int(_ping_sent_at[seq])
				_ping_sent_at.erase(seq)
				latency_updated.emit(latency_ms)
		"error":
			push_warning("Net: máy chủ báo lỗi %s: %s" % [msg.get("code", "?"), msg.get("message", "")])
	message_received.emit(msg)
