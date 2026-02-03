#include <Arduino.h>
#include <LovyanGFX.hpp>
#include <Preferences.h>
#include "medication.h"

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
  SESSION_COMPLETE
};

AppState currentState = SESSION_SELECT;
std::vector<SessionData> sessions;
int selectedSession = 0;
int currentMedIndex = 0;
unsigned long waitTimerStart = 0;
unsigned long sessionStartTime = 0;
const unsigned long WAIT_TIME_MS = 5 * 60 * 1000; // 5 minutes
bool exocinFinished = false;

// Touch regions
struct TouchRegion {
  int x, y, w, h;
  bool contains(int tx, int ty) {
    return tx >= x && tx < x + w && ty >= y && ty < y + h;
  }
};

TouchRegion btnDone = {45, 170, 150, 40};
TouchRegion btnSession[3] = {
  {45, 80, 150, 36},
  {45, 120, 150, 36},
  {45, 160, 150, 36}
};
TouchRegion btnSettings = {90, 200, 60, 28};
TouchRegion btnSkip = {70, 150, 100, 32};

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

    Serial.println("Setup complete!");
}

void drawSessionSelect() {
  tft.fillScreen(TFT_BLACK);
  tft.setTextSize(2);
  tft.setTextDatum(middle_center);
  tft.drawString("SELECT SESSION", 120, 50);

  // Draw session buttons (centered for circular display)
  for (int i = 0; i < sessions.size(); i++) {
    tft.fillRoundRect(btnSession[i].x, btnSession[i].y, btnSession[i].w, btnSession[i].h, 8, TFT_DARKGREY);
    tft.setTextSize(2);
    tft.setTextDatum(middle_center);
    tft.drawString(sessions[i].name, 120, btnSession[i].y + 18);
  }

  // Draw settings button (bottom center, within circular safe area)
  tft.fillRoundRect(btnSettings.x, btnSettings.y, btnSettings.w, btnSettings.h, 5, TFT_BLUE);
  tft.setTextSize(1);
  tft.setTextDatum(middle_center);
  tft.drawString("SET", 120, btnSettings.y + 14);
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
  unsigned long remaining = WAIT_TIME_MS - elapsed;
  
  if (remaining <= 0) {
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
          selectedSession = i;
          currentMedIndex = 0;
          sessionStartTime = millis();
          currentState = MEDICATION_DISPLAY;
          Serial.printf("Selected session: %s\n", sessions[i].name.c_str());
          return;
        }
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
        
        // Check if we need to wait (same eye)
        if (currentMedIndex + 1 < sessions[selectedSession].medications.size()) {
          Medication& nextMed = sessions[selectedSession].medications[currentMedIndex + 1];
          
          if (med.wait_after && med.eye == nextMed.eye) {
            // Start timer
            waitTimerStart = millis();
            currentState = TIMER_COUNTDOWN;
            Serial.println("Starting 5-minute timer");
          } else {
            // Move to next immediately
            currentMedIndex++;
            Serial.println("Moving to next medication (different eye)");
          }
        } else {
          // Last medication
          currentMedIndex++;
          currentState = SESSION_COMPLETE;
        }
      }
      break;
      
    case TIMER_COUNTDOWN:
      if (btnSkip.contains(x, y)) {
        Serial.println("Timer skipped by user");
        resetTimerState();
        currentMedIndex++;
        currentState = MEDICATION_DISPLAY;
      }
      break;
      
    case SESSION_COMPLETE:
      // Tap anywhere to return to session select
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
    }
    lastState = currentState;
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
