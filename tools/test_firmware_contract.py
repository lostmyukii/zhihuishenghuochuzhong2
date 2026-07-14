import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIRMWARE = ROOT / "firmware"
PLATFORMIO_INI = FIRMWARE / "platformio.ini"
BOARD_JSON = FIRMWARE / "boards" / "n16r8_esp32s3.json"
PROJECT_CONFIG = FIRMWARE / "include" / "project_config.h"
MAIN_CPP = FIRMWARE / "src" / "main.cpp"


class FirmwareContractTests(unittest.TestCase):
    def read_required(self, path: Path) -> str:
        self.assertTrue(path.exists(), f"required project file is missing: {path.relative_to(ROOT)}")
        return path.read_text(encoding="utf-8")

    def test_platformio_baseline_is_pinned(self):
        config = self.read_required(PLATFORMIO_INI)

        for token in [
            "default_envs = n16r8_esp32s3",
            "boards_dir = boards",
            "platform = platformio/espressif32@7.0.1",
            "board = n16r8_esp32s3",
            "framework = arduino",
            "monitor_speed = 115200",
            "upload_speed = 115200",
            "-DARDUINO_USB_MODE=0",
            "-DARDUINO_USB_CDC_ON_BOOT=0",
            "adafruit/DHT sensor library@1.4.7",
            "adafruit/Adafruit Unified Sensor@1.1.15",
            "madhephaestus/ESP32Servo@1.2.1",
            "bblanchon/ArduinoJson@7.4.3",
            "adafruit/Adafruit NeoPixel@1.15.5",
        ]:
            with self.subTest(token=token):
                self.assertIn(token, config)

        self.assertNotIn("upload_port", config)

    def test_custom_board_matches_n16r8_partition_contract(self):
        board_text = self.read_required(BOARD_JSON)
        board = json.loads(board_text)

        self.assertEqual(board["build"]["mcu"], "esp32s3")
        self.assertEqual(board["build"]["arduino"]["memory_type"], "qio_opi")
        self.assertEqual(board["build"]["arduino"]["partitions"], "default_16MB.csv")
        self.assertEqual(board["upload"]["flash_size"], "16MB")
        self.assertEqual(board["upload"]["maximum_size"], 6553600)
        self.assertEqual(board["upload"]["speed"], 115200)

    def test_project_identity_and_all_gpio_are_frozen(self):
        config = self.read_required(PROJECT_CONFIG)

        for token in [
            'PROJECT_ID = "smartlife-junior-context"',
            'PROFILE_ID = "smartlife-junior-context-detective-v1"',
            'FIRMWARE_VERSION = "0.1.0"',
            "SERIAL_BAUD = 115200",
            "FAST_SENSOR_INTERVAL_MS = 200",
            "DHT_INTERVAL_MS = 2000",
            "DHT_STALE_MS = 6000",
            "TELEMETRY_INTERVAL_MS = 500",
            "MQ2_WARMUP_MS = 30000",
        ]:
            with self.subTest(token=token):
                self.assertIn(token, config)

        expected_pins = {
            "PIN_LIGHT": 1,
            "PIN_SOUND": 4,
            "PIN_DHT": 14,
            "PIN_PIR": 5,
            "PIN_KEYPAD_ADC": 10,
            "PIN_MQ2": 2,
            "PIN_WATER": 8,
            "PIN_FLAME": 45,
            "PIN_BUZZER": 13,
            "PIN_FAN": 11,
            "PIN_SERVO": 9,
            "PIN_RELAY": 12,
            "PIN_RGB": 46,
        }
        for name, pin in expected_pins.items():
            with self.subTest(pin=name):
                self.assertRegex(config, rf"\b{name}\s*=\s*{pin}\s*;")

    def test_minimal_protocol_has_honest_hello_telemetry_and_ack(self):
        source = self.read_required(MAIN_CPP)

        for symbol in ["emitHello", "emitTelemetry", "emitAck", "handleCommandLine"]:
            with self.subTest(symbol=symbol):
                self.assertRegex(source, rf"\b{symbol}\b")

        for token in [
            'root["type"] = "hello"',
            'root["type"] = "telemetry"',
            'root["type"] = "ack"',
            'features["webVoiceIntent"] = true',
            'features["localVoiceNlu"] = false',
            'features["mcp"] = false',
            'root["rfid"] = false',
            'health["stage"] = "protocol-skeleton"',
            'health["sensorsReady"] = false',
            'health["actuatorsReady"] = false',
            'health["contextReady"] = false',
            'health["safetyReady"] = false',
            'root["id"] = commandId',
            '"unsupported_command"',
        ]:
            with self.subTest(token=token):
                self.assertIn(token, source)

        self.assertIn("Serial.begin(SERIAL_BAUD)", source)
        self.assertIn("TELEMETRY_INTERVAL_MS", source)

    def test_stage_one_mode_whitelist_is_exact(self):
        source = self.read_required(MAIN_CPP)
        expected_modes = {"detect", "study", "rest", "ventilation", "energy", "custom"}
        block = source.split("bool isAllowedMode", 1)[1].split("void emitHello", 1)[0]
        actual_modes = set(re.findall(r'"([a-z]+)"', block))

        self.assertEqual(actual_modes, expected_modes)

    def test_skeleton_does_not_fake_sensor_or_actuator_work(self):
        source = self.read_required(MAIN_CPP)

        for forbidden in ["analogRead(", "digitalRead(", "digitalWrite(", "pinMode("]:
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)

        self.assertIn('root["mode"] = selectedMode', source)
        self.assertIn('root["sensors"].to<JsonObject>()', source)
        self.assertIn('root["actuators"].to<JsonObject>()', source)
        self.assertIn('root["alerts"].to<JsonArray>()', source)

    def test_agents_and_gitignore_preserve_no_flash_boundary(self):
        agents = self.read_required(ROOT / "AGENTS.md")
        ignore = self.read_required(ROOT / ".gitignore")

        self.assertIn("当前只运行契约测试和 `pio run` 编译", agents)
        self.assertIn("未经用户再次明确授权", agents)
        for token in ["firmware/.pio/", ".env.*", "*.bin", "n16r8-private-backups/"]:
            with self.subTest(token=token):
                self.assertIn(token, ignore)


if __name__ == "__main__":
    unittest.main()
