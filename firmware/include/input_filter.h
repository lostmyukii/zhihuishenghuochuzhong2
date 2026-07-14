#pragma once

#include <stdint.h>


class StableDigitalFilter {
 public:
  StableDigitalFilter(bool triggerHigh, uint8_t confirmSamples, uint8_t recoverySamples)
      : triggerHigh_(triggerHigh),
        confirmSamples_(confirmSamples == 0 ? 1 : confirmSamples),
        recoverySamples_(recoverySamples == 0 ? 1 : recoverySamples) {}

  bool update(bool inputHigh) {
    rawHigh_ = inputHigh;
    const bool triggered = inputHigh == triggerHigh_;
    if (triggered) {
      recoveryCount_ = 0;
      if (confirmCount_ < confirmSamples_) {
        ++confirmCount_;
      }
      if (confirmCount_ >= confirmSamples_) {
        stableTriggered_ = true;
      }
    } else {
      confirmCount_ = 0;
      if (recoveryCount_ < recoverySamples_) {
        ++recoveryCount_;
      }
      if (recoveryCount_ >= recoverySamples_) {
        stableTriggered_ = false;
      }
    }
    return stableTriggered_;
  }

  bool stableTriggered() const { return stableTriggered_; }
  bool rawHigh() const { return rawHigh_; }
  uint8_t confirmCount() const { return confirmCount_; }
  uint8_t recoveryCount() const { return recoveryCount_; }

 private:
  bool triggerHigh_;
  uint8_t confirmSamples_;
  uint8_t recoverySamples_;
  bool rawHigh_ = false;
  bool stableTriggered_ = false;
  uint8_t confirmCount_ = 0;
  uint8_t recoveryCount_ = 0;
};
