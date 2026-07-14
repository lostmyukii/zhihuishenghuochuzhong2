#pragma once

#include <Arduino.h>

constexpr const char* PROJECT_ID = "smartlife-junior-context";
constexpr const char* PROFILE_ID = "smartlife-junior-context-detective-v1";
constexpr const char* DEVICE_NAME = "N16R8 无摄像头家庭情境侦探屋";
constexpr const char* BOARD_ID = "n16r8_esp32s3";
constexpr const char* FIRMWARE_VERSION = "0.1.0";

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

constexpr uint32_t FAST_SENSOR_INTERVAL_MS = 200;
constexpr uint32_t DHT_INTERVAL_MS = 2000;
constexpr uint32_t DHT_STALE_MS = 6000;
constexpr uint32_t TELEMETRY_INTERVAL_MS = 500;
constexpr uint32_t MQ2_WARMUP_MS = 30000;
constexpr size_t SERIAL_LINE_MAX_BYTES = 512;
