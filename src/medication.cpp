#include "medication.h"

const char* eyeToString(Eye eye) {
  switch(eye) {
    case LEFT: return "LEFT";
    case RIGHT: return "RIGHT";
    case BOTH: return "BOTH";
    default: return "UNKNOWN";
  }
}

std::vector<SessionData> getSessions(bool exocin_finished) {
  std::vector<SessionData> sessions;
  
  // MORNING SESSION
  SessionData morning;
  morning.name = "Morning";
  morning.medications = {
    {"Tacrolimus", "Tacrolimus", BOTH, false, false, true},     // 1. Both eyes, wait after
    {"Yellox", "Yellox", BOTH, false, false, true},             // 2. Both eyes, wait after
    {"Pred-Forte", "Pred-Forte", LEFT, true, false, true},      // 3. Left only, SHAKE, wait after
    {"Brinzolamide", "Brinzolamide", LEFT, true, false, true},  // 4. Left only, SHAKE, wait after
    {"Exocin", "Exocin", LEFT, false, true, true},              // 5. Left only (temporary), wait after
    {"Clinitas", "Clinitas", BOTH, false, false, false}         // 6. Both eyes, MUST BE LAST
  };
  
  // Filter out Exocin if finished
  if (exocin_finished) {
    morning.medications.erase(
      std::remove_if(morning.medications.begin(), morning.medications.end(),
        [](const Medication& m) { return m.is_temporary; }),
      morning.medications.end()
    );
  }
  
  sessions.push_back(morning);
  
  // MIDDAY SESSION (only if Exocin not finished)
  if (!exocin_finished) {
    SessionData midday;
    midday.name = "Midday";
    midday.medications = {
      {"Exocin", "Exocin", LEFT, false, true, false}
    };
    sessions.push_back(midday);
  }
  
  // EVENING SESSION
  SessionData evening;
  evening.name = "Evening";
  evening.medications = {
    {"Tacrolimus", "Tacrolimus", RIGHT, false, false, true},   // 1. Right only, wait after
    {"Yellox", "Yellox", BOTH, false, false, true},            // 2. Both eyes, wait after
    {"Pred-Forte", "Pred-Forte", LEFT, true, false, true},     // 3. Left only, SHAKE, wait after
    {"Exocin", "Exocin", LEFT, false, true, true},             // 4. Left only (temporary), wait after
    {"Clinitas", "Clinitas", BOTH, false, false, false}        // 5. Both eyes, MUST BE LAST
  };
  
  // Filter out Exocin if finished
  if (exocin_finished) {
    evening.medications.erase(
      std::remove_if(evening.medications.begin(), evening.medications.end(),
        [](const Medication& m) { return m.is_temporary; }),
      evening.medications.end()
    );
  }
  
  sessions.push_back(evening);
  
  return sessions;
}
