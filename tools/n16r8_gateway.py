#!/usr/bin/env python3
"""Stage-4 local WebSocket gateway with an explicit N16R8 mock board."""

from __future__ import annotations

import argparse
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

    def hello(self) -> dict[str, Any]:
        return {
            "type": "hello",
            "project": PROJECT_ID,
            "profileId": PROFILE_ID,
            "board": "n16r8_esp32s3",
            "deviceName": "N16R8 无摄像头家庭情境侦探屋",
            "firmware": "mock-stage4",
            "mock": True,
            "source": "mock-board",
            "rfid": False,
            "pins": PINS.copy(),
            "features": {"contextReasoning": True, "safetyReasoning": True, "actuatorPlanning": True, "physicalActuators": False, "webVoiceIntent": True, "localVoiceNlu": False, "mcp": False},
            "capabilities": {"commands": ["setMode", "setMockScenario", "setBuzzerEnabled"], "modes": list(MODES), "mockScenarios": list(MOCK_SCENARIOS)},
            "health": {"stage": "mock-stage4-actuator-safety", "source": "mock-board", "sensorsReady": True, "actuatorsReady": True, "actuatorApplyState": "simulated", "contextReady": True, "safetyReady": True, "hardwareVerified": False, "calibrationRequired": True, "buzzerEnabled": self.buzzer_enabled},
        }

    def telemetry(self) -> dict[str, Any]:
        self.sequence += 1
        profile = deepcopy(MODE_PROFILES[self.mode])
        sensors = profile["sensors"]
        targets = profile["actuatorTargets"]
        alerts: list[str] = []
        safety = {"state": "normal", "primary": "none", "causes": [], "overrideActive": False, "buzzerRequested": False, "buzzerMuted": False}

        if self.scenario == "mq2":
            sensors["mq2"] = 3150
            targets.update({"fanPercent": 100, "servoPosition": "ventilation-open", "relayOn": False, "buzzerMode": "alarm", "rgbState": "red"})
        elif self.scenario == "water":
            sensors["water"] = True
            targets.update({"relayOn": False, "buzzerMode": "intermittent", "rgbState": "blue-red"})
        elif self.scenario == "flame":
            sensors["flame"] = True
            targets.update({"fanPercent": 0, "servoPosition": "safety-closed", "relayOn": False, "buzzerMode": "alarm", "rgbState": "red"})

        if self.scenario != "normal":
            alerts = [self.scenario]
            safety = {"state": "risk", "primary": self.scenario, "causes": [self.scenario], "overrideActive": True, "buzzerRequested": True, "buzzerMuted": not self.buzzer_enabled}

        if safety["buzzerRequested"] and not self.buzzer_enabled:
            targets["buzzerMode"] = "off"
        actuators = simulated_actuators(targets)

        context = profile["context"]
        context.update({"candidate": self.mode, "confirmedByUser": False})
        return {
            "type": "telemetry",
            "project": PROJECT_ID,
            "profileId": PROFILE_ID,
            "firmware": "mock-stage4",
            "mock": True,
            "source": "mock-board",
            "sequence": self.sequence,
            "uptimeMs": int((time.monotonic() - self.started_at) * 1000),
            "mode": self.mode,
            "mockScenario": self.scenario,
            "sensors": sensors,
            "actuatorTargets": targets,
            "actuators": actuators,
            "alerts": alerts,
            "safety": safety,
            "context": context,
            "health": {"stage": "mock-stage4-actuator-safety", "source": "mock-board", "sensorsReady": True, "actuatorsReady": True, "actuatorApplyState": "simulated", "contextReady": True, "safetyReady": True, "hardwareVerified": False, "calibrationRequired": True, "buzzerEnabled": self.buzzer_enabled},
        }

    def apply_command(self, command: dict[str, Any]) -> dict[str, Any]:
        command_id = command.get("id")
        if not isinstance(command_id, str) or not command_id:
            return self._ack(None, False, "missing_id")
        if command.get("type") != "command":
            return self._ack(command_id, False, "unsupported_type")

        operations = [key for key in ("mode", "mockScenario", "set") if key in command]
        if len(operations) != 1:
            return self._ack(command_id, False, "unsupported_command")

        operation = operations[0]
        if operation == "mode":
            mode = command["mode"]
            if mode not in MODES:
                return self._ack(command_id, False, "unsupported_mode")
            self.mode = mode
        elif operation == "mockScenario":
            scenario = command["mockScenario"]
            if scenario not in MOCK_SCENARIOS:
                return self._ack(command_id, False, "unsupported_mock_scenario")
            self.scenario = scenario
        else:
            settings = command["set"]
            if not isinstance(settings, dict) or set(settings) != {"buzzerEnabled"} or not isinstance(settings["buzzerEnabled"], bool):
                return self._ack(command_id, False, "unsupported_command")
            self.buzzer_enabled = settings["buzzerEnabled"]
        return self._ack(command_id, True)

    def _ack(self, command_id: str | None, ok: bool, error: str | None = None) -> dict[str, Any]:
        ack: dict[str, Any] = {"type": "ack", "project": PROJECT_ID, "id": command_id, "ok": ok, "mock": True}
        if ok:
            ack["applied"] = {"mode": self.mode, "mockScenario": self.scenario, "buzzerEnabled": self.buzzer_enabled}
        else:
            ack["error"] = error or "unsupported_command"
        return ack


def health_frame() -> dict[str, Any]:
    return {"type": "health", "project": PROJECT_ID, "mock": True, "source": "mock-board", "stage": "mock-stage4-actuator-safety", "online": True}


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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="N16R8 local gateway for the context detective project")
    parser.add_argument("--mock-board", action="store_true", help="use deterministic mock data; required in stage 2")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--ws-port", type=int, default=18766)
    parser.add_argument("--interval", type=float, default=0.8, help="mock telemetry interval in seconds")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if not args.mock_board:
        raise SystemExit("当前真板串口网关尚未启用，请显式添加 --mock-board")
    if args.interval <= 0:
        raise SystemExit("--interval must be greater than zero")
    stop = threading.Event()
    for signal_name in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signal_name, lambda _signum, _frame: stop.set())
    run_gateway(args.host, args.ws_port, args.interval, stop)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
