# CLAUDE.md - Dog Eye Drop Timer Project

## Project Overview
A medication timer application for ESP32-C3 with integrated touchscreen display, designed to guide administration of multiple eye drops to a dog with proper timing between applications.

## Hardware
- **Board**: ESP32-C3-MINI-1U (ESP32-2424S012 variant)
- **Display**: 1.28" round GC9A01 (240x240 IPS LCD)
- **Touch**: CST816S capacitive touch controller
- **Connection**: USB-C via `/dev/ttyACM2`

## Pin Configuration
```
Display (SPI):
- SCLK: GPIO 6
- MOSI: GPIO 7
- DC:   GPIO 2
- CS:   GPIO 10
- BL:   GPIO 3 (PWM backlight)

Touch (I2C):
- SDA:  GPIO 4
- SCL:  GPIO 5
- INT:  GPIO 0
- RST:  GPIO 1
```

## Architecture

### State Machine
```
SESSION_SELECT → MEDICATION_DISPLAY → TIMER_COUNTDOWN → SESSION_COMPLETE → [back to SELECT]
```

### Key Components
1. **medication.cpp/h**: Data structures for medications and sessions
2. **main.cpp**: Display init, UI rendering, state machine, touch handling
3. **dashboard/server.js**: Node.js dashboard with calendar view, session clearing, and resume API
4. **Preferences (NVS)**: Stores Exocin finished flag

### Medication Data Structure
```cpp
struct Medication {
  String name;          // Full name
  String short_name;    // Display name
  Eye eye;              // LEFT, RIGHT, BOTH
  bool shake_required;  // Show "SHAKE FIRST" warning
  bool is_temporary;    // For Exocin (can be toggled off)
  bool wait_after;      // 5-min wait before next drop to same eye
}
```

## Sessions

### Morning (6 drops, 5 when Exocin finished)
1. Tacrolimus - BOTH (wait 5 min)
2. Yellox - BOTH (wait 5 min)
3. Pred-Forte - LEFT (SHAKE, wait 5 min)
4. Brinzolamide - LEFT (SHAKE, wait 5 min)
5. Exocin - LEFT [temporary] (wait 5 min)
6. Clinitas - BOTH (MUST BE LAST)

### Midday (1 drop, only when Exocin active)
1. Exocin - LEFT

### Evening (5 drops, 4 when Exocin finished)
1. Tacrolimus - RIGHT (wait 5 min)
2. Yellox - BOTH (wait 5 min)
3. Pred-Forte - LEFT (SHAKE, wait 5 min)
4. Exocin - LEFT [temporary] (wait 5 min)
5. Clinitas - BOTH (MUST BE LAST)

## Timer Logic
- **Same eye consecutive drops**: 5-minute countdown with progress bar
- **Different eye**: Immediate transition (no wait)
- **BOTH eyes**: Treated as applying to both simultaneously

## UI Layout (Circular Display)

### Session Select
```
      SELECT SESSION
    [  Morning  ]
    [  Midday   ]    [SET]
    [  Evening  ]
```

### Medication Display
```
    PRED-FORTE     3/6
    
    ◄ LEFT ►  or  ◄ BOTH ►
    
    ⚠ SHAKE FIRST
    
    [ TAP DONE ]
```

### Timer Countdown
```
    WAIT - SAME EYE
    
         4:32
    ████████░░░░░
    
    Next: BRINZOLAMIDE
          LEFT
```

### Session Complete
```
      SESSION
      COMPLETE ✓
      
    25 min 32 sec
    
    Tap to return
```

## Display Optimization
- **Circular safe area**: Content positioned away from edges (>15px from top/bottom, >30px from sides)
- **Flicker prevention**: Static elements drawn once, only dynamic content updated
- **Timer updates**: Only redraws when seconds change

## Dashboard

### Running
```bash
cd ~/dog_eyedrop_timer/dashboard
node server.js
# Runs at http://localhost:3000
```

### API Endpoints
- `POST /api/events` - ESP32 posts session events (session_start, med_done, timer_skipped, session_complete, session_resumed)
- `GET /api/sessions?limit=N` - List recent sessions with events
- `GET /api/calendar?days=N` - Per-day summary for calendar view
- `GET /api/resume?session_name=Morning` - Check for incomplete session to resume
- `DELETE /api/session/:session_id` - Clear a session (allows re-logging on device)

### Features
- Calendar view with 14-day history
- Click rows to expand and see individual events
- Clear button per session to remove and allow re-logging
- Auto-refreshes every 30 seconds

### Database
- SQLite via better-sqlite3, stored at `dashboard/eyedrops.db`
- Single `events` table with session_id grouping

## ESP32-Dashboard Sync
- ESP32 connects to WiFi on boot (non-blocking)
- On session select screen, fetches completed sessions from dashboard calendar API
- Completed sessions shown as dimmed buttons with "ok" label, taps ignored
- "NOT SYNCED" warning shown in red if dashboard unreachable
- Green dot shown if sync succeeded
- WiFi wait: up to 3 seconds before resume check and sync to allow connection to establish
- Session resume: on session select, queries `/api/resume` to continue incomplete sessions after power cycle

## Build & Deploy
```bash
cd ~/dog_eyedrop_timer
pio run --target upload
```

## Settings
- Accessible via blue "SET" button on session select screen
- Toggle Exocin "FINISHED" to remove from all sessions
- Setting persists in NVS across power cycles

## Future Enhancements
- [ ] NTP for time-based session suggestions
- [ ] Low power mode with screen timeout
- [ ] Battery support
- [ ] Alarm/reminder notifications

## Modifying Schedule
To change medications:
1. Edit `src/medication.cpp`
2. Modify the medication arrays in `getSessions()`
3. Update README.md with new schedule
4. Rebuild and deploy

## Known Issues
- Session IDs are `millis()` values that reset on reboot; calendar API uses `last_event_at` timestamps (not session_id) for determining most recent session per day

## Dependencies

### ESP32
- LovyanGFX @^1.1.0 (display + touch)
- ArduinoJson @^7.0.0 (JSON parsing for dashboard API)
- HTTPClient (built-in, HTTP requests to dashboard)
- WiFi (built-in)
- Preferences @2.0.0 (NVS storage, built-in)

### Dashboard (Node.js)
- express (web server)
- better-sqlite3 (database)

## Notes
- Touch coordinates: 0,0 = top-left, 239,239 = bottom-right
- Backlight PWM: Channel 0, 5kHz, 8-bit resolution, ~78% brightness (200/255)
- CST816S touch address: 0x15
- Medication names kept concise for circular display constraints
