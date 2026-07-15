#include "actuator_driver.h"

#include <Arduino.h>

#include "project_config.h"

ActuatorApplyResult ActuatorDriver::begin() {
  return begin(0U);
}

ActuatorApplyResult ActuatorDriver::begin(uint32_t) {
  if (!ACTUATORS_ARMED) {
    return result();
  }

  if (BUZZER_ARMED) {
    buzzerPulse_.stop();
    digitalWrite(PIN_BUZZER, LOW);
    pinMode(PIN_BUZZER, OUTPUT);
    buzzerAvailable_ = true;
  }

  if (RGB_ARMED) {
    rgbPulse_.stop();
    rgbPixels_.begin();
    rgbPixels_.setBrightness(RGB_TEST_BRIGHTNESS);
    rgbPixels_.clear();
    rgbPixels_.show();
    rgbAvailable_ = true;
  }
  return result();
}

ActuatorApplyResult ActuatorDriver::apply(const ActuatorTarget&) {
  return result();
}

ActuatorApplyResult ActuatorDriver::apply(const ActuatorTarget&, uint32_t) {
  return result();
}

ActuatorApplyResult ActuatorDriver::requestBuzzerPulse(uint32_t nowMs) {
  if (!buzzerAvailable_) {
    return result();
  }
  buzzerPulse_.requestPulse(nowMs);
  digitalWrite(PIN_BUZZER, HIGH);
  return result();
}

ActuatorApplyResult ActuatorDriver::stopBuzzer() {
  if (!buzzerAvailable_) {
    return result();
  }
  buzzerPulse_.stop();
  digitalWrite(PIN_BUZZER, LOW);
  return result();
}

ActuatorApplyResult ActuatorDriver::requestRgbTestPulse(uint32_t nowMs) {
  if (!rgbAvailable_) {
    return result();
  }
  rgbPulse_.requestPulse(nowMs);
  rgbPixels_.fill(rgbPixels_.Color(0, 255, 255));
  rgbPixels_.show();
  return result();
}

ActuatorApplyResult ActuatorDriver::stopRgb() {
  if (!rgbAvailable_) {
    return result();
  }
  rgbPulse_.stop();
  rgbPixels_.clear();
  rgbPixels_.show();
  return result();
}

bool ActuatorDriver::tick(uint32_t nowMs) {
  bool changed = false;
  if (buzzerAvailable_ && buzzerPulse_.tick(nowMs)) {
    digitalWrite(PIN_BUZZER, LOW);
    changed = true;
  }
  if (rgbAvailable_ && rgbPulse_.tick(nowMs)) {
    rgbPixels_.clear();
    rgbPixels_.show();
    changed = true;
  }
  return changed;
}

ActuatorApplyResult ActuatorDriver::result() const {
  ActuatorApplyResult current;
  if (rgbAvailable_) {
    current.state = ActuatorApplyState::PartialBuzzerRgbTest;
  } else if (buzzerAvailable_) {
    current.state = ActuatorApplyState::PartialBuzzerTest;
  }
  current.buzzerAvailable = buzzerAvailable_;
  current.buzzerOn = buzzerAvailable_ && buzzerPulse_.isOn();
  current.rgbAvailable = rgbAvailable_;
  current.rgbState = rgbAvailable_ && rgbPulse_.isOn() ? RgbState::Cyan
                                                       : RgbState::Off;
  return current;
}

const char* actuatorApplyStateName(ActuatorApplyState state) {
  switch (state) {
    case ActuatorApplyState::PartialBuzzerRgbTest:
      return "partial-buzzer-rgb-test";
    case ActuatorApplyState::PartialBuzzerTest:
      return "partial-buzzer-test";
    case ActuatorApplyState::Unarmed:
    default:
      return "unarmed";
  }
}
