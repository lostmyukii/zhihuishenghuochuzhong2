#pragma once

#include <Arduino.h>
#include <DHT.h>

#include "input_filter.h"
#include "project_types.h"


class SensorSampler {
 public:
  SensorSampler();

  void begin(uint32_t nowMs);
  void poll(uint32_t nowMs);
  const SensorSnapshot& snapshot() const { return snapshot_; }
  bool fastReady() const { return fastSampled_; }
  bool dhtEverValid() const { return dhtEverValid_; }
  uint32_t lastDhtSuccessAt() const { return lastDhtSuccessAt_; }

 private:
  void pollFast(uint32_t nowMs);
  void pollDht(uint32_t nowMs);
  void refreshDhtValidity(uint32_t nowMs);
  void setFastSample(SensorSample& sample, float value, uint32_t nowMs);

  DHT dht_;
  StableDigitalFilter waterFilter_;
  StableDigitalFilter flameFilter_;
  SensorSnapshot snapshot_;
  uint32_t startedAt_ = 0;
  uint32_t lastFastPollAt_ = 0;
  uint32_t lastDhtAttemptAt_ = 0;
  uint32_t lastDhtSuccessAt_ = 0;
  bool fastSampled_ = false;
  bool dhtEverValid_ = false;
};
