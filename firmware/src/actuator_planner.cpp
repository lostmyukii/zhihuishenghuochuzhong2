#include "actuator_planner.h"

#include "project_config.h"

namespace {

bool dhtValid(const SensorSnapshot& sensors) {
  return sensors.temperature.valid && sensors.humidity.valid;
}

bool dhtHigh(const SensorSnapshot& sensors,
             const RuntimeThresholds& thresholds) {
  return dhtValid(sensors) &&
         (sensors.temperature.value >= thresholds.temperatureThreshold ||
          sensors.humidity.value >= thresholds.humidityThreshold);
}

void applyOverride(ActuatorTarget& target, const ActuatorOverride& overrideTarget) {
  if (overrideTarget.fan) {
    target.fanPercent = overrideTarget.target.fanPercent;
  }
  if (overrideTarget.servo) {
    target.servoPosition = overrideTarget.target.servoPosition;
  }
  if (overrideTarget.relay) {
    target.relayOn = overrideTarget.target.relayOn;
  }
  if (overrideTarget.buzzer) {
    target.buzzerMode = overrideTarget.target.buzzerMode;
  }
  if (overrideTarget.rgb) {
    target.rgbState = overrideTarget.target.rgbState;
  }
}

}  // namespace

ActuatorTarget ActuatorPlanner::normalTarget(ContextMode mode,
                                              const SensorSnapshot& sensors,
                                              const ContextResult& context) const {
  return normalTarget(mode, sensors, context, RuntimeThresholds{});
}

ActuatorTarget ActuatorPlanner::normalTarget(
    ContextMode mode, const SensorSnapshot& sensors, const ContextResult&,
    const RuntimeThresholds& thresholds) const {
  ActuatorTarget target;
  switch (mode) {
    case ContextMode::Study:
      target.servoPosition = ServoPosition::Study;
      target.rgbState = RgbState::Study;
      if (sensors.pir.valid && sensors.pir.value >= 0.5F && sensors.light.valid &&
          sensors.light.value <= PROVISIONAL_LIGHT_DIM_RAW) {
        target.relayOn = true;
      }
      if (sensors.sound.valid &&
          sensors.sound.value > thresholds.soundThreshold) {
        target.rgbState = RgbState::Orange;
      }
      if (dhtHigh(sensors, thresholds)) {
        target.fanPercent = FAN_LOW_PERCENT;
        target.servoPosition = ServoPosition::VentilationOpen;
      }
      return target;

    case ContextMode::Rest:
      target.servoPosition = ServoPosition::Rest;
      target.rgbState = RgbState::BlueLow;
      if (dhtHigh(sensors, thresholds)) {
        target.fanPercent = FAN_LOW_PERCENT;
      }
      return target;

    case ContextMode::Ventilation:
      if (!dhtValid(sensors)) {
        target.rgbState = RgbState::Gray;
        return target;
      }
      target.fanPercent = dhtHigh(sensors, thresholds)
                              ? FAN_VENTILATION_PERCENT
                              : FAN_LOW_PERCENT;
      target.servoPosition = ServoPosition::VentilationOpen;
      target.rgbState = RgbState::Cyan;
      return target;

    case ContextMode::Energy:
      target.servoPosition = ServoPosition::Energy;
      return target;

    case ContextMode::Custom:
    case ContextMode::Detect:
    default:
      return target;
  }
}

ActuatorPlan ActuatorPlanner::plan(ContextMode mode, const SensorSnapshot& sensors,
                                    const ContextResult& context,
                                    const SafetyResult& safety,
                                    bool buzzerEnabled) const {
  return plan(mode, sensors, context, safety, buzzerEnabled,
              RuntimeThresholds{});
}

ActuatorPlan ActuatorPlanner::plan(
    ContextMode mode, const SensorSnapshot& sensors,
    const ContextResult& context, const SafetyResult& safety,
    bool buzzerEnabled, const RuntimeThresholds& thresholds) const {
  ActuatorPlan result;
  result.normalTarget = normalTarget(mode, sensors, context, thresholds);
  result.finalTarget = result.normalTarget;
  result.safety = safety;
  applyOverride(result.finalTarget, safety.overrideTarget);

  result.buzzerMuted = safety.buzzerRequested && !buzzerEnabled;
  if (result.buzzerMuted) {
    result.finalTarget.buzzerMode = BuzzerMode::Off;
  }
  return result;
}

const char* servoPositionName(ServoPosition position) {
  switch (position) {
    case ServoPosition::Study:
      return "study";
    case ServoPosition::Rest:
      return "rest";
    case ServoPosition::VentilationOpen:
      return "ventilation-open";
    case ServoPosition::Energy:
      return "energy";
    case ServoPosition::SafetyClosed:
      return "safety-closed";
    case ServoPosition::Hold:
    default:
      return "hold";
  }
}

const char* buzzerModeName(BuzzerMode mode) {
  switch (mode) {
    case BuzzerMode::Alarm:
      return "alarm";
    case BuzzerMode::Intermittent:
      return "intermittent";
    case BuzzerMode::Off:
    default:
      return "off";
  }
}

const char* rgbStateName(RgbState state) {
  switch (state) {
    case RgbState::Study:
      return "study";
    case RgbState::Orange:
      return "orange";
    case RgbState::BlueLow:
      return "blue-low";
    case RgbState::Cyan:
      return "cyan";
    case RgbState::Yellow:
      return "yellow";
    case RgbState::Red:
      return "red";
    case RgbState::Green:
      return "green";
    case RgbState::Blue:
      return "blue";
    case RgbState::Purple:
      return "purple";
    case RgbState::BlueRed:
      return "blue-red";
    case RgbState::Gray:
      return "gray";
    case RgbState::Off:
    default:
      return "off";
  }
}
