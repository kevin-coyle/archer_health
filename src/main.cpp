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

TouchRegion btnDone = {40, 170, 160, 45};
TouchRegion btnSession[3] = {
  {30, 70, 180, 40},
  {30, 120, 180, 40},
  {30, 170, 180, 40}
};
TouchRegion btnSettings = {165, 15, 50, 30};

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
  tft.drawString("SELECT SESSION", 120, 30);
  
  // Draw session buttons (centered for circular display)
  for (int i = 0; i < sessions.size(); i++) {
    tft.fillRoundRect(btnSession[i].x, btnSession[i].y, btnSession[i].w, btnSession[i].h, 8, TFT_DARKGREY);
    tft.setTextSize(2);
    tft.setTextDatum(middle_center);
    tft.drawString(sessions[i].name, 120, btnSession[i].y + 20);
  }
  
  // Draw settings button (gear icon represented as "SET")
  tft.fillRoundRect(btnSettings.x, btnSettings.y, btnSettings.w, btnSettings.h, 3, TFT_BLUE);
  tft.setTextSize(1);
  tft.setTextDatum(middle_center);
  tft.drawString("SET", btnSettings.x + 25, btnSettings.y + 15);
}

void drawMedication() {
  if (currentMedIndex >= sessions[selectedSession].medications.size()) {
    currentState = SESSION_COMPLETE;
    return;
  }
  
  Medication& med = sessions[selectedSession].medications[currentMedIndex];
  
  tft.fillScreen(TFT_BLACK);
  
  // Progress indicator
  tft.setTextSize(1);
  tft.setTextDatum(top_right);
  char progress[20];
  snprintf(progress, sizeof(progress), "%d/%d", currentMedIndex + 1, 
           sessions[selectedSession].medications.size());
  tft.drawString(progress, 210, 15);
  
  // Medication name
  tft.setTextSize(2);
  tft.setTextDatum(middle_center);
  tft.drawString(med.short_name, 120, 50);
  
  // Eye indicator with visual distinction
  tft.setTextSize(3);
  if (med.eye == LEFT) {
    tft.fillRect(0, 70, 120, 60, TFT_DARKGREEN);
    tft.setTextColor(TFT_WHITE);
    tft.setTextDatum(middle_center);
    tft.drawString("LEFT", 60, 100);
    tft.setTextColor(TFT_DARKGREY);
    tft.drawString("RIGHT", 180, 100);
  } else if (med.eye == RIGHT) {
    tft.fillRect(120, 70, 120, 60, TFT_DARKGREEN);
    tft.setTextColor(TFT_DARKGREY);
    tft.setTextDatum(middle_center);
    tft.drawString("LEFT", 60, 100);
    tft.setTextColor(TFT_WHITE);
    tft.drawString("RIGHT", 180, 100);
  } else { // BOTH
    tft.fillRect(0, 70, 240, 60, TFT_DARKGREEN);
    tft.setTextColor(TFT_WHITE);
    tft.setTextDatum(middle_center);
    tft.drawString("BOTH EYES", 120, 100);
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
  tft.drawString("TAP DONE", 120, 185);
  tft.setTextColor(TFT_WHITE);
}

void drawTimer() {
  static int lastSeconds = -1;
  static int lastProgress = -1;
  static bool timerScreenDrawn = false;
  
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
    timerScreenDrawn = false;
    lastSeconds = -1;
    lastProgress = -1;
    return;
  }
  
  // Draw static elements only once
  if (!timerScreenDrawn) {
    tft.fillScreen(TFT_BLACK);
    
    // Header
    tft.setTextSize(2);
    tft.setTextDatum(middle_center);
    tft.drawString("WAIT - SAME EYE", 120, 30);
    
    // Progress bar background
    tft.fillRect(20, 120, 200, 20, TFT_DARKGREY);
    
    // Next medication preview
    if (currentMedIndex + 1 < sessions[selectedSession].medications.size()) {
      Medication& nextMed = sessions[selectedSession].medications[currentMedIndex + 1];
      tft.setTextSize(1);
      tft.setTextDatum(middle_center);
      tft.drawString("Next:", 120, 160);
      tft.setTextSize(2);
      tft.drawString(nextMed.short_name, 120, 180);
      tft.drawString(eyeToString(nextMed.eye), 120, 205);
    }
    
    timerScreenDrawn = true;
  }
  
  // Update countdown only when seconds change
  int seconds = (remaining % 60000) / 1000;
  if (seconds != lastSeconds) {
    int minutes = remaining / 60000;
    char timeStr[10];
    snprintf(timeStr, sizeof(timeStr), "%d:%02d", minutes, seconds);
    
    // Clear previous time (draw black rectangle)
    tft.fillRect(60, 60, 120, 40, TFT_BLACK);
    
    // Draw new time
    tft.setTextSize(4);
    tft.setTextDatum(middle_center);
    tft.setTextColor(TFT_WHITE);
    tft.drawString(timeStr, 120, 80);
    
    lastSeconds = seconds;
  }
  
  // Update progress bar
  int progress = ((float)elapsed / WAIT_TIME_MS) * 200;
  if (progress != lastProgress) {
    tft.fillRect(20, 120, progress, 20, TFT_GREEN);
    lastProgress = progress;
  }
}

void drawComplete() {
  tft.fillScreen(TFT_BLACK);
  
  tft.setTextSize(3);
  tft.setTextDatum(middle_center);
  tft.setTextColor(TFT_GREEN);
  tft.drawString("SESSION", 120, 80);
  tft.drawString("COMPLETE", 120, 115);
  
  // Show elapsed time
  unsigned long elapsed = (millis() - sessionStartTime) / 1000;
  int minutes = elapsed / 60;
  int seconds = elapsed % 60;
  char timeStr[20];
  snprintf(timeStr, sizeof(timeStr), "%d min %d sec", minutes, seconds);
  tft.setTextSize(2);
  tft.setTextColor(TFT_WHITE);
  tft.drawString(timeStr, 120, 160);
  
  // Tap to return
  tft.setTextSize(1);
  tft.drawString("Tap to return", 120, 200);
}

void drawSettingsMenu() {
  tft.fillScreen(TFT_BLACK);
  tft.setTextSize(2);
  tft.setTextDatum(middle_center);
  tft.drawString("SETTINGS", 120, 30);
  
  // Exocin toggle
  tft.setTextSize(1);
  tft.setTextDatum(top_left);
  tft.drawString("Exocin course:", 20, 60);
  
  tft.fillRoundRect(20, 80, 200, 40, 5, exocinFinished ? TFT_GREEN : TFT_RED);
  tft.setTextSize(2);
  tft.setTextDatum(middle_center);
  tft.setTextColor(TFT_BLACK);
  tft.drawString(exocinFinished ? "FINISHED" : "ACTIVE", 120, 100);
  tft.setTextColor(TFT_WHITE);
  
  // Back button
  tft.fillRoundRect(20, 180, 200, 40, 5, TFT_DARKGREY);
  tft.setTextSize(2);
  tft.setTextDatum(middle_center);
  tft.drawString("BACK", 120, 200);
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
        if (y >= 80 && y <= 120) {
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
      // No touch action during timer
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
