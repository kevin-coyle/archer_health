#include <Arduino.h>
#include <LovyanGFX.hpp>
#include <Preferences.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "medication.h"

// WiFi credentials
const char* WIFI_SSID = "electrosoft";
const char* WIFI_PASS = "beagleboat87!";

// Dashboard server
const char* DASHBOARD_HOST = "192.168.1.184";
const int DASHBOARD_PORT = 3000;
String currentSessionId = "";

// Display configuration for ESP32-2424S012
class LGFX : public lgfx::LGFX_Device
{
  lgfx::Panel_GC9A01 _panel_instance;
  lgfx::Bus_SPI _bus_instance;
  lgfx::Touch_CST816S _touch_instance;

public:
  LGFX(void)
  {
    {
      auto cfg = _bus_instance.config();
      cfg.spi_host = SPI2_HOST;
      cfg.spi_mode = 0;
      cfg.freq_write = 80000000;
      cfg.freq_read = 20000000;
      cfg.spi_3wire = true;
      cfg.use_lock = true;
      cfg.dma_channel = SPI_DMA_CH_AUTO;
      cfg.pin_sclk = 6;
      cfg.pin_mosi = 7;
      cfg.pin_miso = -1;
      cfg.pin_dc = 2;
      _bus_instance.config(cfg);
      _panel_instance.setBus(&_bus_instance);
    }

    {
      auto cfg = _panel_instance.config();
      cfg.pin_cs = 10;
      cfg.pin_rst = -1;
      cfg.pin_busy = -1;
      cfg.panel_width = 240;
      cfg.panel_height = 240;
      cfg.offset_x = 0;
      cfg.offset_y = 0;
      cfg.offset_rotation = 0;
      cfg.dummy_read_pixel = 8;
      cfg.dummy_read_bits = 1;
      cfg.readable = false;
      cfg.invert = true;
      cfg.rgb_order = false;
      cfg.dlen_16bit = false;
      cfg.bus_shared = false;
      _panel_instance.config(cfg);
    }

    {
      auto cfg = _touch_instance.config();
      cfg.x_min = 0;
      cfg.x_max = 239;
      cfg.y_min = 0;
      cfg.y_max = 239;
      cfg.pin_int = 0;
      cfg.pin_rst = 1;
      cfg.bus_shared = false;
      cfg.offset_rotation = 0;
      cfg.i2c_port = 0;
      cfg.i2c_addr = 0x15;
      cfg.pin_sda = 4;
      cfg.pin_scl = 5;
      cfg.freq = 400000;
      _touch_instance.config(cfg);
      _panel_instance.setTouch(&_touch_instance);
    }

    setPanel(&_panel_instance);
  }
};

LGFX tft;
Preferences prefs;

// Application state
enum AppState {
  SESSION_SELECT,
  MEDICATION_DISPLAY,
  TIMER_COUNTDOWN,
  SESSION_COMPLETE,
  INSULIN_DOSE_SELECT,
  INSULIN_MEAL_SELECT,
  INSULIN_CONFIRM,
  INSULIN_LOGGED
};

AppState currentState = SESSION_SELECT;
std::vector<SessionData> sessions;
int selectedSession = 0;
int currentMedIndex = 0;
unsigned long waitTimerStart = 0;
unsigned long sessionStartTime = 0;
const unsigned long WAIT_TIME_MS = 5 * 60 * 1000; // 5 minutes
bool exocinFinished = false;

// Track which sessions are completed today
bool sessionCompleted[3] = {false, false, false};
bool lastSyncOk = false;

// Insulin dose state
float insulinDose = 10.0;
const char* insulinMeal = "morning";

// Touch regions
struct TouchRegion {
  int x, y, w, h;
  bool contains(int tx, int ty) {
    return tx >= x && tx < x + w && ty >= y && ty < y + h;
  }
};

TouchRegion btnDone = {45, 170, 150, 40};
TouchRegion btnSession[3] = {
  {45, 70, 150, 34},
  {45, 108, 150, 34},
  {45, 146, 150, 34}
};
TouchRegion btnInsulin = {45, 184, 150, 34};
TouchRegion btnSettings = {100, 222, 40, 18};
TouchRegion btnSkip = {70, 150, 100, 32};

// Insulin screen touch regions
TouchRegion btnDoseMinus = {30, 100, 60, 50};
TouchRegion btnDosePlus = {150, 100, 60, 50};
TouchRegion btnInsulinNext = {55, 175, 130, 40};
TouchRegion btnMealMorning = {30, 90, 85, 45};
TouchRegion btnMealEvening = {125, 90, 85, 45};
TouchRegion btnInsulinConfirm = {55, 165, 130, 40};
TouchRegion btnInsulinBack = {75, 200, 90, 28};

// Generate a simple session ID from millis
String makeSessionId() {
  char buf[16];
  snprintf(buf, sizeof(buf), "%lu", millis());
  return String(buf);
}

// Fire-and-forget POST to dashboard
void postEvent(const char* eventType, const char* medName = nullptr,
               const char* medEye = nullptr, int medIdx = -1,
               int medTotal = -1, int elapsedSec = -1) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("postEvent skipped (%s): WiFi not connected (status=%d)\n",
                  eventType, WiFi.status());
    return;
  }
  Serial.printf("postEvent: %s (WiFi OK, IP=%s)\n", eventType,
                WiFi.localIP().toString().c_str());

  HTTPClient http;
  String url = String("http://") + DASHBOARD_HOST + ":" + String(DASHBOARD_PORT) + "/api/events";
  http.begin(url);
  http.setConnectTimeout(2000);
  http.setTimeout(2000);
  http.addHeader("Content-Type", "application/json");

  String json = "{\"event_type\":\"" + String(eventType) + "\"";
  json += ",\"session_name\":\"" + sessions[selectedSession].name + "\"";
  json += ",\"session_id\":\"" + currentSessionId + "\"";
  if (medName) json += ",\"medication_name\":\"" + String(medName) + "\"";
  if (medEye) json += ",\"medication_eye\":\"" + String(medEye) + "\"";
  if (medIdx >= 0) json += ",\"med_index\":" + String(medIdx);
  if (medTotal >= 0) json += ",\"med_total\":" + String(medTotal);
  if (elapsedSec >= 0) json += ",\"elapsed_sec\":" + String(elapsedSec);
  json += "}";

  int code = http.POST(json);
  if (code > 0) {
    Serial.printf("Event posted: %s (%d)\n", eventType, code);
  } else {
    Serial.printf("Post failed: %s\n", http.errorToString(code).c_str());
  }
  http.end();
}

// POST insulin dose to dashboard
void postInsulinDose(float units, const char* mealTime) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("postInsulinDose skipped: WiFi not connected");
    return;
  }

  HTTPClient http;
  String url = String("http://") + DASHBOARD_HOST + ":" + String(DASHBOARD_PORT) + "/api/glucose/insulin";
  http.begin(url);
  http.setConnectTimeout(3000);
  http.setTimeout(3000);
  http.addHeader("Content-Type", "application/json");

  String json = "{\"dose_units\":" + String(units, 1) +
                ",\"meal_time\":\"" + String(mealTime) + "\"" +
                ",\"notes\":\"logged from ESP32\"}";

  int code = http.POST(json);
  if (code > 0) {
    Serial.printf("Insulin dose posted: %.1f IU (%s) -> %d\n", units, mealTime, code);
  } else {
    Serial.printf("Insulin post failed: %s\n", http.errorToString(code).c_str());
  }
  http.end();
}

// Check dashboard for an incomplete session to resume
bool checkResume(int sessionIdx) {
  // Wait briefly for WiFi if it's still connecting
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Waiting for WiFi before resume check...");
    for (int i = 0; i < 30 && WiFi.status() != WL_CONNECTED; i++) {
      delay(100);
    }
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi not connected, skipping resume check");
      return false;
    }
  }

  HTTPClient http;
  String url = String("http://") + DASHBOARD_HOST + ":" + String(DASHBOARD_PORT)
             + "/api/resume?session_name=" + sessions[sessionIdx].name;
  http.begin(url);
  http.setConnectTimeout(2000);
  http.setTimeout(2000);

  int code = http.GET();
  if (code != 200) {
    http.end();
    return false;
  }

  String payload = http.getString();
  http.end();

  JsonDocument doc;
  if (deserializeJson(doc, payload)) return false;

  bool found = doc["found"] | false;
  if (!found) return false;

  int resumeIndex = doc["resume_index"] | 0;
  int medTotal = doc["med_total"] | 0;
  const char* sid = doc["session_id"];

  if (resumeIndex <= 0 || resumeIndex >= medTotal || !sid) return false;

  currentMedIndex = resumeIndex;
  currentSessionId = String(sid);
  sessionStartTime = millis();
  Serial.printf("Resuming session %s at med %d/%d (id=%s)\n",
                sessions[sessionIdx].name.c_str(), resumeIndex, medTotal, sid);
  return true;
}

// Fetch which sessions are already completed today
void fetchCompletedSessions() {
  // Reset all to false
  for (int i = 0; i < 3; i++) sessionCompleted[i] = false;
  lastSyncOk = false;

  // Wait briefly for WiFi if still connecting
  if (WiFi.status() != WL_CONNECTED) {
    for (int i = 0; i < 30 && WiFi.status() != WL_CONNECTED; i++) {
      delay(100);
    }
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("Sync failed: WiFi not connected");
      return;
    }
  }

  HTTPClient http;
  String url = String("http://") + DASHBOARD_HOST + ":" + String(DASHBOARD_PORT)
             + "/api/calendar?days=1";
  http.begin(url);
  http.setConnectTimeout(3000);
  http.setTimeout(3000);

  int code = http.GET();
  if (code != 200) {
    Serial.printf("Sync failed: HTTP %d\n", code);
    http.end();
    return;
  }

  String payload = http.getString();
  http.end();

  JsonDocument doc;
  if (deserializeJson(doc, payload)) {
    Serial.println("Sync failed: JSON parse error");
    return;
  }

  lastSyncOk = true;

  // calendar returns an array; today is index 0
  JsonObject today = doc[0]["sessions"];
  if (today.isNull()) return;

  for (int i = 0; i < sessions.size() && i < 3; i++) {
    JsonObject sess = today[sessions[i].name];
    if (!sess.isNull() && sess["status"] == "complete") {
      sessionCompleted[i] = true;
      Serial.printf("Session %s already completed today\n", sessions[i].name.c_str());
    }
  }
}

void initWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.println("WiFi connecting...");
}

void setup()
{
    Serial.begin(115200);
    delay(100);
    Serial.println("Dog Eye Drop Timer Starting...");

    // Initialize preferences
    prefs.begin("eyedrops", false);
    exocinFinished = prefs.getBool("exocin_done", false);
    
    // Get sessions based on Exocin status
    sessions = getSessions(exocinFinished);

    // Turn on backlight with PWM
    pinMode(3, OUTPUT);
    ledcSetup(0, 5000, 8);
    ledcAttachPin(3, 0);
    ledcWrite(0, 200);  // ~78% brightness
    
    delay(100);

    // Initialize display
    tft.init();
    tft.setRotation(0);
    tft.fillScreen(TFT_BLACK);
    tft.setTextColor(TFT_WHITE);

    // Initialize WiFi (non-blocking)
    initWiFi();

    Serial.println("Setup complete!");
}

void drawInsulinDoseSelect() {
  tft.fillScreen(TFT_BLACK);

  // Title
  tft.setTextSize(2);
  tft.setTextDatum(middle_center);
  tft.setTextColor(TFT_CYAN);
  tft.drawString("INSULIN DOSE", 120, 45);

  // Minus button
  tft.fillRoundRect(btnDoseMinus.x, btnDoseMinus.y, btnDoseMinus.w, btnDoseMinus.h, 8, TFT_RED);
  tft.setTextSize(3);
  tft.setTextColor(TFT_WHITE);
  tft.setTextDatum(middle_center);
  tft.drawString("-", btnDoseMinus.x + 30, btnDoseMinus.y + 25);

  // Dose value
  char doseStr[10];
  snprintf(doseStr, sizeof(doseStr), "%.0f", insulinDose);
  tft.setTextSize(4);
  tft.setTextColor(TFT_WHITE);
  tft.drawString(doseStr, 120, 125);
  tft.setTextSize(2);
  tft.drawString("IU", 120, 155);

  // Plus button
  tft.fillRoundRect(btnDosePlus.x, btnDosePlus.y, btnDosePlus.w, btnDosePlus.h, 8, TFT_GREEN);
  tft.setTextSize(3);
  tft.setTextColor(TFT_BLACK);
  tft.drawString("+", btnDosePlus.x + 30, btnDosePlus.y + 25);

  // Next button
  tft.fillRoundRect(btnInsulinNext.x, btnInsulinNext.y, btnInsulinNext.w, btnInsulinNext.h, 8, TFT_BLUE);
  tft.setTextSize(2);
  tft.setTextColor(TFT_WHITE);
  tft.setTextDatum(middle_center);
  tft.drawString("NEXT", 120, btnInsulinNext.y + 20);

  // Back label
  tft.setTextSize(1);
  tft.setTextColor(TFT_DARKGREY);
  tft.drawString("tap below to cancel", 120, 222);
}

void drawInsulinMealSelect() {
  tft.fillScreen(TFT_BLACK);

  // Title
  tft.setTextSize(2);
  tft.setTextDatum(middle_center);
  tft.setTextColor(TFT_CYAN);
  tft.drawString("MEAL TIME", 120, 45);

  // Show selected dose
  char doseStr[16];
  snprintf(doseStr, sizeof(doseStr), "%.0f IU", insulinDose);
  tft.setTextSize(1);
  tft.setTextColor(TFT_DARKGREY);
  tft.drawString(doseStr, 120, 70);

  // Morning button
  bool isMorning = strcmp(insulinMeal, "morning") == 0;
  tft.fillRoundRect(btnMealMorning.x, btnMealMorning.y, btnMealMorning.w, btnMealMorning.h, 8,
                     isMorning ? TFT_ORANGE : TFT_DARKGREY);
  tft.setTextSize(2);
  tft.setTextColor(isMorning ? TFT_BLACK : TFT_WHITE);
  tft.setTextDatum(middle_center);
  tft.drawString("AM", btnMealMorning.x + 42, btnMealMorning.y + 15);
  tft.setTextSize(1);
  tft.drawString("11am", btnMealMorning.x + 42, btnMealMorning.y + 35);

  // Evening button
  bool isEvening = strcmp(insulinMeal, "evening") == 0;
  tft.fillRoundRect(btnMealEvening.x, btnMealEvening.y, btnMealEvening.w, btnMealEvening.h, 8,
                     isEvening ? TFT_PURPLE : TFT_DARKGREY);
  tft.setTextSize(2);
  tft.setTextColor(isEvening ? TFT_WHITE : TFT_WHITE);
  tft.setTextDatum(middle_center);
  tft.drawString("PM", btnMealEvening.x + 42, btnMealEvening.y + 15);
  tft.setTextSize(1);
  tft.drawString("6pm", btnMealEvening.x + 42, btnMealEvening.y + 35);

  // Confirm button
  tft.fillRoundRect(btnInsulinConfirm.x, btnInsulinConfirm.y, btnInsulinConfirm.w, btnInsulinConfirm.h, 8, TFT_GREEN);
  tft.setTextSize(2);
  tft.setTextColor(TFT_BLACK);
  tft.setTextDatum(middle_center);
  tft.drawString("LOG DOSE", 120, btnInsulinConfirm.y + 20);

  // Back button
  tft.fillRoundRect(btnInsulinBack.x, btnInsulinBack.y, btnInsulinBack.w, btnInsulinBack.h, 5, TFT_DARKGREY);
  tft.setTextSize(1);
  tft.setTextColor(TFT_WHITE);
  tft.drawString("BACK", 120, btnInsulinBack.y + 14);
}

void drawInsulinLogged() {
  tft.fillScreen(TFT_BLACK);

  tft.setTextSize(3);
  tft.setTextDatum(middle_center);
  tft.setTextColor(TFT_GREEN);
  tft.drawString("LOGGED!", 120, 80);

  char doseStr[20];
  snprintf(doseStr, sizeof(doseStr), "%.0f IU", insulinDose);
  tft.setTextSize(2);
  tft.setTextColor(TFT_WHITE);
  tft.drawString(doseStr, 120, 120);
  tft.drawString(strcmp(insulinMeal, "morning") == 0 ? "Morning" : "Evening", 120, 148);

  tft.setTextSize(1);
  tft.setTextColor(TFT_DARKGREY);
  tft.drawString("Tap to return", 120, 190);
}

void drawSessionSelect() {
  fetchCompletedSessions();

  tft.fillScreen(TFT_BLACK);
  tft.setTextSize(2);
  tft.setTextDatum(middle_center);
  tft.drawString("SELECT SESSION", 120, 50);

  // Draw session buttons (centered for circular display)
  for (int i = 0; i < sessions.size(); i++) {
    if (sessionCompleted[i]) {
      // Completed: dim button with checkmark
      tft.fillRoundRect(btnSession[i].x, btnSession[i].y, btnSession[i].w, btnSession[i].h, 8, 0x2104); // very dark grey
      tft.setTextColor(0x6B6D); // mid grey text
      tft.setTextSize(2);
      tft.setTextDatum(middle_center);
      tft.drawString(sessions[i].name, 110, btnSession[i].y + 18);
      // Draw checkmark
      tft.setTextColor(TFT_GREEN);
      tft.setTextSize(2);
      tft.drawString("ok", 180, btnSession[i].y + 18);
      tft.setTextColor(TFT_WHITE); // reset
    } else {
      tft.fillRoundRect(btnSession[i].x, btnSession[i].y, btnSession[i].w, btnSession[i].h, 8, TFT_DARKGREY);
      tft.setTextSize(2);
      tft.setTextDatum(middle_center);
      tft.drawString(sessions[i].name, 120, btnSession[i].y + 18);
    }
  }

  // Insulin dose button
  tft.fillRoundRect(btnInsulin.x, btnInsulin.y, btnInsulin.w, btnInsulin.h, 8, TFT_CYAN);
  tft.setTextSize(2);
  tft.setTextDatum(middle_center);
  tft.setTextColor(TFT_BLACK);
  tft.drawString("INSULIN", 120, btnInsulin.y + 17);
  tft.setTextColor(TFT_WHITE);

  // Draw settings button (small, bottom)
  tft.fillRoundRect(btnSettings.x, btnSettings.y, btnSettings.w, btnSettings.h, 5, TFT_BLUE);
  tft.setTextSize(1);
  tft.setTextDatum(middle_center);
  tft.drawString("SET", 120, btnSettings.y + 9);

  // Sync status indicator
  if (!lastSyncOk) {
    tft.setTextSize(1);
    tft.setTextDatum(middle_center);
    tft.setTextColor(TFT_RED);
    tft.drawString("NOT SYNCED", 120, 68);
    tft.setTextColor(TFT_WHITE);
  } else {
    tft.fillCircle(50, 50, 5, TFT_GREEN);
  }
}

void drawMedication() {
  if (currentMedIndex >= sessions[selectedSession].medications.size()) {
    currentState = SESSION_COMPLETE;
    return;
  }

  Medication& med = sessions[selectedSession].medications[currentMedIndex];

  tft.fillScreen(TFT_BLACK);

  // Progress indicator (pulled inward for circular display)
  tft.setTextSize(1);
  tft.setTextDatum(top_right);
  char progress[20];
  snprintf(progress, sizeof(progress), "%d/%d", currentMedIndex + 1,
           sessions[selectedSession].medications.size());
  tft.drawString(progress, 190, 40);

  // Medication name
  tft.setTextSize(2);
  tft.setTextDatum(middle_center);
  tft.drawString(med.short_name, 120, 55);

  // Eye indicator with visual distinction (inset from edges for circle)
  tft.setTextSize(3);
  tft.setTextDatum(middle_center);
  if (med.eye == LEFT) {
    tft.fillRoundRect(20, 75, 100, 50, 8, TFT_DARKGREEN);
    tft.setTextColor(TFT_WHITE);
    tft.drawString("LEFT", 70, 100);
    tft.setTextColor(TFT_DARKGREY);
    tft.drawString("RIGHT", 170, 100);
  } else if (med.eye == RIGHT) {
    tft.fillRoundRect(120, 75, 100, 50, 8, TFT_DARKGREEN);
    tft.setTextColor(TFT_DARKGREY);
    tft.drawString("LEFT", 70, 100);
    tft.setTextColor(TFT_WHITE);
    tft.drawString("RIGHT", 170, 100);
  } else { // BOTH
    tft.fillRoundRect(20, 75, 200, 50, 8, TFT_DARKGREEN);
    tft.setTextColor(TFT_WHITE);
    tft.drawString("BOTH", 120, 100);
  }

  tft.setTextColor(TFT_WHITE);

  // Shake warning if needed
  if (med.shake_required) {
    tft.setTextSize(2);
    tft.setTextDatum(middle_center);
    tft.setTextColor(TFT_YELLOW);
    tft.drawString("! SHAKE FIRST !", 120, 145);
    tft.setTextColor(TFT_WHITE);
  }

  // Done button
  tft.fillRoundRect(btnDone.x, btnDone.y, btnDone.w, btnDone.h, 8, TFT_GREEN);
  tft.setTextSize(2);
  tft.setTextDatum(middle_center);
  tft.setTextColor(TFT_BLACK);
  tft.drawString("TAP DONE", 120, 190);
  tft.setTextColor(TFT_WHITE);
}

int timerLastSeconds = -1;
int timerLastProgress = -1;
bool timerScreenDrawn = false;

void resetTimerState() {
  timerScreenDrawn = false;
  timerLastSeconds = -1;
  timerLastProgress = -1;
}

void drawTimer() {
  
  unsigned long elapsed = millis() - waitTimerStart;

  if (elapsed >= WAIT_TIME_MS) {
    // Timer complete - flash screen and move to next
    tft.fillScreen(TFT_WHITE);
    delay(100);
    tft.fillScreen(TFT_BLACK);
    delay(100);
    tft.fillScreen(TFT_WHITE);
    delay(100);
    
    currentMedIndex++;
    currentState = MEDICATION_DISPLAY;
    resetTimerState();
    return;
  }
  
  // Draw static elements only once
  if (!timerScreenDrawn) {
    tft.fillScreen(TFT_BLACK);

    // Header
    tft.setTextSize(2);
    tft.setTextDatum(middle_center);
    tft.drawString("WAIT - SAME EYE", 120, 45);

    // Progress bar background (inset for circular display)
    tft.fillRoundRect(35, 120, 170, 16, 4, TFT_DARKGREY);

    // Skip button
    tft.fillRoundRect(btnSkip.x, btnSkip.y, btnSkip.w, btnSkip.h, 8, TFT_ORANGE);
    tft.setTextSize(2);
    tft.setTextDatum(middle_center);
    tft.setTextColor(TFT_BLACK);
    tft.drawString("SKIP", 120, 166);
    tft.setTextColor(TFT_WHITE);

    // Next medication preview
    if (currentMedIndex + 1 < sessions[selectedSession].medications.size()) {
      Medication& nextMed = sessions[selectedSession].medications[currentMedIndex + 1];
      tft.setTextSize(1);
      tft.setTextDatum(middle_center);
      tft.drawString("Next:", 120, 192);
      tft.setTextSize(2);
      tft.drawString(nextMed.short_name, 120, 208);
    }

    timerScreenDrawn = true;
  }

  // Update countdown only when seconds change
  unsigned long remaining = WAIT_TIME_MS - elapsed;
  int seconds = (remaining % 60000) / 1000;
  if (seconds != timerLastSeconds) {
    int minutes = remaining / 60000;
    char timeStr[10];
    snprintf(timeStr, sizeof(timeStr), "%d:%02d", minutes, seconds);

    // Clear previous time (draw black rectangle)
    tft.fillRect(60, 62, 120, 40, TFT_BLACK);

    // Draw new time
    tft.setTextSize(4);
    tft.setTextDatum(middle_center);
    tft.setTextColor(TFT_WHITE);
    tft.drawString(timeStr, 120, 82);

    timerLastSeconds = seconds;
  }

  // Update progress bar (matching inset background)
  int progress = ((float)elapsed / WAIT_TIME_MS) * 170;
  if (progress != timerLastProgress) {
    tft.fillRoundRect(35, 120, progress, 16, 4, TFT_GREEN);
    timerLastProgress = progress;
  }
}

void drawComplete() {
  tft.fillScreen(TFT_BLACK);

  tft.setTextSize(3);
  tft.setTextDatum(middle_center);
  tft.setTextColor(TFT_GREEN);
  tft.drawString("SESSION", 120, 85);
  tft.drawString("COMPLETE", 120, 120);

  // Show elapsed time
  unsigned long elapsed = (millis() - sessionStartTime) / 1000;
  int minutes = elapsed / 60;
  int seconds = elapsed % 60;
  char timeStr[20];
  snprintf(timeStr, sizeof(timeStr), "%d min %d sec", minutes, seconds);
  tft.setTextSize(2);
  tft.setTextColor(TFT_WHITE);
  tft.drawString(timeStr, 120, 158);

  // Tap to return
  tft.setTextSize(1);
  tft.drawString("Tap to return", 120, 190);
}

void drawSettingsMenu() {
  tft.fillScreen(TFT_BLACK);
  tft.setTextSize(2);
  tft.setTextDatum(middle_center);
  tft.drawString("SETTINGS", 120, 50);

  // Exocin toggle
  tft.setTextSize(1);
  tft.setTextDatum(middle_center);
  tft.drawString("Exocin course:", 120, 80);

  tft.fillRoundRect(40, 95, 160, 40, 8, exocinFinished ? TFT_GREEN : TFT_RED);
  tft.setTextSize(2);
  tft.setTextDatum(middle_center);
  tft.setTextColor(TFT_BLACK);
  tft.drawString(exocinFinished ? "FINISHED" : "ACTIVE", 120, 115);
  tft.setTextColor(TFT_WHITE);

  // Back button
  tft.fillRoundRect(55, 165, 130, 36, 8, TFT_DARKGREY);
  tft.setTextSize(2);
  tft.setTextDatum(middle_center);
  tft.drawString("BACK", 120, 183);
}

void handleTouch(int x, int y) {
  Serial.printf("Touch at: %d, %d (State: %d)\n", x, y, currentState);
  
  switch (currentState) {
    case SESSION_SELECT:
      // Check session buttons
      for (int i = 0; i < sessions.size(); i++) {
        if (btnSession[i].contains(x, y)) {
          if (sessionCompleted[i]) {
            Serial.printf("Session %s already completed, ignoring tap\n", sessions[i].name.c_str());
            return;
          }
          selectedSession = i;
          currentMedIndex = 0;
          sessionStartTime = millis();

          bool resumed = checkResume(i);
          if (!resumed) {
            currentSessionId = makeSessionId();
            postEvent("session_start", nullptr, nullptr, -1,
                      sessions[i].medications.size());
          } else {
            postEvent("session_resumed", nullptr, nullptr, currentMedIndex,
                      sessions[i].medications.size());
          }

          currentState = MEDICATION_DISPLAY;
          Serial.printf("Selected session: %s (resumed=%d)\n",
                        sessions[i].name.c_str(), resumed);
          return;
        }
      }
      // Check insulin button
      if (btnInsulin.contains(x, y)) {
        insulinDose = 10.0;  // Default
        insulinMeal = "morning";
        currentState = INSULIN_DOSE_SELECT;
        return;
      }
      // Check settings button
      if (btnSettings.contains(x, y)) {
        drawSettingsMenu();
        // Wait for tap to toggle or return
        delay(300);
        while (!tft.getTouch(&x, &y)) delay(10);
        
        // Toggle Exocin if tapped on toggle button
        if (y >= 95 && y <= 135) {
          exocinFinished = !exocinFinished;
          prefs.putBool("exocin_done", exocinFinished);
          sessions = getSessions(exocinFinished);
          Serial.printf("Exocin finished: %d\n", exocinFinished);
        }
        drawSessionSelect();
      }
      break;
      
    case MEDICATION_DISPLAY:
      if (btnDone.contains(x, y)) {
        Medication& med = sessions[selectedSession].medications[currentMedIndex];
        int total = sessions[selectedSession].medications.size();
        postEvent("med_done", med.short_name.c_str(), eyeToString(med.eye),
                  currentMedIndex, total);

        // Check if we need to wait (overlapping eyes)
        if (currentMedIndex + 1 < sessions[selectedSession].medications.size()) {
          Medication& nextMed = sessions[selectedSession].medications[currentMedIndex + 1];

          // Eyes overlap if either is BOTH, or they're the same
          bool eyesOverlap = (med.eye == nextMed.eye ||
                              med.eye == BOTH || nextMed.eye == BOTH);

          if (med.wait_after && eyesOverlap) {
            // Start timer
            waitTimerStart = millis();
            currentState = TIMER_COUNTDOWN;
            Serial.println("Starting 5-minute timer");
          } else {
            // Move to next immediately
            currentMedIndex++;
            drawMedication();
            Serial.println("Moving to next medication (different eye)");
          }
        } else {
          // Last medication
          currentMedIndex++;
          currentState = SESSION_COMPLETE;
          int elapsed = (millis() - sessionStartTime) / 1000;
          postEvent("session_complete", nullptr, nullptr, -1, total, elapsed);
        }
      }
      break;
      
    case TIMER_COUNTDOWN:
      if (btnSkip.contains(x, y)) {
        Serial.println("Timer skipped by user");
        postEvent("timer_skipped");
        resetTimerState();
        currentMedIndex++;
        currentState = MEDICATION_DISPLAY;
      }
      break;
      
    case SESSION_COMPLETE:
      // Tap anywhere to return to session select
      currentState = SESSION_SELECT;
      break;

    case INSULIN_DOSE_SELECT:
      if (btnDoseMinus.contains(x, y)) {
        if (insulinDose > 1) {
          insulinDose -= 1;
          drawInsulinDoseSelect();
        }
      } else if (btnDosePlus.contains(x, y)) {
        if (insulinDose < 50) {
          insulinDose += 1;
          drawInsulinDoseSelect();
        }
      } else if (btnInsulinNext.contains(x, y)) {
        currentState = INSULIN_MEAL_SELECT;
      } else if (y > 210) {
        // Cancel - back to session select
        currentState = SESSION_SELECT;
      }
      break;

    case INSULIN_MEAL_SELECT:
      if (btnMealMorning.contains(x, y)) {
        insulinMeal = "morning";
        drawInsulinMealSelect();
      } else if (btnMealEvening.contains(x, y)) {
        insulinMeal = "evening";
        drawInsulinMealSelect();
      } else if (btnInsulinConfirm.contains(x, y)) {
        postInsulinDose(insulinDose, insulinMeal);
        currentState = INSULIN_LOGGED;
      } else if (btnInsulinBack.contains(x, y)) {
        currentState = INSULIN_DOSE_SELECT;
      }
      break;

    case INSULIN_LOGGED:
      // Tap anywhere to return
      currentState = SESSION_SELECT;
      break;
  }
}

void loop()
{
  // Update display based on state
  static AppState lastState = SESSION_COMPLETE;  // Force initial draw
  
  if (currentState != lastState) {
    switch (currentState) {
      case SESSION_SELECT:
        drawSessionSelect();
        break;
      case MEDICATION_DISPLAY:
        drawMedication();
        break;
      case TIMER_COUNTDOWN:
        drawTimer();
        break;
      case SESSION_COMPLETE:
        drawComplete();
        break;
      case INSULIN_DOSE_SELECT:
        drawInsulinDoseSelect();
        break;
      case INSULIN_MEAL_SELECT:
        drawInsulinMealSelect();
        break;
      case INSULIN_CONFIRM:
        break;
      case INSULIN_LOGGED:
        drawInsulinLogged();
        break;
    }
    lastState = currentState;
  }
  
  // Re-sync completed sessions every 5 minutes while on session select
  if (currentState == SESSION_SELECT) {
    static unsigned long lastResync = 0;
    unsigned long now = millis();
    if (now - lastResync > 300000) {  // 5 minutes
      lastResync = now;
      fetchCompletedSessions();
      drawSessionSelect();
      lastState = SESSION_SELECT;  // prevent double draw
    }
  }

  // Update timer display continuously
  if (currentState == TIMER_COUNTDOWN) {
    drawTimer();
  }
  
  // Check for touch
  int x, y;
  if (tft.getTouch(&x, &y)) {
    handleTouch(x, y);
    delay(200);  // Debounce
  }

  delay(50);
}
