"""Small dependency-free WebSocket JSON relay used by the local gateway."""

from __future__ import annotations

import base64
import hashlib
import json
import queue
import socket
import socketserver
import struct
import threading
from typing import Any


PROJECT_ID = "smartlife-junior-context"
PROTOCOL_TOPIC_PREFIX = "smartlife/junior/context/n16r8"
PROTOCOL_TYPES = {"hello", "telemetry", "health", "ack", "command", "ping"}
_WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def is_protocol_frame(frame: Any) -> bool:
    return (
        isinstance(frame, dict)
        and frame.get("type") in PROTOCOL_TYPES
        and frame.get("project") == PROJECT_ID
    )


def topic_for_frame(frame: dict[str, Any]) -> str:
    return f"{PROTOCOL_TOPIC_PREFIX}/{frame.get('type', 'unknown')}"


def _read_exact(stream: socket.socket, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        chunk = stream.recv(remaining)
        if not chunk:
            raise ConnectionError("websocket peer disconnected")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


class WebSocketPeer:
    def __init__(self, stream: socket.socket):
        self.stream = stream
        self._send_lock = threading.Lock()
        self._closed = False

    @classmethod
    def accept(cls, stream: socket.socket) -> "WebSocketPeer":
        request = bytearray()
        while b"\r\n\r\n" not in request:
            chunk = stream.recv(4096)
            if not chunk:
                raise ConnectionError("incomplete websocket handshake")
            request.extend(chunk)
            if len(request) > 16384:
                raise ValueError("websocket handshake too large")

        header_text = bytes(request).split(b"\r\n\r\n", 1)[0].decode("latin-1")
        lines = header_text.split("\r\n")
        if not lines or "HTTP/1.1" not in lines[0]:
            raise ValueError("invalid websocket request")
        headers: dict[str, str] = {}
        for line in lines[1:]:
            if ":" in line:
                name, value = line.split(":", 1)
                headers[name.strip().lower()] = value.strip()

        key = headers.get("sec-websocket-key")
        if not key or headers.get("upgrade", "").lower() != "websocket":
            raise ValueError("missing websocket upgrade headers")
        accept_key = base64.b64encode(hashlib.sha1((key + _WEBSOCKET_GUID).encode()).digest()).decode()
        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept_key}\r\n\r\n"
        )
        stream.sendall(response.encode("ascii"))
        return cls(stream)

    def _send_frame(self, opcode: int, payload: bytes = b"") -> None:
        if self._closed:
            raise ConnectionError("websocket peer is closed")
        size = len(payload)
        if size < 126:
            header = struct.pack("!BB", 0x80 | opcode, size)
        elif size <= 0xFFFF:
            header = struct.pack("!BBH", 0x80 | opcode, 126, size)
        else:
            header = struct.pack("!BBQ", 0x80 | opcode, 127, size)
        with self._send_lock:
            self.stream.sendall(header + payload)

    def send_text(self, text: str) -> None:
        self._send_frame(0x1, text.encode("utf-8"))

    def recv_text(self) -> str | None:
        while not self._closed:
            first, second = _read_exact(self.stream, 2)
            opcode = first & 0x0F
            masked = bool(second & 0x80)
            size = second & 0x7F
            if size == 126:
                size = struct.unpack("!H", _read_exact(self.stream, 2))[0]
            elif size == 127:
                size = struct.unpack("!Q", _read_exact(self.stream, 8))[0]
            if size > 1_000_000:
                raise ValueError("websocket frame too large")
            mask = _read_exact(self.stream, 4) if masked else b""
            payload = _read_exact(self.stream, size)
            if masked:
                payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))

            if opcode == 0x8:
                self.close()
                return None
            if opcode == 0x9:
                self._send_frame(0xA, payload)
                continue
            if opcode == 0xA:
                continue
            if opcode != 0x1:
                continue
            return payload.decode("utf-8")
        return None

    def close(self) -> None:
        if self._closed:
            return
        try:
            self._send_frame(0x8)
        except (ConnectionError, OSError):
            pass
        self._closed = True
        try:
            self.stream.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.stream.close()


class _ThreadingServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class JsonRelayServer:
    """Accept browser WebSockets and expose incoming JSON frames through a queue."""

    def __init__(self, host: str, port: int, *, broadcast_incoming: bool = False):
        self.host = host
        self.port = port
        self.broadcast_incoming = broadcast_incoming
        self.incoming: queue.Queue[dict[str, Any]] = queue.Queue()
        self._peers: set[WebSocketPeer] = set()
        self._peers_lock = threading.Lock()
        self._retained: dict[str, dict[str, Any]] = {}
        outer = self

        class Handler(socketserver.BaseRequestHandler):
            def handle(self) -> None:
                peer: WebSocketPeer | None = None
                try:
                    peer = WebSocketPeer.accept(self.request)
                    outer._add_peer(peer)
                    while True:
                        text = peer.recv_text()
                        if text is None:
                            break
                        try:
                            frame = json.loads(text)
                        except json.JSONDecodeError:
                            continue
                        if not is_protocol_frame(frame):
                            continue
                        outer.incoming.put(frame)
                        if outer.broadcast_incoming:
                            outer.broadcast_json(frame)
                except (ConnectionError, OSError, UnicodeDecodeError, ValueError):
                    pass
                finally:
                    if peer is not None:
                        outer._remove_peer(peer)

        self._server = _ThreadingServer((host, port), Handler)
        self.port = int(self._server.server_address[1])
        self._thread = threading.Thread(target=self._server.serve_forever, name="ws-json-relay", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def _add_peer(self, peer: WebSocketPeer) -> None:
        with self._peers_lock:
            self._peers.add(peer)
            retained = list(self._retained.values())
        for frame in retained:
            peer.send_text(json.dumps(frame, ensure_ascii=False, separators=(",", ":")))

    def _remove_peer(self, peer: WebSocketPeer) -> None:
        with self._peers_lock:
            self._peers.discard(peer)
        peer.close()

    def broadcast_json(self, frame: dict[str, Any], *, retain: bool = False) -> None:
        if not is_protocol_frame(frame):
            raise ValueError("frame does not match the project protocol")
        if retain:
            with self._peers_lock:
                self._retained[frame["type"]] = frame.copy()
        encoded = json.dumps(frame, ensure_ascii=False, separators=(",", ":"))
        with self._peers_lock:
            peers = list(self._peers)
        for peer in peers:
            try:
                peer.send_text(encoded)
            except (ConnectionError, OSError):
                self._remove_peer(peer)

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        with self._peers_lock:
            peers = list(self._peers)
            self._peers.clear()
        for peer in peers:
            peer.close()
        if self._thread.is_alive():
            self._thread.join(timeout=1)
