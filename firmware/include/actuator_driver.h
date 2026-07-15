#pragma once

#include <Adafruit_NeoPixel.h>
#include <ESP32Servo.h>
#include <stdint.h>

#include "buzzer_pulse_controller.h"
#include "project_config.h"
#include "project_types.h"
#include "rgb_pulse_controller.h"

class ActuatorDriver {
 public:
  ActuatorApplyResult begin();
  ActuatorApplyResult begin(uint32_t nowMs);
  ActuatorApplyResult apply(const ActuatorTarget& target);
  ActuatorApplyResult apply(const ActuatorTarget& target, uint32_t nowMs);
  ActuatorApplyResult requestBuzzerPulse(uint32_t nowMs);
  ActuatorApplyResult stopBuzzer();
  bool tick(uint32_t nowMs);
  bool ready() const;
  uint32_t bootGuardRemainingMs(uint32_t nowMs) const;
  ActuatorApplyResult result() const;

 private:
  uint8_t servoAngleFor(ServoPosition position) const;
  void writeFanPercent(uint8_t percent);
  void writeServoPosition(ServoPosition position);
  void writeRelay(bool on);
  void writeBuzzerMode(BuzzerMode mode, uint32_t nowMs);
  void writeRgbState(RgbState state);

  BuzzerPulseController buzzerPulse_;
  Servo servo_;
  Adafruit_NeoPixel rgbPixels_{RGB_LED_COUNT, RGB_TEST_OUTPUT_PIN,
                              NEO_GRB + NEO_KHZ800};
  uint32_t bootStartedAt_ = 0;
  uint32_t lastBuzzerToggleAt_ = 0;
  bool ready_ = false;
  bool fanAvailable_ = false;
  uint8_t fanPercent_ = 0;
  bool servoAvailable_ = false;
  uint8_t servoAngle_ = SERVO_SAFE_ANGLE;
  bool relayAvailable_ = false;
  bool relayOn_ = false;
  bool buzzerAvailable_ = false;
  bool buzzerOn_ = false;
  BuzzerMode buzzerMode_ = BuzzerMode::Off;
  bool rgbAvailable_ = false;
  RgbState rgbState_ = RgbState::Off;
};

const char* actuatorApplyStateName(ActuatorApplyState state);
