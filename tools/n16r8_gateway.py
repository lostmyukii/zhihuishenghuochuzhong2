#!/usr/bin/env python3
"""Stage-5 WebSocket gateway for a real CH340 board or explicit mock board."""

from __future__ import annotations

import argparse
import glob
import json
import queue
import signal
import threading
import time
from copy import deepcopy
from typing import Any

from ws_json import JsonRelayServer


PROJECT_ID = "smartlife-junior-context"
PROFILE_ID = "smartlife-junior-context-detective-v1"
MODES = ("detect", "study", "rest", "ventilation", "energy", "custom")
MOCK_SCENARIOS = ("normal", "mq2", "water", "flame")
BOARD_FRAME_TYPES = {"hello", "telemetry", "health", "ack"}
THRESHOLD_DEFAULTS: dict[str, int] = {
    "lightThreshold": 1800,
    "soundThreshold": 2300,
    "temperatureThreshold": 28,
    "humidityThreshold": 70,
    "mq2Threshold": 2600,
}
THRESHOLD_RULES: dict[str, tuple[int, int, int]] = {
    "lightThreshold": (0, 4095, 100),
    "soundThreshold": (0, 4095, 50),
    "temperatureThreshold": (10, 45, 1),
    "humidityThreshold": (20, 95, 5),
    "mq2Threshold": (0, 2600, 50),
}

PINS = {
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
}


def parse_serial_json(raw: bytes | str) -> dict[str, Any] | None:
    """Parse one board line and reject debug text or foreign projects."""
    try:
        text = raw.decode("utf-8") if isinstance(raw, bytes) else raw
    except UnicodeDecodeError:
        return None
    text = text.strip()
    if not text:
        return None
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        return None
    try:
        frame = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    if (
        not isinstance(frame, dict)
        or frame.get("project") != PROJECT_ID
        or frame.get("type") not in BOARD_FRAME_TYPES
    ):
        return None
    return frame


def encode_serial_command(frame: dict[str, Any]) -> bytes:
    if (
        not isinstance(frame, dict)
        or frame.get("type") != "command"
        or frame.get("project") != PROJECT_ID
        or not isinstance(frame.get("id"), str)
        or not frame["id"]
    ):
        raise ValueError("serial command requires project, type=command and id")
    return (json.dumps(frame, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def select_serial_port(candidates: list[str]) -> str | None:
    def rank(path: str) -> tuple[int, str]:
        if path.startswith("/dev/cu.usbserial") or path.startswith("/dev/cu.wchusb"):
            return (0, path)
        if path.startswith("/dev/tty.usbserial") or path.startswith("/dev/tty.wchusb"):
            return (1, path)
        return (2, path)

    usable = [path for path in candidates if "usbserial" in path or "wchusb" in path]
    return sorted(usable, key=rank)[0] if usable else None


def discover_serial_port() -> str | None:
    candidates: list[str] = []
    for pattern in ("/dev/cu.usbserial*", "/dev/cu.wchusb*", "/dev/tty.usbserial*", "/dev/tty.wchusb*"):
        candidates.extend(glob.glob(pattern))
    return select_serial_port(candidates)

MODE_PROFILES: dict[str, dict[str, Any]] = {
    "detect": {
        "sensors": {"light": 520, "sound": 125, "temperature": 24.6, "humidity": 51, "pir": False, "keypad": 0, "mq2": 380, "water": False, "flame": False},
        "actuatorTargets": {"fanPercent": 0, "servoPosition": "hold", "relayOn": False, "buzzerMode": "off", "rgbState": "off"},
        "context": {"status": "uncertain", "coverage": 78, "match": 65, "supporting": ["危险传感器均未触发", "环境数据覆盖完整"], "opposing": ["尚未观察到持续活动"], "missing": ["需要选择具体生活情境"]},
    },
    "study": {
        "sensors": {"light": 720, "sound": 86, "temperature": 24.8, "humidity": 48, "pir": True, "keypad": 1, "mq2": 390, "water": False, "flame": False},
        "actuatorTargets": {"fanPercent": 0, "servoPosition": "study", "relayOn": True, "buzzerMode": "off", "rgbState": "study"},
        "context": {"status": "matched", "coverage": 96, "match": 91, "supporting": ["有人在场", "光照充足", "环境声音较低"], "opposing": [], "missing": ["未接入学习时长数据"]},
    },
    "rest": {
        "sensors": {"light": 135, "sound": 42, "temperature": 25.2, "humidity": 53, "pir": True, "keypad": 2, "mq2": 385, "water": False, "flame": False},
        "actuatorTargets": {"fanPercent": 0, "servoPosition": "rest", "relayOn": False, "buzzerMode": "off", "rgbState": "blue-low"},
        "context": {"status": "matched", "coverage": 93, "match": 89, "supporting": ["室内光线较暗", "环境安静", "有人在场"], "opposing": [], "missing": ["未接入作息时间数据"]},
    },
    "ventilation": {
        "sensors": {"light": 480, "sound": 118, "temperature": 29.3, "humidity": 72, "pir": True, "keypad": 3, "mq2": 520, "water": False, "flame": False},
        "actuatorTargets": {"fanPercent": 70, "servoPosition": "ventilation-open", "relayOn": False, "buzzerMode": "off", "rgbState": "cyan"},
        "context": {"status": "matched", "coverage": 97, "match": 94, "supporting": ["温度偏高", "湿度偏高", "空气指标持续升高"], "opposing": [], "missing": []},
    },
    "energy": {
        "sensors": {"light": 805, "sound": 25, "temperature": 23.7, "humidity": 46, "pir": False, "keypad": 4, "mq2": 370, "water": False, "flame": False},
        "actuatorTargets": {"fanPercent": 0, "servoPosition": "energy", "relayOn": False, "buzzerMode": "off", "rgbState": "off"},
        "context": {"status": "matched", "coverage": 94, "match": 92, "supporting": ["长时间无人活动", "自然光充足", "可关闭非必要用电"], "opposing": [], "missing": ["未接入实时功耗数据"]},
    },
    "custom": {
        "sensors": {"light": 430, "sound": 238, "temperature": 26.1, "humidity": 57, "pir": True, "keypad": 5, "mq2": 405, "water": False, "flame": False},
        "actuatorTargets": {"fanPercent": 0, "servoPosition": "hold", "relayOn": False, "buzzerMode": "off", "rgbState": "off"},
        "context": {"status": "uncertain", "coverage": 74, "match": 61, "supporting": ["已接收自定义情境选择", "主要传感器在线"], "opposing": ["声音波动较大"], "missing": ["尚未配置自定义判据"]},
    },
}

SERVO_ANGLES = {
    "hold": 0,
    "study": 25,
    "rest": 15,
    "ventilation-open": 100,
    "energy": 10,
    "safety-closed": 0,
}

SERVO_POSITIONS = frozenset(SERVO_ANGLES)
RGB_STATES = frozenset(
    {"off", "study", "orange", "blue-low", "cyan", "yellow", "red", "green", "blue", "purple", "blue-red"}
)


def simulated_actuators(targets: dict[str, Any]) -> dict[str, Any]:
    return {
        "fanPercent": targets["fanPercent"],
        "servoAngle": SERVO_ANGLES[targets["servoPosition"]],
        "relayOn": targets["relayOn"],
        "buzzerOn": targets["buzzerMode"] != "off",
        "rgbState": targets["rgbState"],
    }


class MockBoardState:
    def __init__(self) -> None:
        self.mode = "detect"
        self.scenario = "normal"
        self.started_at = time.monotonic()
        self.sequence = 0
        self.buzzer_enabled = True
        self.manual_overrides: dict[str, Any] = {}
        self.thresholds = deepcopy(THRESHOLD_DEFAULTS)
        self.context_feedback = "none"
        self.feedback_mode: str | None = None

    def hello(self) -> dict[str, Any]:
        return {
            "type": "hello",
            "project": PROJECT_ID,
            "profileId": PROFILE_ID,
            "board": "n16r8_esp32s3",
            "deviceName": "N16R8 无摄像头家庭情境侦探屋",
            "firmware": "mock-stage5",
            "mock": True,
            "source": "mock-board",
            "rfid": False,
            "pins": PINS.copy(),
            "features": {"contextReasoning": True, "safetyReasoning": True, "actuatorPlanning": True, "physicalActuators": False, "webVoiceIntent": True, "localVoiceNlu": False, "mcp": False},
            "capabilities": {"commands": ["setMode", "setMockScenario", "setBuzzerEnabled", "setActuator", "confirmContext", "correctContext", "setThreshold"], "modes": list(MODES), "mockScenarios": list(MOCK_SCENARIOS), "thresholdFields": list(THRESHOLD_DEFAULTS)},
            "health": {"stage": "mock-stage5-integrated", "source": "mock-board", "sensorsReady": True, "actuatorsReady": True, "actuatorApplyState": "simulated", "contextReady": True, "safetyReady": True, "hardwareVerified": False, "calibrationRequired": True, "buzzerEnabled": self.buzzer_enabled},
        }

    def telemetry(self) -> dict[str, Any]:
        self.sequence += 1
        profile = deepcopy(MODE_PROFILES[self.mode])
        sensors = profile["sensors"]
        targets = profile["actuatorTargets"]
        alerts: list[str] = []
        safety = {"state": "normal", "primary": "none", "causes": [], "overrideActive": False, "buzzerRequested": False, "buzzerMuted": False}

        self._apply_manual_targets(targets)

        threshold_mq2 = self.scenario == "normal" and sensors["mq2"] >= self.thresholds["mq2Threshold"]
        effective_scenario = "mq2" if threshold_mq2 else self.scenario
        if effective_scenario == "mq2":
            sensors["mq2"] = 3150
            targets.update({"fanPercent": 100, "servoPosition": "ventilation-open", "relayOn": False, "buzzerMode": "alarm", "rgbState": "red"})
        elif effective_scenario == "water":
            sensors["water"] = True
            targets.update({"relayOn": False, "buzzerMode": "intermittent", "rgbState": "blue-red"})
        elif effective_scenario == "flame":
            sensors["flame"] = True
            targets.update({"fanPercent": 0, "servoPosition": "safety-closed", "relayOn": False, "buzzerMode": "alarm", "rgbState": "red"})

        if effective_scenario != "normal":
            alerts = [effective_scenario]
            safety = {"state": "risk", "primary": effective_scenario, "causes": [effective_scenario], "overrideActive": True, "buzzerRequested": True, "buzzerMuted": not self.buzzer_enabled}

        if safety["buzzerRequested"] and not self.buzzer_enabled:
            targets["buzzerMode"] = "off"
        actuators = simulated_actuators(targets)

        context = profile["context"]
        candidate = self.feedback_mode if self.context_feedback == "corrected" and self.feedback_mode else self.mode
        if self.context_feedback == "confirmed":
            context["status"] = "confirmed"
        elif self.context_feedback == "corrected":
            context["status"] = "corrected"
        context.update({
            "candidate": candidate,
            "confirmedByUser": self.context_feedback == "confirmed",
            "correctedByUser": self.context_feedback == "corrected",
            "feedback": self.context_feedback,
        })
        return {
            "type": "telemetry",
            "project": PROJECT_ID,
            "profileId": PROFILE_ID,
            "firmware": "mock-stage5",
            "mock": True,
            "source": "mock-board",
            "sequence": self.sequence,
            "uptimeMs": int((time.monotonic() - self.started_at) * 1000),
            "mode": self.mode,
            "mockScenario": self.scenario,
            "sensors": sensors,
            "sensorValid": {key: True for key in sensors},
            "sensorAgeMs": {key: 0 for key in sensors},
            "thresholds": deepcopy(self.thresholds),
            "actuatorTargets": targets,
            "actuators": actuators,
            "alerts": alerts,
            "safety": safety,
            "context": context,
            "health": {"stage": "mock-stage5-integrated", "source": "mock-board", "sensorsReady": True, "actuatorsReady": True, "actuatorApplyState": "simulated", "contextReady": True, "safetyReady": True, "hardwareVerified": False, "calibrationRequired": True, "buzzerEnabled": self.buzzer_enabled, "mq2AlertRaw": self.thresholds["mq2Threshold"], "thresholdPersistence": "ram-only"},
        }

    def _candidate(self) -> str:
        return self.feedback_mode if self.context_feedback == "corrected" and self.feedback_mode else self.mode

    def _apply_threshold_setting(self, settings: Any) -> bool:
        if not isinstance(settings, dict) or len(settings) != 1:
            return False
        key, value = next(iter(settings.items()))
        rule = THRESHOLD_RULES.get(key)
        if rule is None or not isinstance(value, (int, float)) or isinstance(value, bool):
            return False
        if isinstance(value, float) and not value.is_integer():
            return False
        numeric = int(value)
        low, high, step = rule
        if numeric < low or numeric > high or (numeric - low) % step != 0:
            return False
        self.thresholds[key] = numeric
        return True

    def _apply_manual_targets(self, targets: dict[str, Any]) -> None:
        mappings = {
            "fan": ("fanPercent", lambda value: value),
            "servo": ("servoPosition", lambda value: value),
            "relay": ("relayOn", lambda value: value),
            "buzzer": ("buzzerMode", lambda value: "alarm" if value else "off"),
            "rgb": ("rgbState", lambda value: value),
        }
        for key, value in self.manual_overrides.items():
            target_key, transform = mappings[key]
            targets[target_key] = transform(value)

    def _apply_actuator_command(self, actuator: Any) -> bool:
        if not isinstance(actuator, dict) or len(actuator) != 1:
            return False
        key, value = next(iter(actuator.items()))
        if key not in {"fan", "servo", "relay", "buzzer", "rgb"}:
            return False
        if value == "auto":
            self.manual_overrides.pop(key, None)
            return True
        valid = (
            (key == "fan" and isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 100)
            or (key == "servo" and isinstance(value, str) and value in SERVO_POSITIONS)
            or (key in {"relay", "buzzer"} and isinstance(value, bool))
            or (key == "rgb" and isinstance(value, str) and value in RGB_STATES)
        )
        if not valid:
            return False
        self.manual_overrides[key] = value
        return True

    def apply_command(self, command: dict[str, Any]) -> dict[str, Any]:
        command_id = command.get("id")
        if not isinstance(command_id, str) or not command_id:
            return self._ack(None, False, "missing_id")
        if command.get("type") != "command":
            return self._ack(command_id, False, "unsupported_type")

        operations = [key for key in ("mode", "mockScenario", "set", "actuator", "contextConfirm", "contextCorrect") if key in command]
        if len(operations) != 1:
            return self._ack(command_id, False, "unsupported_command")

        operation = operations[0]
        if operation == "mode":
            mode = command["mode"]
            if mode not in MODES:
                return self._ack(command_id, False, "unsupported_mode")
            self.mode = mode
            self.context_feedback = "none"
            self.feedback_mode = None
        elif operation == "mockScenario":
            scenario = command["mockScenario"]
            if scenario not in MOCK_SCENARIOS:
                return self._ack(command_id, False, "unsupported_mock_scenario")
            self.scenario = scenario
        elif operation == "set":
            settings = command["set"]
            if isinstance(settings, dict) and set(settings) == {"buzzerEnabled"} and isinstance(settings["buzzerEnabled"], bool):
                self.buzzer_enabled = settings["buzzerEnabled"]
            elif not self._apply_threshold_setting(settings):
                return self._ack(command_id, False, "invalid_threshold")
        elif operation == "contextConfirm":
            confirmation = command["contextConfirm"]
            if (
                not isinstance(confirmation, dict)
                or set(confirmation) != {"candidate", "correct"}
                or confirmation.get("candidate") not in MODES
                or confirmation.get("correct") is not True
            ):
                return self._ack(command_id, False, "invalid_context_confirmation")
            if confirmation["candidate"] != self._candidate():
                return self._ack(command_id, False, "candidate_mismatch")
            self.context_feedback = "confirmed"
            self.feedback_mode = confirmation["candidate"]
        elif operation == "contextCorrect":
            correction = command["contextCorrect"]
            if not isinstance(correction, dict) or set(correction) != {"mode"} or correction.get("mode") not in MODES:
                return self._ack(command_id, False, "invalid_context_correction")
            self.context_feedback = "corrected"
            self.feedback_mode = correction["mode"]
        else:
            if not self._apply_actuator_command(command["actuator"]):
                return self._ack(command_id, False, "invalid_actuator_command")
        return self._ack(command_id, True)

    def _ack(self, command_id: str | None, ok: bool, error: str | None = None) -> dict[str, Any]:
        ack: dict[str, Any] = {"type": "ack", "project": PROJECT_ID, "id": command_id, "ok": ok, "mock": True}
        if ok:
            ack["applied"] = {"mode": self.mode, "mockScenario": self.scenario, "buzzerEnabled": self.buzzer_enabled, "manualOverride": deepcopy(self.manual_overrides), "contextFeedback": self.context_feedback, "feedbackMode": self.feedback_mode, "thresholds": deepcopy(self.thresholds)}
        else:
            ack["error"] = error or "unsupported_command"
        return ack


def health_frame() -> dict[str, Any]:
    return {"type": "health", "project": PROJECT_ID, "mock": True, "source": "mock-board", "stage": "mock-stage5-integrated", "online": True}


def serial_health_frame(port: str, online: bool, error: str | None = None) -> dict[str, Any]:
    frame: dict[str, Any] = {
        "type": "health",
        "project": PROJECT_ID,
        "mock": False,
        "source": "serial-gateway",
        "stage": "stage5-integrated-realtime",
        "serialPort": port,
        "online": online,
    }
    if error:
        frame["error"] = error
    return frame


def run_gateway(host: str, port: int, interval: float, stop_event: threading.Event | None = None) -> None:
    stop = stop_event or threading.Event()
    state = MockBoardState()
    relay = JsonRelayServer(host, port, broadcast_incoming=False)
    relay.start()
    relay.broadcast_json(state.hello(), retain=True)
    relay.broadcast_json(health_frame(), retain=True)
    print(f"Mock board gateway: ws://{host}:{relay.port}", flush=True)
    print("Data source: mock-board (not a physical N16R8)", flush=True)
    next_telemetry = 0.0
    next_health = 0.0
    try:
        while not stop.is_set():
            now = time.monotonic()
            try:
                command = relay.incoming.get(timeout=0.05)
            except queue.Empty:
                command = None
            if command is not None:
                ack = state.apply_command(command)
                relay.broadcast_json(ack)
                if ack["ok"]:
                    relay.broadcast_json(state.telemetry(), retain=True)
                    next_telemetry = now + interval
            if now >= next_telemetry:
                relay.broadcast_json(state.telemetry(), retain=True)
                next_telemetry = now + interval
            if now >= next_health:
                relay.broadcast_json(health_frame(), retain=True)
                next_health = now + 2.0
    finally:
        relay.close()


def run_serial_gateway(
    host: str,
    port: int,
    serial_port: str | None,
    baud: int,
    stop_event: threading.Event | None = None,
) -> None:
    try:
        import serial
    except ImportError as exc:
        raise SystemExit("真板网关需要 pyserial：python3 -m pip install pyserial") from exc

    selected = serial_port or discover_serial_port()
    if not selected:
        raise SystemExit("未发现CH340串口，请使用 --serial-port 明确指定")

    stop = stop_event or threading.Event()
    relay = JsonRelayServer(host, port, broadcast_incoming=False)
    relay.start()
    board = serial.Serial(selected, baud, timeout=0.05, write_timeout=1)
    board.dtr = False
    board.rts = False
    relay.broadcast_json(serial_health_frame(selected, True), retain=True)
    print(f"Real board gateway: ws://{host}:{relay.port}", flush=True)
    print(f"Serial board: {selected} @ {baud}", flush=True)
    try:
        while not stop.is_set():
            raw = board.readline()
            if raw:
                frame = parse_serial_json(raw)
                if frame is not None:
                    relay.broadcast_json(frame, retain=frame["type"] in {"hello", "telemetry", "health"})
            try:
                command = relay.incoming.get_nowait()
            except queue.Empty:
                command = None
            if command is not None:
                try:
                    board.write(encode_serial_command(command))
                    board.flush()
                except ValueError:
                    continue
    except (OSError, serial.SerialException) as exc:
        relay.broadcast_json(serial_health_frame(selected, False, type(exc).__name__), retain=True)
        raise
    finally:
        board.close()
        relay.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="N16R8 local gateway for the context detective project")
    route = parser.add_mutually_exclusive_group()
    route.add_argument("--mock-board", action="store_true", help="use deterministic mock data")
    route.add_argument("--serial-port", help="real CH340 serial port; auto-detect when omitted")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--ws-port", type=int, default=18766)
    parser.add_argument("--interval", type=float, default=0.8, help="mock telemetry interval in seconds")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.interval <= 0:
        raise SystemExit("--interval must be greater than zero")
    stop = threading.Event()
    for signal_name in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signal_name, lambda _signum, _frame: stop.set())
    if args.mock_board:
        run_gateway(args.host, args.ws_port, args.interval, stop)
    else:
        run_serial_gateway(args.host, args.ws_port, args.serial_port, args.baud, stop)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
