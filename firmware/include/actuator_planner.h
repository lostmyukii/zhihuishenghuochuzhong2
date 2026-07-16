#pragma once

#include "project_types.h"

class ActuatorPlanner {
 public:
  ActuatorTarget normalTarget(ContextMode mode, const SensorSnapshot& sensors,
                              const ContextResult& context) const;
  ActuatorTarget normalTarget(ContextMode mode, const SensorSnapshot& sensors,
                              const ContextResult& context,
                              const RuntimeThresholds& thresholds) const;
  ActuatorPlan plan(ContextMode mode, const SensorSnapshot& sensors,
                    const ContextResult& context, const SafetyResult& safety,
                    bool buzzerEnabled) const;
  ActuatorPlan plan(ContextMode mode, const SensorSnapshot& sensors,
                    const ContextResult& context, const SafetyResult& safety,
                    bool buzzerEnabled,
                    const RuntimeThresholds& thresholds) const;
};

const char* servoPositionName(ServoPosition position);
const char* buzzerModeName(BuzzerMode mode);
const char* rgbStateName(RgbState state);
