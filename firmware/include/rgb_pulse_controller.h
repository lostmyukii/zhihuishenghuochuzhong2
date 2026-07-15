#pragma once

#include <stdint.h>

class RgbPulseController {
 public:
  void requestPulse(uint32_t nowMs);
  void stop();
  bool tick(uint32_t nowMs);
  bool isOn() const;

 private:
  bool on_ = false;
  uint32_t startedAtMs_ = 0;
};
