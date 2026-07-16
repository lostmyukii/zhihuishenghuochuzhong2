#pragma once

#include <stddef.h>
#include <stdint.h>

constexpr const char* PROJECT_ID = "smartlife-junior-context";
constexpr const char* PROFILE_ID = "smartlife-junior-context-detective-v1";
constexpr const char* DEVICE_NAME = "N16R8 无摄像头家庭情境侦探屋";
constexpr const char* BOARD_ID = "n16r8_esp32s3";
constexpr const char* FIRMWARE_VERSION = "0.4.1";

constexpr uint32_t SERIAL_BAUD = 115200;

constexpr uint8_t PIN_LIGHT = 1;
constexpr uint8_t PIN_SOUND = 4;
constexpr uint8_t PIN_DHT = 14;
constexpr uint8_t PIN_PIR = 5;
constexpr uint8_t PIN_KEYPAD_ADC = 10;
constexpr uint8_t PIN_MQ2 = 2;
constexpr uint8_t PIN_WATER = 8;
constexpr uint8_t PIN_FLAME = 45;
constexpr uint8_t PIN_BUZZER = 13;
constexpr uint8_t PIN_FAN = 11;
constexpr uint8_t PIN_SERVO = 9;
constexpr uint8_t PIN_RELAY = 12;
constexpr uint8_t PIN_RGB = 46;
constexpr uint8_t RGB_TEST_OUTPUT_PIN = PIN_RGB;

constexpr uint32_t FAST_SENSOR_INTERVAL_MS = 200;
constexpr uint32_t DHT_INTERVAL_MS = 2000;
constexpr uint32_t DHT_STALE_MS = 6000;
constexpr uint32_t TELEMETRY_INTERVAL_MS = 500;
constexpr uint32_t MQ2_WARMUP_MS = 30000;
constexpr uint8_t DIGITAL_CONFIRM_SAMPLES = 3;
constexpr uint8_t DIGITAL_RECOVERY_SAMPLES = 3;
constexpr uint16_t PROVISIONAL_MQ2_ALERT_RAW = 2600;
constexpr uint16_t PROVISIONAL_MQ2_RECOVERY_RAW = 2400;
constexpr uint16_t MQ2_THRESHOLD_HYSTERESIS_RAW = 200;
constexpr uint32_t FAST_SAFETY_STALE_MS = 1500;
constexpr uint32_t BUZZER_TEST_PULSE_MS = 800;
constexpr uint32_t BUZZER_INTERMITTENT_MS = 500;
constexpr uint32_t ACTUATOR_BOOT_GUARD_MS = 5000;
constexpr uint8_t FAN_PWM_CHANNEL = 0;
constexpr uint32_t FAN_PWM_FREQUENCY_HZ = 25000;
constexpr uint8_t FAN_PWM_RESOLUTION_BITS = 8;
constexpr uint16_t SERVO_MIN_PULSE_US = 500;
constexpr uint16_t SERVO_MAX_PULSE_US = 2400;
constexpr uint8_t SERVO_SAFE_ANGLE = 0;
constexpr uint8_t SERVO_STUDY_ANGLE = 25;
constexpr uint8_t SERVO_REST_ANGLE = 15;
constexpr uint8_t SERVO_VENTILATION_ANGLE = 100;
constexpr uint8_t SERVO_ENERGY_ANGLE = 10;
constexpr bool RELAY_ACTIVE_HIGH = true;
constexpr uint8_t RGB_LED_COUNT = 12;
constexpr uint8_t RGB_TEST_ACTIVE_PIXELS = 1;
constexpr uint8_t RGB_TEST_BRIGHTNESS = 24;
constexpr uint32_t RGB_TEST_PULSE_MS = 5000;

constexpr uint8_t FAN_LOW_PERCENT = 35;
constexpr uint8_t FAN_VENTILATION_PERCENT = 70;
constexpr uint8_t FAN_ALERT_PERCENT = 100;

constexpr bool ACTUATORS_ARMED = true;
constexpr bool BUZZER_ARMED = true;
constexpr bool BUZZER_HARDWARE_VERIFIED = true;
constexpr bool FAN_ARMED = true;
constexpr bool SERVO_ARMED = true;
constexpr bool RELAY_ARMED = true;
constexpr bool RGB_ARMED = true;
constexpr bool FAN_HARDWARE_VERIFIED = false;
constexpr bool SERVO_HARDWARE_VERIFIED = false;
constexpr bool RELAY_HARDWARE_VERIFIED = false;
constexpr bool RGB_HARDWARE_VERIFIED = false;

// Stage-3 starting points only. Real-board calibration must replace these values.
constexpr uint16_t PROVISIONAL_LIGHT_BRIGHT_RAW = 1800;
constexpr uint16_t PROVISIONAL_LIGHT_DIM_RAW = 1400;
constexpr uint16_t PROVISIONAL_SOUND_STUDY_MAX_RAW = 2300;
constexpr uint16_t PROVISIONAL_SOUND_QUIET_MAX_RAW = 1400;
constexpr float PROVISIONAL_TEMPERATURE_HIGH_C = 28.0F;
constexpr float PROVISIONAL_HUMIDITY_HIGH_PERCENT = 70.0F;
constexpr uint8_t CONTEXT_MIN_COVERAGE = 70;
constexpr uint8_t CONTEXT_MATCH_THRESHOLD = 65;
constexpr uint8_t CONTEXT_AMBIGUITY_GAP = 8;

constexpr bool WATER_TRIGGER_HIGH = true;
constexpr bool FLAME_TRIGGER_HIGH = true;
constexpr size_t SERIAL_LINE_MAX_BYTES = 512;
