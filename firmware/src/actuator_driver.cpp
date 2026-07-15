#include "actuator_driver.h"

#include <Arduino.h>

#include "project_config.h"

ActuatorApplyResult ActuatorDriver::begin() {
  return begin(0U);
}

ActuatorApplyResult ActuatorDriver::begin(uint32_t) {
  if (!ACTUATORS_ARMED || !BUZZER_ARMED) {
    return result();
  }

  buzzerPulse_.stop();
  digitalWrite(PIN_BUZZER, LOW);
  pinMode(PIN_BUZZER, OUTPUT);
  buzzerAvailable_ = true;
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

bool ActuatorDriver::tick(uint32_t nowMs) {
  if (!buzzerAvailable_ || !buzzerPulse_.tick(nowMs)) {
    return false;
  }
  digitalWrite(PIN_BUZZER, LOW);
  return true;
}

ActuatorApplyResult ActuatorDriver::result() const {
  ActuatorApplyResult current;
  current.state = buzzerAvailable_ ? ActuatorApplyState::PartialBuzzerTest
                                   : ActuatorApplyState::Unarmed;
  current.buzzerAvailable = buzzerAvailable_;
  current.buzzerOn = buzzerAvailable_ && buzzerPulse_.isOn();
  return current;
}

const char* actuatorApplyStateName(ActuatorApplyState state) {
  switch (state) {
    case ActuatorApplyState::PartialBuzzerTest:
      return "partial-buzzer-test";
    case ActuatorApplyState::Unarmed:
    default:
      return "unarmed";
  }
}
