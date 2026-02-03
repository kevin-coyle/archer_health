# Dog Eye Drop Timer - ESP32-C3

A touchscreen-based medication timer for administering multiple eye drops to a dog, ensuring proper timing between drops to the same eye.

## Features

- **Three Session Types**: Morning (9 drops), Midday (1 drop), and Evening (7 drops)
- **Smart Timer Logic**: 5-minute countdown between drops to the SAME eye, immediate transition when switching eyes
- **Visual Eye Indicators**: Clear LEFT/RIGHT highlighting on screen
- **Shake Reminders**: Automatic "SHAKE FIRST" alerts for suspensions (Pred-Forte, Brinzolamide)
- **Progress Tracking**: Shows current drop number and total, plus session elapsed time
- **Persistent Settings**: Exocin course toggle stored in NVS (survives power loss)
- **Touch Interface**: All interactions through the built-in touchscreen

## Hardware Requirements

- ESP32-C3 with integrated 1.28" round GC9A01 display (240x240 pixels)
- CST816S touch controller
- USB-C power

## Medication Schedule

### Morning Session (6 drops, 5 when Exocin finished)
1. Tacrolimus - BOTH EYES (5 min wait)
2. Yellox - BOTH EYES (5 min wait)
3. Pred-Forte - LEFT (5 min wait, SHAKE)
4. Brinzolamide - LEFT (5 min wait, SHAKE)
5. Exocin - LEFT (5 min wait) *[temporary]*
6. Clinitas - BOTH EYES (MUST BE LAST)

### Midday Session (1 drop)
1. Exocin - LEFT *[only when Exocin active]*

### Evening Session (5 drops, 4 when Exocin finished)
1. Tacrolimus - RIGHT (5 min wait)
2. Yellox - BOTH EYES (5 min wait)
3. Pred-Forte - LEFT (5 min wait, SHAKE)
4. Exocin - LEFT (5 min wait) *[temporary]*
5. Clinitas - BOTH EYES (MUST BE LAST)

## Usage

### Starting a Session
1. On boot, the device shows three buttons: Morning / Midday / Evening
2. Tap the appropriate session for the current time of day
3. The first medication is displayed

### During a Session
1. Read the medication name (large text at top)
2. Check which eye: LEFT or RIGHT will be highlighted in green
3. If shown: heed the "SHAKE FIRST" warning
4. Administer the drops
5. Tap the green "TAP DONE" button

**If next drop is to the SAME eye:**
- 5:00 countdown timer appears
- Progress bar shows time remaining
- Screen flashes white when timer completes
- Next medication automatically displays

**If next drop is to a DIFFERENT eye:**
- Next medication appears immediately (no wait)

### Completing a Session
- After the final drop, "SESSION COMPLETE ✓" appears
- Total elapsed time is shown
- Tap anywhere to return to session selection

### Settings
1. From the session selection screen, tap the blue "SET" button (top right)
2. Tap the Exocin toggle to mark the course as FINISHED
   - This removes Exocin from Morning/Evening sessions
   - Midday session disappears entirely
3. Tap "BACK" to return

## Timer Logic

The application automatically determines wait times based on:
- **Current eye** vs **next eye**
- The `wait_after` flag on each medication

Example flow:
```
Tacrolimus RIGHT → 5 min wait → Yellox RIGHT (same eye)
Yellox RIGHT → immediate → Yellox LEFT (different eye)
```

## Code Structure

- `medication.h/cpp`: Data structures and session definitions
- `main.cpp`: Display initialization, UI rendering, state machine, touch handling
- State machine: SESSION_SELECT → MEDICATION_DISPLAY → TIMER_COUNTDOWN → SESSION_COMPLETE

## Modifying the Schedule

To change medications or timing:

1. Edit `src/medication.cpp`
2. Modify the `getSessions()` function
3. Each medication has:
   - `name`: Full medication name
   - `short_name`: Display name (keep concise)
   - `eye`: LEFT, RIGHT, or BOTH
   - `shake_required`: true for suspensions
   - `is_temporary`: true for time-limited medications
   - `wait_after`: true if 5-min wait needed before next drop to same eye

Example:
```cpp
{"Pred-Forte", "Pred-Forte", LEFT, true, false, true}
//             medication    eye   shake temp  wait
```

## Building

```bash
cd ~/dog_eyedrop_timer
pio run --target upload
```

## Future Enhancements

- WiFi + NTP time sync for auto-session suggestion
- Low power mode with screen timeout
- Battery support
- Sound/vibration alerts (if hardware added)
- Historical tracking (drop times logged to SD card)

## License

Personal use project. Modify as needed for your pet's medication schedule.
