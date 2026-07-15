#include "actuator_driver.h"

#include <Arduino.h>

#include "project_config.h"

namespace {

uint8_t fanDuty(uint8_t percent) {
  const uint16_t maximum = (1U << FAN_PWM_RESOLUTION_BITS) - 1U;
  return static_cast<uint8_t>((static_cast<uint32_t>(percent) * maximum + 50U) /
                              100U);
}

uint8_t relayLevel(bool on) {
  const bool high = RELAY_ACTIVE_HIGH ? on : !on;
  return high ? HIGH : LOW;
}

}  // namespace

ActuatorApplyResult ActuatorDriver::begin() {
  return begin(0U);
}

ActuatorApplyResult ActuatorDriver::begin(uint32_t nowMs) {
  bootStartedAt_ = nowMs;
  ready_ = false;
  if (!ACTUATORS_ARMED) {
    return result();
  }

  if (FAN_ARMED) {
    digitalWrite(PIN_FAN, LOW);
    pinMode(PIN_FAN, OUTPUT);
    ledcSetup(FAN_PWM_CHANNEL, FAN_PWM_FREQUENCY_HZ,
              FAN_PWM_RESOLUTION_BITS);
    ledcAttachPin(PIN_FAN, FAN_PWM_CHANNEL);
    ledcWrite(FAN_PWM_CHANNEL, 0);
    fanAvailable_ = true;
  }

  if (RELAY_ARMED) {
    digitalWrite(PIN_RELAY, relayLevel(false));
    pinMode(PIN_RELAY, OUTPUT);
    relayAvailable_ = true;
    writeRelay(false);
  }

  if (BUZZER_ARMED) {
    buzzerPulse_.stop();
    digitalWrite(PIN_BUZZER, LOW);
    pinMode(PIN_BUZZER, OUTPUT);
    buzzerAvailable_ = true;
  }

  if (RGB_ARMED) {
    rgbPixels_.begin();
    rgbPixels_.setBrightness(RGB_TEST_BRIGHTNESS);
    rgbPixels_.clear();
    rgbPixels_.show();
    rgbAvailable_ = true;
  }

  servoAvailable_ = SERVO_ARMED;
  return result();
}

ActuatorApplyResult ActuatorDriver::apply(const ActuatorTarget& target) {
  return apply(target, millis());
}

ActuatorApplyResult ActuatorDriver::apply(const ActuatorTarget& target,
                                          uint32_t nowMs) {
  if (!ready_) {
    return result();
  }
  writeFanPercent(target.fanPercent);
  writeServoPosition(target.servoPosition);
  writeRelay(target.relayOn);
  writeBuzzerMode(target.buzzerMode, nowMs);
  writeRgbState(target.rgbState);
  return result();
}

ActuatorApplyResult ActuatorDriver::requestBuzzerPulse(uint32_t nowMs) {
  if (!ready_ || !buzzerAvailable_) {
    return result();
  }
  buzzerMode_ = BuzzerMode::Off;
  buzzerPulse_.requestPulse(nowMs);
  digitalWrite(PIN_BUZZER, HIGH);
  buzzerOn_ = true;
  return result();
}

ActuatorApplyResult ActuatorDriver::stopBuzzer() {
  if (!buzzerAvailable_) {
    return result();
  }
  buzzerPulse_.stop();
  buzzerMode_ = BuzzerMode::Off;
  digitalWrite(PIN_BUZZER, LOW);
  buzzerOn_ = false;
  return result();
}

bool ActuatorDriver::tick(uint32_t nowMs) {
  bool changed = false;
  if (!ready_ && ACTUATORS_ARMED &&
      nowMs - bootStartedAt_ >= ACTUATOR_BOOT_GUARD_MS) {
    ready_ = true;
    if (servoAvailable_) {
      servo_.setPeriodHertz(50);
      servo_.attach(PIN_SERVO, SERVO_MIN_PULSE_US, SERVO_MAX_PULSE_US);
      servo_.write(SERVO_SAFE_ANGLE);
      servoAngle_ = SERVO_SAFE_ANGLE;
    }
    changed = true;
  }

  if (buzzerAvailable_ && buzzerPulse_.tick(nowMs)) {
    if (buzzerMode_ == BuzzerMode::Off) {
      digitalWrite(PIN_BUZZER, LOW);
      buzzerOn_ = false;
    }
    changed = true;
  }

  if (ready_ && buzzerAvailable_ &&
      buzzerMode_ == BuzzerMode::Intermittent &&
      nowMs - lastBuzzerToggleAt_ >= BUZZER_INTERMITTENT_MS) {
    lastBuzzerToggleAt_ = nowMs;
    buzzerOn_ = !buzzerOn_;
    digitalWrite(PIN_BUZZER, buzzerOn_ ? HIGH : LOW);
    changed = true;
  }
  return changed;
}

bool ActuatorDriver::ready() const {
  return ready_;
}

uint32_t ActuatorDriver::bootGuardRemainingMs(uint32_t nowMs) const {
  if (ready_ || !ACTUATORS_ARMED) {
    return 0;
  }
  const uint32_t elapsed = nowMs - bootStartedAt_;
  return elapsed >= ACTUATOR_BOOT_GUARD_MS ? 0
                                           : ACTUATOR_BOOT_GUARD_MS - elapsed;
}

uint8_t ActuatorDriver::servoAngleFor(ServoPosition position) const {
  switch (position) {
    case ServoPosition::Study:
      return SERVO_STUDY_ANGLE;
    case ServoPosition::Rest:
      return SERVO_REST_ANGLE;
    case ServoPosition::VentilationOpen:
      return SERVO_VENTILATION_ANGLE;
    case ServoPosition::Energy:
      return SERVO_ENERGY_ANGLE;
    case ServoPosition::SafetyClosed:
    case ServoPosition::Hold:
    default:
      return SERVO_SAFE_ANGLE;
  }
}

void ActuatorDriver::writeFanPercent(uint8_t percent) {
  if (!fanAvailable_) return;
  fanPercent_ = percent > 100 ? 100 : percent;
  ledcWrite(FAN_PWM_CHANNEL, fanDuty(fanPercent_));
}

void ActuatorDriver::writeServoPosition(ServoPosition position) {
  if (!servoAvailable_) return;
  servoAngle_ = servoAngleFor(position);
  servo_.write(servoAngle_);
}

void ActuatorDriver::writeRelay(bool on) {
  if (!relayAvailable_) return;
  relayOn_ = on;
  digitalWrite(PIN_RELAY, relayLevel(relayOn_));
}

void ActuatorDriver::writeBuzzerMode(BuzzerMode mode, uint32_t nowMs) {
  if (!buzzerAvailable_) return;
  if (buzzerPulse_.isOn() && mode == BuzzerMode::Off) return;
  if (buzzerMode_ == mode && mode != BuzzerMode::Intermittent) return;
  buzzerPulse_.stop();
  buzzerMode_ = mode;
  lastBuzzerToggleAt_ = nowMs;
  buzzerOn_ = mode == BuzzerMode::Alarm || mode == BuzzerMode::Intermittent;
  digitalWrite(PIN_BUZZER, buzzerOn_ ? HIGH : LOW);
}

void ActuatorDriver::writeRgbState(RgbState state) {
  if (!rgbAvailable_ || rgbState_ == state) return;
  rgbState_ = state;
  rgbPixels_.clear();
  uint32_t color = 0;
  switch (state) {
    case RgbState::Study:
      color = rgbPixels_.Color(30, 120, 255);
      break;
    case RgbState::Orange:
      color = rgbPixels_.Color(255, 80, 0);
      break;
    case RgbState::BlueLow:
      color = rgbPixels_.Color(0, 30, 120);
      break;
    case RgbState::Cyan:
      color = rgbPixels_.Color(0, 180, 160);
      break;
    case RgbState::Yellow:
      color = rgbPixels_.Color(180, 120, 0);
      break;
    case RgbState::Red:
      color = rgbPixels_.Color(255, 0, 0);
      break;
    case RgbState::Green:
      color = rgbPixels_.Color(0, 255, 0);
      break;
    case RgbState::Blue:
      color = rgbPixels_.Color(0, 0, 255);
      break;
    case RgbState::Purple:
      color = rgbPixels_.Color(130, 0, 255);
      break;
    case RgbState::Gray:
      color = rgbPixels_.Color(40, 40, 40);
      break;
    case RgbState::BlueRed:
      for (uint8_t index = 0; index < RGB_LED_COUNT; ++index) {
        rgbPixels_.setPixelColor(index, index % 2 == 0
                                           ? rgbPixels_.Color(0, 0, 255)
                                           : rgbPixels_.Color(255, 0, 0));
      }
      rgbPixels_.show();
      return;
    case RgbState::Off:
    default:
      break;
  }
  if (state != RgbState::Off) {
    rgbPixels_.fill(color);
  }
  rgbPixels_.show();
}

ActuatorApplyResult ActuatorDriver::result() const {
  ActuatorApplyResult current;
  current.state = !ACTUATORS_ARMED
                      ? ActuatorApplyState::Unarmed
                      : (ready_ ? ActuatorApplyState::FullyArmed
                                : ActuatorApplyState::BootGuard);
  current.ready = ready_;
  current.fanAvailable = fanAvailable_;
  current.fanPercent = fanPercent_;
  current.servoAvailable = servoAvailable_;
  current.servoAngle = servoAngle_;
  current.relayAvailable = relayAvailable_;
  current.relayOn = relayOn_;
  current.buzzerAvailable = buzzerAvailable_;
  current.buzzerOn = buzzerOn_;
  current.rgbAvailable = rgbAvailable_;
  current.rgbState = rgbState_;
  return current;
}

const char* actuatorApplyStateName(ActuatorApplyState state) {
  switch (state) {
    case ActuatorApplyState::BootGuard:
      return "boot-guard";
    case ActuatorApplyState::FullyArmed:
      return "fully-armed";
    case ActuatorApplyState::Unarmed:
    default:
      return "unarmed";
  }
}
