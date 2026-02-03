#ifndef MEDICATION_H
#define MEDICATION_H

#include <Arduino.h>
#include <vector>

enum Eye {
  LEFT,
  RIGHT,
  BOTH
};

struct Medication {
  String name;
  String short_name;
  Eye eye;
  bool shake_required;
  bool is_temporary;  // For medications like Exocin that may be discontinued
  bool wait_after;    // True if need to wait 5 min before next drop to same eye
};

struct SessionData {
  String name;
  std::vector<Medication> medications;
};

// Function declarations
void initMedications();
std::vector<SessionData> getSessions(bool exocin_finished);
const char* eyeToString(Eye eye);

#endif
