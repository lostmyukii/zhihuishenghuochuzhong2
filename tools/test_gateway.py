import base64
import json
import os
import socket
import struct
import subprocess
import sys
import time
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class GatewayContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import sys

        sys.path.insert(0, str(ROOT / "tools"))
        global gateway
        global ws_json
        import n16r8_gateway as gateway
        import ws_json

    def test_mock_hello_freezes_project_identity_and_gpio(self):
        state = gateway.MockBoardState()
        hello = state.hello()

        self.assertEqual(hello["type"], "hello")
        self.assertEqual(hello["project"], "smartlife-junior-context")
        self.assertEqual(hello["profileId"], "smartlife-junior-context-detective-v1")
        self.assertEqual(hello["board"], "n16r8_esp32s3")
        self.assertTrue(hello["mock"])
        self.assertEqual(hello["source"], "mock-board")
        self.assertFalse(hello["rfid"])
        self.assertEqual(
            hello["pins"],
            {
                "light": 1,
                "sound": 4,
                "dht": 14,
                "pir": 5,
                "keypad": 10,
                "mq2": 2,
                "water": 8,
                "flame": 45,
                "buzzer": 13,
                "fan": 11,
                "servo": 9,
                "relay": 12,
                "rgb": 46,
            },
        )
        self.assertEqual(
            hello["capabilities"]["modes"],
            ["detect", "study", "rest", "ventilation", "energy", "custom"],
        )
        self.assertEqual(hello["capabilities"]["mockScenarios"], ["normal", "mq2", "water", "flame"])
        self.assertFalse(hello["features"]["localVoiceNlu"])
        self.assertFalse(hello["features"]["mcp"])
        self.assertTrue(hello["features"]["safetyReasoning"])
        self.assertTrue(hello["features"]["actuatorPlanning"])
        self.assertFalse(hello["features"]["physicalActuators"])
        self.assertEqual(hello["health"]["actuatorApplyState"], "simulated")
        self.assertFalse(hello["health"]["hardwareVerified"])

    def test_each_mode_produces_a_complete_context_explanation(self):
        state = gateway.MockBoardState()

        for mode in gateway.MODES:
            with self.subTest(mode=mode):
                ack = state.apply_command({"type": "command", "id": f"mode-{mode}", "mode": mode})
                telemetry = state.telemetry()

                self.assertTrue(ack["ok"])
                self.assertEqual(ack["id"], f"mode-{mode}")
                self.assertEqual(telemetry["mode"], mode)
                self.assertEqual(telemetry["context"]["candidate"], mode)
                self.assertIn(telemetry["context"]["status"], {"matched", "uncertain"})
                self.assertGreaterEqual(telemetry["context"]["coverage"], 0)
                self.assertLessEqual(telemetry["context"]["coverage"], 100)
                self.assertGreaterEqual(telemetry["context"]["match"], 0)
                self.assertLessEqual(telemetry["context"]["match"], 100)
                self.assertIsInstance(telemetry["context"]["supporting"], list)
                self.assertIsInstance(telemetry["context"]["opposing"], list)
                self.assertIsInstance(telemetry["context"]["missing"], list)
                self.assertEqual(
                    set(telemetry["sensors"]),
                    {"light", "sound", "temperature", "humidity", "pir", "keypad", "mq2", "water", "flame"},
                )
                self.assertEqual(
                    set(telemetry["actuatorTargets"]),
                    {"fanPercent", "servoPosition", "relayOn", "buzzerMode", "rgbState"},
                )
                self.assertEqual(
                    set(telemetry["actuators"]),
                    {"fanPercent", "servoAngle", "relayOn", "buzzerOn", "rgbState"},
                )
                self.assertTrue(telemetry["mock"])
                self.assertEqual(telemetry["source"], "mock-board")
                self.assertEqual(telemetry["health"]["actuatorApplyState"], "simulated")

    def test_safety_scenarios_override_only_with_named_causes(self):
        state = gateway.MockBoardState()

        expectations = {
            "mq2": {
                "target": {"fanPercent": 100, "servoPosition": "ventilation-open", "relayOn": False, "buzzerMode": "alarm", "rgbState": "red"},
                "actual": {"fanPercent": 100, "servoAngle": 100, "relayOn": False, "buzzerOn": True, "rgbState": "red"},
            },
            "water": {
                "target": {"fanPercent": 0, "servoPosition": "hold", "relayOn": False, "buzzerMode": "intermittent", "rgbState": "blue-red"},
                "actual": {"fanPercent": 0, "servoAngle": 0, "relayOn": False, "buzzerOn": True, "rgbState": "blue-red"},
            },
            "flame": {
                "target": {"fanPercent": 0, "servoPosition": "safety-closed", "relayOn": False, "buzzerMode": "alarm", "rgbState": "red"},
                "actual": {"fanPercent": 0, "servoAngle": 0, "relayOn": False, "buzzerOn": True, "rgbState": "red"},
            },
        }
        for scenario, expected in expectations.items():
            with self.subTest(scenario=scenario):
                ack = state.apply_command(
                    {"type": "command", "id": f"scenario-{scenario}", "mockScenario": scenario}
                )
                telemetry = state.telemetry()

                self.assertTrue(ack["ok"])
                self.assertEqual(telemetry["alerts"], [scenario])
                self.assertIn(scenario, telemetry["safety"]["causes"])
                self.assertTrue(telemetry["safety"]["overrideActive"])
                self.assertEqual(telemetry["safety"]["primary"], scenario)
                self.assertEqual(telemetry["actuatorTargets"], expected["target"])
                self.assertEqual(telemetry["actuators"], expected["actual"])

        state.apply_command({"type": "command", "id": "normal", "mockScenario": "normal"})
        self.assertEqual(state.telemetry()["alerts"], [])

    def test_explicit_mock_buzzer_mute_preserves_safety_actions(self):
        state = gateway.MockBoardState()
        mute = state.apply_command(
            {"type": "command", "id": "mute", "set": {"buzzerEnabled": False}}
        )
        state.apply_command({"type": "command", "id": "risk", "mockScenario": "mq2"})
        telemetry = state.telemetry()

        self.assertTrue(mute["ok"])
        self.assertEqual(mute["id"], "mute")
        self.assertEqual(telemetry["alerts"], ["mq2"])
        self.assertEqual(telemetry["actuatorTargets"]["fanPercent"], 100)
        self.assertFalse(telemetry["actuatorTargets"]["relayOn"])
        self.assertEqual(telemetry["actuatorTargets"]["rgbState"], "red")
        self.assertEqual(telemetry["actuatorTargets"]["buzzerMode"], "off")
        self.assertFalse(telemetry["actuators"]["buzzerOn"])
        self.assertTrue(telemetry["safety"]["buzzerRequested"])
        self.assertTrue(telemetry["safety"]["buzzerMuted"])

    def test_command_ack_requires_id_and_rejects_unknown_values(self):
        state = gateway.MockBoardState()

        cases = [
            ({"type": "command", "mode": "study"}, None, "missing_id"),
            ({"type": "ping", "id": "bad-type"}, "bad-type", "unsupported_type"),
            ({"type": "command", "id": "bad-mode", "mode": "sleep"}, "bad-mode", "unsupported_mode"),
            (
                {"type": "command", "id": "bad-scenario", "mockScenario": "camera"},
                "bad-scenario",
                "unsupported_mock_scenario",
            ),
            ({"type": "command", "id": "empty"}, "empty", "unsupported_command"),
        ]
        for command, command_id, error in cases:
            with self.subTest(error=error):
                ack = state.apply_command(command)
                self.assertEqual(ack["type"], "ack")
                self.assertEqual(ack["id"], command_id)
                self.assertFalse(ack["ok"])
                self.assertEqual(ack["error"], error)

    def test_protocol_filter_accepts_only_project_frames(self):
        valid = {"type": "telemetry", "project": gateway.PROJECT_ID}
        wrong_project = {"type": "telemetry", "project": "other-project"}
        wrong_type = {"type": "notice", "project": gateway.PROJECT_ID}
        missing_project = {"type": "telemetry"}

        self.assertTrue(ws_json.is_protocol_frame(valid))
        self.assertFalse(ws_json.is_protocol_frame(wrong_project))
        self.assertFalse(ws_json.is_protocol_frame(wrong_type))
        self.assertFalse(ws_json.is_protocol_frame(missing_project))
        self.assertEqual(ws_json.topic_for_frame(valid), "smartlife/junior/context/n16r8/telemetry")

    def test_cli_requires_explicit_mock_board_for_stage_two(self):
        parser = gateway.build_parser()
        args = parser.parse_args(["--mock-board", "--ws-port", "18766"])
        self.assertTrue(args.mock_board)
        self.assertEqual(args.ws_port, 18766)

    def test_live_websocket_closes_the_command_ack_telemetry_loop(self):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]

        process = subprocess.Popen(
            [sys.executable, str(ROOT / "tools" / "n16r8_gateway.py"), "--mock-board", "--ws-port", str(port), "--interval", "0.1"],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        client = None
        try:
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                try:
                    client = socket.create_connection(("127.0.0.1", port), timeout=0.5)
                    break
                except OSError:
                    time.sleep(0.03)
            self.assertIsNotNone(client, "mock gateway did not start")
            client.settimeout(2)
            key = base64.b64encode(os.urandom(16)).decode()
            request = (
                f"GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\n"
                f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
            )
            client.sendall(request.encode("ascii"))
            response = bytearray()
            while not response.endswith(b"\r\n\r\n"):
                response.extend(self._read_exact(client, 1))
            self.assertIn(b"101 Switching Protocols", response)

            self._send_client_json(
                client,
                {"type": "command", "project": gateway.PROJECT_ID, "id": "contract-study", "mode": "study"},
            )
            found = {"hello": False, "ack": False, "telemetry": False}
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline and not all(found.values()):
                frame = self._recv_server_json(client)
                if frame["type"] == "hello" and frame.get("mock") is True:
                    found["hello"] = True
                elif frame["type"] == "ack" and frame.get("id") == "contract-study" and frame.get("ok") is True:
                    found["ack"] = True
                elif frame["type"] == "telemetry" and frame.get("mode") == "study":
                    found["telemetry"] = True
            self.assertEqual(found, {"hello": True, "ack": True, "telemetry": True})
        finally:
            if client is not None:
                client.close()
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=1)

    @staticmethod
    def _read_exact(stream, size):
        result = bytearray()
        while len(result) < size:
            chunk = stream.recv(size - len(result))
            if not chunk:
                raise ConnectionError("socket closed")
            result.extend(chunk)
        return bytes(result)

    @classmethod
    def _send_client_json(cls, stream, frame):
        payload = json.dumps(frame, separators=(",", ":")).encode()
        mask = os.urandom(4)
        if len(payload) < 126:
            header = struct.pack("!BB", 0x81, 0x80 | len(payload))
        else:
            header = struct.pack("!BBH", 0x81, 0x80 | 126, len(payload))
        masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        stream.sendall(header + mask + masked)

    @classmethod
    def _recv_server_json(cls, stream):
        first, second = cls._read_exact(stream, 2)
        size = second & 0x7F
        if size == 126:
            size = struct.unpack("!H", cls._read_exact(stream, 2))[0]
        elif size == 127:
            size = struct.unpack("!Q", cls._read_exact(stream, 8))[0]
        if second & 0x80:
            mask = cls._read_exact(stream, 4)
            payload = cls._read_exact(stream, size)
            payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        else:
            payload = cls._read_exact(stream, size)
        if first & 0x0F != 0x1:
            raise ValueError("expected websocket text frame")
        return json.loads(payload.decode())


if __name__ == "__main__":
    unittest.main()
