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
SENSORS_HEADER = FIRMWARE / "include" / "sensors.h"
SENSORS_CPP = FIRMWARE / "src" / "sensors.cpp"
PROJECT_TYPES = FIRMWARE / "include" / "project_types.h"
CONTEXT_HEADER = FIRMWARE / "include" / "context_engine.h"
CONTEXT_CPP = FIRMWARE / "src" / "context_engine.cpp"
INPUT_FILTER = FIRMWARE / "include" / "input_filter.h"
SAFETY_HEADER = FIRMWARE / "include" / "safety_engine.h"
SAFETY_CPP = FIRMWARE / "src" / "safety_engine.cpp"
PLANNER_HEADER = FIRMWARE / "include" / "actuator_planner.h"
PLANNER_CPP = FIRMWARE / "src" / "actuator_planner.cpp"
DRIVER_HEADER = FIRMWARE / "include" / "actuator_driver.h"
DRIVER_CPP = FIRMWARE / "src" / "actuator_driver.cpp"
BUZZER_CONTROLLER_HEADER = FIRMWARE / "include" / "buzzer_pulse_controller.h"
BUZZER_CONTROLLER_CPP = FIRMWARE / "src" / "buzzer_pulse_controller.cpp"


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
            "monitor_dtr = 0",
            "monitor_rts = 0",
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
            'FIRMWARE_VERSION = "0.3.1"',
            "SERIAL_BAUD = 115200",
            "FAST_SENSOR_INTERVAL_MS = 200",
            "DHT_INTERVAL_MS = 2000",
            "DHT_STALE_MS = 6000",
            "TELEMETRY_INTERVAL_MS = 500",
            "MQ2_WARMUP_MS = 30000",
            "DIGITAL_CONFIRM_SAMPLES = 3",
            "DIGITAL_RECOVERY_SAMPLES = 3",
            "PROVISIONAL_MQ2_ALERT_RAW = 2600",
            "PROVISIONAL_MQ2_RECOVERY_RAW = 2400",
            "FAST_SAFETY_STALE_MS = 1500",
            "FAN_LOW_PERCENT = 35",
            "FAN_VENTILATION_PERCENT = 70",
            "FAN_ALERT_PERCENT = 100",
            "BUZZER_TEST_PULSE_MS = 800",
            "ACTUATORS_ARMED = true",
            "BUZZER_ARMED = true",
            "BUZZER_HARDWARE_VERIFIED = true",
            "FAN_ARMED = false",
            "SERVO_ARMED = false",
            "RELAY_ARMED = false",
            "RGB_ARMED = false",
            "CONTEXT_MIN_COVERAGE = 70",
            "CONTEXT_MATCH_THRESHOLD = 65",
            "CONTEXT_AMBIGUITY_GAP = 8",
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

    def test_stage_four_protocol_has_honest_hello_telemetry_and_ack(self):
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
            'features["safetyReasoning"] = true',
            'features["actuatorPlanning"] = true',
            'features["physicalActuators"] = false',
            'features["physicalBuzzer"]',
            'root["rfid"] = false',
            'health["stage"] = "stage4-buzzer-hardware-validation"',
            'health["sensorsReady"] = true',
            'health["actuatorsReady"] = false',
            'health["actuatorsArmed"] = ACTUATORS_ARMED',
            'health["buzzerArmed"] = BUZZER_ARMED',
            'health["fanArmed"] = FAN_ARMED',
            'health["servoArmed"] = SERVO_ARMED',
            'health["relayArmed"] = RELAY_ARMED',
            'health["rgbArmed"] = RGB_ARMED',
            'health["buzzerHardwareVerified"] = BUZZER_HARDWARE_VERIFIED',
            'health["actuatorApplyState"] = actuatorApplyStateName(currentApply.state)',
            'health["contextReady"] = true',
            'health["safetyReady"] = true',
            'health["hardwareVerified"] = false',
            'health["calibrationRequired"] = true',
            'root["id"] = commandId',
            '"unsupported_command"',
            '"invalid_actuator_command"',
            '"actuators_unarmed"',
        ]:
            with self.subTest(token=token):
                self.assertIn(token, source)

        self.assertIn("Serial.begin(SERIAL_BAUD)", source)
        self.assertIn("TELEMETRY_INTERVAL_MS", source)

    def test_stage_one_mode_whitelist_is_exact(self):
        source = self.read_required(MAIN_CPP)
        expected_modes = {"detect", "study", "rest", "ventilation", "energy", "custom"}
        block = source.split("bool isAllowedMode", 1)[1].split(
            "bool isAllowedServoPosition", 1
        )[0]
        actual_modes = set(re.findall(r'"([a-z]+)"', block))

        self.assertEqual(actual_modes, expected_modes)
        self.assertIn('command["mode"].as<const char*>()', source)
        self.assertNotIn('command["mode"] | nullptr', source)

    def test_stage_four_modules_are_split_by_responsibility(self):
        for path in [
            SENSORS_HEADER,
            SENSORS_CPP,
            PROJECT_TYPES,
            CONTEXT_HEADER,
            CONTEXT_CPP,
            INPUT_FILTER,
            SAFETY_HEADER,
            SAFETY_CPP,
            PLANNER_HEADER,
            PLANNER_CPP,
            DRIVER_HEADER,
            DRIVER_CPP,
            BUZZER_CONTROLLER_HEADER,
            BUZZER_CONTROLLER_CPP,
        ]:
            self.read_required(path)

        main = self.read_required(MAIN_CPP)
        self.assertIn("SensorSampler sensors;", main)
        self.assertIn("ContextEngine contextEngine;", main)
        self.assertIn("SafetyEngine safetyEngine;", main)
        self.assertIn("ActuatorPlanner actuatorPlanner;", main)
        self.assertIn("ActuatorDriver actuatorDriver;", main)
        self.assertIn("sensors.poll(now);", main)
        self.assertIn("contextEngine.evaluate", main)
        self.assertIn("safetyEngine.update", main)
        self.assertIn("actuatorPlanner.plan", main)
        self.assertIn("actuatorDriver.apply", main)

    def test_actuator_driver_only_arms_gpio13_with_safe_boot_order(self):
        source = self.read_required(DRIVER_CPP)
        header = self.read_required(DRIVER_HEADER)

        self.assertIn("ACTUATORS_ARMED", source)
        self.assertIn("BUZZER_ARMED", source)
        self.assertIn("BuzzerPulseController", header)
        self.assertIn("class ActuatorDriver", header)
        safe_low = source.index("digitalWrite(PIN_BUZZER, LOW)")
        output_mode = source.index("pinMode(PIN_BUZZER, OUTPUT)")
        self.assertLess(safe_low, output_mode)
        self.assertIn("digitalWrite(PIN_BUZZER, HIGH)", source)
        for forbidden_pin in ["PIN_FAN", "PIN_SERVO", "PIN_RELAY", "PIN_RGB"]:
            with self.subTest(forbidden_pin=forbidden_pin):
                self.assertNotIn(forbidden_pin, source)
        for forbidden in [
            "ledcWrite(",
            ".attach(",
            "Adafruit_NeoPixel",
            ".show(",
        ]:
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)

    def test_sensor_sampler_reads_all_inputs_without_driving_actuators(self):
        source = self.read_required(SENSORS_CPP)

        for token in [
            "analogRead(PIN_LIGHT)",
            "analogRead(PIN_SOUND)",
            "analogRead(PIN_KEYPAD_ADC)",
            "analogRead(PIN_MQ2)",
            "digitalRead(PIN_PIR)",
            "digitalRead(PIN_WATER)",
            "digitalRead(PIN_FLAME)",
            "analogReadResolution(12)",
        ]:
            with self.subTest(token=token):
                self.assertIn(token, source)

        combined = "\n".join(
            self.read_required(path) for path in [MAIN_CPP, SENSORS_CPP, CONTEXT_CPP]
        )
        for forbidden in ["digitalWrite(", "ledcWrite(", ".attach(", "Adafruit_NeoPixel"]:
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, combined)

    def test_dht_is_polled_independently_and_expires_after_stale_window(self):
        source = self.read_required(SENSORS_CPP)
        fast_block = source.split("void SensorSampler::pollFast", 1)[1].split(
            "void SensorSampler::pollDht", 1
        )[0]
        dht_block = source.split("void SensorSampler::pollDht", 1)[1]

        self.assertIn("FAST_SENSOR_INTERVAL_MS", source)
        self.assertIn("DHT_INTERVAL_MS", source)
        self.assertIn("DHT_STALE_MS", source)
        self.assertNotIn("readTemperature", fast_block)
        self.assertNotIn("readHumidity", fast_block)
        self.assertIn("dht_.readTemperature()", dht_block)
        self.assertIn("dht_.readHumidity()", dht_block)
        self.assertIn("lastDhtSuccessAt_", dht_block)
        self.assertIn("nowMs - lastDhtSuccessAt_ <= DHT_STALE_MS", source)

    def test_mq2_warmup_and_unverified_digital_levels_are_reported(self):
        sensors = self.read_required(SENSORS_CPP)
        main = self.read_required(MAIN_CPP)
        config = self.read_required(PROJECT_CONFIG)

        self.assertIn("nowMs - startedAt_ >= MQ2_WARMUP_MS", sensors)
        self.assertIn("StableDigitalFilter", self.read_required(INPUT_FILTER))
        self.assertIn("WATER_TRIGGER_HIGH = true", config)
        self.assertIn("FLAME_TRIGGER_HIGH = true", config)
        for token in [
            'health["mq2State"]',
            'health["mq2WarmupRemainingMs"]',
            'health["waterInputLevel"]',
            'health["waterTriggerLevel"] = "high-unverified"',
            'health["flameInputLevel"]',
            'health["flameTriggerLevel"] = "high-unverified"',
        ]:
            with self.subTest(token=token):
                self.assertIn(token, main)

    def test_telemetry_includes_values_targets_actuals_safety_and_evidence(self):
        source = self.read_required(MAIN_CPP)
        context = self.read_required(CONTEXT_CPP)

        for token in [
            'root["sensors"].to<JsonObject>()',
            'root["sensorValid"].to<JsonObject>()',
            'root["sensorAgeMs"].to<JsonObject>()',
            'context["candidate"]',
            'context["coverage"]',
            'context["match"]',
            'context["status"]',
            'context["supporting"].to<JsonArray>()',
            'context["opposing"].to<JsonArray>()',
            'context["missing"].to<JsonArray>()',
            'root["actuators"].to<JsonObject>()',
            'root["actuatorTargets"].to<JsonObject>()',
            'root["alerts"].to<JsonArray>()',
            'root["safety"].to<JsonObject>()',
            'actuators["fanPercent"] = nullptr',
            'actuators["servoAngle"] = nullptr',
            'actuators["relayOn"] = nullptr',
            'actuators["buzzerOn"] = currentApply.buzzerOn',
            'actuators["rgbState"] = nullptr',
        ]:
            with self.subTest(token=token):
                self.assertIn(token, source)

        for evidence in [
            '"pir_active"',
            '"light_suitable"',
            '"sound_high"',
            '"dht_missing"',
            '"no_occupancy"',
        ]:
            with self.subTest(evidence=evidence):
                self.assertIn(evidence, context)

    def test_stage_four_command_validation_and_buzzer_mute_are_explicit(self):
        source = self.read_required(MAIN_CPP)

        for token in [
            'command["set"]["buzzerEnabled"]',
            'command["actuator"]',
            '"missing_id"',
            '"unsupported_type"',
            '"unsupported_mode"',
            '"invalid_actuator_command"',
            '"actuators_unarmed"',
            'root["id"] = nullptr',
            "actuatorDriver.requestBuzzerPulse",
            "actuatorDriver.stopBuzzer",
            'applied["buzzerPulseMs"] = BUZZER_TEST_PULSE_MS',
        ]:
            with self.subTest(token=token):
                self.assertIn(token, source)

        self.assertIn("buzzerEnabled = requested", source)
        self.assertIn("actuatorDriver.tick(now)", source)
        self.assertNotIn("buzzerEnabled = false;  // actuator", source)

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
