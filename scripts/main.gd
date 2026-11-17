extends Control
## Màn hình giữ chỗ: trạng thái kết nối. Chỉ hiển thị.

@onready var _status: Label = %StatusLabel
@onready var _session: Label = %SessionLabel
@onready var _ping: Label = %PingLabel
@onready var _button: Button = %ReconnectButton


func _ready() -> void:
	_button.pressed.connect(_connect)
	Net.connected.connect(_on_connected)
	Net.disconnected.connect(_on_disconnected)
	Net.latency_updated.connect(_on_latency)
	_connect()


func _connect() -> void:
	_status.text = "Đang kết nối"
	_session.text = "Phiên: -"
	_ping.text = "Ping: - ms"
	_button.disabled = true
	Net.connect_to_server()


func _on_connected(session_id: String) -> void:
	_status.text = "Đã kết nối"
	_session.text = "Phiên: " + session_id
	_button.disabled = true


func _on_disconnected() -> void:
	_status.text = "Mất kết nối"
	_session.text = "Phiên: -"
	_ping.text = "Ping: - ms"
	_button.disabled = false


func _on_latency(ms: int) -> void:
	_ping.text = "Ping: %d ms" % ms
