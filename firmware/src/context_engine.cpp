#include "context_engine.h"

#include "project_config.h"

namespace {

struct ModelScore {
  ContextMode mode = ContextMode::Detect;
  uint16_t totalWeight = 0;
  uint16_t validWeight = 0;
  uint16_t matchedWeight = 0;
  bool requiredValid = true;
  uint8_t coverage = 0;
  uint8_t match = 0;
  EvidenceList supporting;
  EvidenceList opposing;
  EvidenceList missing;
};

uint8_t roundedPercent(uint16_t numerator, uint16_t denominator) {
  if (denominator == 0) {
    return 0;
  }
  return static_cast<uint8_t>((numerator * 100U + denominator / 2U) / denominator);
}

void addEvidence(ModelScore& score, bool valid, bool matched, uint8_t weight,
                 bool required, const char* supportCode, const char* opposeCode,
                 const char* missingCode) {
  score.totalWeight += weight;
  if (!valid) {
    score.missing.add(missingCode);
    if (required) {
      score.requiredValid = false;
    }
    return;
  }

  score.validWeight += weight;
  if (matched) {
    score.matchedWeight += weight;
    score.supporting.add(supportCode);
  } else {
    score.opposing.add(opposeCode);
  }
}

void finishScore(ModelScore& score) {
  score.coverage = roundedPercent(score.validWeight, score.totalWeight);
  score.match = roundedPercent(score.matchedWeight, score.validWeight);
}

bool comfortableDht(const SensorSnapshot& sensors) {
  return sensors.temperature.value >= 18.0F && sensors.temperature.value <= 30.0F &&
         sensors.humidity.value >= 30.0F && sensors.humidity.value <= 75.0F;
}

bool dhtValid(const SensorSnapshot& sensors) {
  return sensors.temperature.valid && sensors.humidity.valid;
}

ModelScore evaluateStudy(const SensorSnapshot& sensors) {
  ModelScore score;
  score.mode = ContextMode::Study;
  addEvidence(score, sensors.pir.valid, sensors.pir.value >= 0.5F, 3, true,
              "pir_active", "no_occupancy", "pir_missing");
  addEvidence(score, sensors.light.valid,
              sensors.light.value >= PROVISIONAL_LIGHT_BRIGHT_RAW, 2, false,
              "light_suitable", "light_not_suitable", "light_missing");
  addEvidence(score, sensors.sound.valid,
              sensors.sound.value <= PROVISIONAL_SOUND_STUDY_MAX_RAW, 3, true,
              "sound_study_quiet", "sound_high", "sound_missing");
  addEvidence(score, dhtValid(sensors), comfortableDht(sensors), 1, false,
              "dht_comfortable", "dht_outside_comfort", "dht_missing");
  finishScore(score);
  return score;
}

ModelScore evaluateRest(const SensorSnapshot& sensors) {
  ModelScore score;
  score.mode = ContextMode::Rest;
  addEvidence(score, sensors.sound.valid,
              sensors.sound.value <= PROVISIONAL_SOUND_QUIET_MAX_RAW, 3, true,
              "sound_quiet", "sound_high", "sound_missing");
  addEvidence(score, sensors.light.valid,
              sensors.light.value <= PROVISIONAL_LIGHT_DIM_RAW, 3, true,
              "light_dim", "light_too_bright", "light_missing");
  addEvidence(score, sensors.pir.valid, sensors.pir.value < 0.5F, 2, false,
              "activity_low", "pir_active", "pir_missing");
  addEvidence(score, dhtValid(sensors), comfortableDht(sensors), 1, false,
              "dht_comfortable", "dht_outside_comfort", "dht_missing");
  finishScore(score);
  return score;
}

ModelScore evaluateVentilation(const SensorSnapshot& sensors) {
  ModelScore score;
  score.mode = ContextMode::Ventilation;
  addEvidence(score, sensors.temperature.valid,
              sensors.temperature.value >= PROVISIONAL_TEMPERATURE_HIGH_C, 3, true,
              "temperature_high", "temperature_not_high", "temperature_missing");
  addEvidence(score, sensors.humidity.valid,
              sensors.humidity.value >= PROVISIONAL_HUMIDITY_HIGH_PERCENT, 3, true,
              "humidity_high", "humidity_not_high", "humidity_missing");
  addEvidence(score, sensors.pir.valid, sensors.pir.value >= 0.5F, 2, false,
              "pir_active", "no_occupancy", "pir_missing");
  finishScore(score);
  return score;
}

ModelScore evaluateEnergy(const SensorSnapshot& sensors) {
  ModelScore score;
  score.mode = ContextMode::Energy;
  addEvidence(score, sensors.pir.valid, sensors.pir.value < 0.5F, 4, true,
              "no_occupancy", "pir_active", "pir_missing");
  addEvidence(score, sensors.light.valid,
              sensors.light.value >= PROVISIONAL_LIGHT_BRIGHT_RAW, 2, false,
              "daylight_available", "light_not_suitable", "light_missing");
  addEvidence(score, sensors.sound.valid,
              sensors.sound.value <= PROVISIONAL_SOUND_QUIET_MAX_RAW, 1, false,
              "sound_quiet", "sound_high", "sound_missing");
  finishScore(score);
  return score;
}

bool eligible(const ModelScore& score) {
  return score.requiredValid && score.coverage >= CONTEXT_MIN_COVERAGE;
}

void copyEvidence(ContextResult& result, const ModelScore& score) {
  result.supporting = score.supporting;
  result.opposing = score.opposing;
  result.missing = score.missing;
}

}  // namespace

ContextResult ContextEngine::evaluate(const SensorSnapshot& sensors,
                                      ContextMode selectedMode) const {
  ContextResult result;
  if (selectedMode == ContextMode::Custom) {
    result.candidate = ContextMode::Custom;
    result.status = ContextStatus::EvidenceMissing;
    result.missing.add("custom_rule_unconfigured");
    return result;
  }

  const bool anyContextSensor = sensors.light.valid || sensors.sound.valid ||
                                sensors.temperature.valid || sensors.humidity.valid ||
                                sensors.pir.valid;
  if (!anyContextSensor) {
    result.status = ContextStatus::Unknown;
    result.missing.add("all_context_sensors_missing");
    return result;
  }

  ModelScore scores[] = {evaluateStudy(sensors), evaluateRest(sensors),
                         evaluateVentilation(sensors), evaluateEnergy(sensors)};
  int bestIndex = -1;
  int secondIndex = -1;
  int bestMissingIndex = 0;

  for (int index = 0; index < 4; ++index) {
    if (scores[index].coverage > scores[bestMissingIndex].coverage ||
        (scores[index].coverage == scores[bestMissingIndex].coverage &&
         scores[index].match > scores[bestMissingIndex].match)) {
      bestMissingIndex = index;
    }
    if (!eligible(scores[index])) {
      continue;
    }
    if (bestIndex < 0 || scores[index].match > scores[bestIndex].match) {
      secondIndex = bestIndex;
      bestIndex = index;
    } else if (secondIndex < 0 || scores[index].match > scores[secondIndex].match) {
      secondIndex = index;
    }
  }

  if (bestIndex < 0) {
    const ModelScore& incomplete = scores[bestMissingIndex];
    result.candidate = incomplete.mode;
    result.status = ContextStatus::EvidenceMissing;
    result.coverage = incomplete.coverage;
    result.match = incomplete.match;
    copyEvidence(result, incomplete);
    return result;
  }

  const ModelScore& best = scores[bestIndex];
  result.candidate = best.mode;
  result.coverage = best.coverage;
  result.match = best.match;
  copyEvidence(result, best);

  if (best.match < CONTEXT_MATCH_THRESHOLD) {
    result.status = ContextStatus::Unknown;
    return result;
  }
  if (secondIndex >= 0 &&
      best.match - scores[secondIndex].match < CONTEXT_AMBIGUITY_GAP) {
    result.status = ContextStatus::Ambiguous;
    return result;
  }
  result.status = ContextStatus::Possible;
  return result;
}

const char* contextModeName(ContextMode mode) {
  switch (mode) {
    case ContextMode::Study:
      return "study";
    case ContextMode::Rest:
      return "rest";
    case ContextMode::Ventilation:
      return "ventilation";
    case ContextMode::Energy:
      return "energy";
    case ContextMode::Custom:
      return "custom";
    case ContextMode::Detect:
    default:
      return "detect";
  }
}

const char* contextStatusName(ContextStatus status) {
  switch (status) {
    case ContextStatus::Possible:
      return "possible";
    case ContextStatus::Ambiguous:
      return "ambiguous";
    case ContextStatus::EvidenceMissing:
      return "evidence_missing";
    case ContextStatus::Confirmed:
      return "confirmed";
    case ContextStatus::Corrected:
      return "corrected";
    case ContextStatus::Unknown:
    default:
      return "unknown";
  }
}
