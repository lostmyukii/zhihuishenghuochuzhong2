#pragma once

#include "project_types.h"


class ContextEngine {
 public:
  ContextResult evaluate(const SensorSnapshot& sensors, ContextMode selectedMode) const;
  ContextResult evaluate(const SensorSnapshot& sensors, ContextMode selectedMode,
                         const RuntimeThresholds& thresholds) const;
};

const char* contextModeName(ContextMode mode);
const char* contextStatusName(ContextStatus status);
