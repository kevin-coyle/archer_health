const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = 3000;

// SQLite setup
const db = new Database(path.join(__dirname, 'eyedrops.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    session_name TEXT,
    session_id TEXT,
    medication_name TEXT,
    medication_eye TEXT,
    med_index INTEGER,
    med_total INTEGER,
    elapsed_sec INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

app.use(express.json());

// POST /api/events - ESP32 posts events here
const insertStmt = db.prepare(`
  INSERT INTO events (event_type, session_name, session_id, medication_name, medication_eye, med_index, med_total, elapsed_sec)
  VALUES (@event_type, @session_name, @session_id, @medication_name, @medication_eye, @med_index, @med_total, @elapsed_sec)
`);

app.post('/api/events', (req, res) => {
  try {
    const info = insertStmt.run({
      event_type: req.body.event_type || null,
      session_name: req.body.session_name || null,
      session_id: req.body.session_id || null,
      medication_name: req.body.medication_name || null,
      medication_eye: req.body.medication_eye || null,
      med_index: req.body.med_index ?? null,
      med_total: req.body.med_total ?? null,
      elapsed_sec: req.body.elapsed_sec ?? null
    });
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (err) {
    console.error('Insert error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/sessions?limit=20 - grouped session history
app.get('/api/sessions', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  try {
    const sessions = db.prepare(`
      SELECT DISTINCT session_id, session_name,
        MIN(created_at) as started_at,
        MAX(CASE WHEN event_type = 'session_complete' THEN created_at END) as completed_at,
        MAX(CASE WHEN event_type = 'session_complete' THEN elapsed_sec END) as total_elapsed_sec
      FROM events
      WHERE session_id IS NOT NULL
      GROUP BY session_id
      ORDER BY started_at DESC
      LIMIT ?
    `).all(limit);

    for (const s of sessions) {
      s.events = db.prepare(`
        SELECT event_type, medication_name, medication_eye, med_index, med_total, elapsed_sec, created_at
        FROM events
        WHERE session_id = ?
        ORDER BY id ASC
      `).all(s.session_id);
    }

    res.json(sessions);
  } catch (err) {
    console.error('Query error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET / - inline HTML dashboard
app.get('/', (req, res) => {
  res.type('html').send(DASHBOARD_HTML);
});

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Eyedrop Timer Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
    background: #1a1a2e;
    color: #e0e0e0;
    padding: 20px;
    max-width: 800px;
    margin: 0 auto;
  }
  h1 { color: #e94560; margin-bottom: 4px; font-size: 1.5em; }
  .subtitle { color: #666; margin-bottom: 20px; font-size: 0.9em; }
  .session-card {
    background: #16213e;
    border: 1px solid #0f3460;
    border-radius: 8px;
    margin-bottom: 10px;
    overflow: hidden;
  }
  .session-header {
    padding: 12px 16px;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    user-select: none;
  }
  .session-header:hover { background: #1a2744; }
  .session-name {
    font-weight: bold;
    color: #e94560;
    font-size: 1.1em;
  }
  .session-meta { color: #888; font-size: 0.85em; }
  .session-time { color: #53d769; font-size: 0.85em; }
  .session-events {
    display: none;
    border-top: 1px solid #0f3460;
    padding: 8px 16px;
  }
  .session-events.open { display: block; }
  .event-row {
    padding: 6px 0;
    border-bottom: 1px solid #0f3460;
    display: flex;
    justify-content: space-between;
    font-size: 0.9em;
  }
  .event-row:last-child { border-bottom: none; }
  .event-type {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.8em;
    font-weight: bold;
  }
  .event-type.med_done { background: #0a3d0a; color: #53d769; }
  .event-type.session_start { background: #3d3d0a; color: #f0e030; }
  .event-type.session_complete { background: #0a2d3d; color: #30c0f0; }
  .event-type.timer_skipped { background: #3d2a0a; color: #f0a030; }
  .med-eye { color: #888; }
  .med-eye.LEFT { color: #ff6b6b; }
  .med-eye.RIGHT { color: #4ecdc4; }
  .med-eye.BOTH { color: #ffe66d; }
  .empty { text-align: center; padding: 40px; color: #666; }
  .refresh-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }
  .refresh-btn {
    background: #0f3460;
    color: #e0e0e0;
    border: none;
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85em;
  }
  .refresh-btn:hover { background: #1a4a7a; }
  .auto-label { color: #666; font-size: 0.8em; }
  .arrow { transition: transform 0.2s; display: inline-block; color: #666; }
  .arrow.open { transform: rotate(90deg); }
</style>
</head>
<body>
<h1>Eyedrop Timer</h1>
<p class="subtitle">Medication event log</p>
<div class="refresh-bar">
  <span class="auto-label">Auto-refreshes every 30s</span>
  <button class="refresh-btn" onclick="load()">Refresh</button>
</div>
<div id="sessions"></div>

<script>
async function load() {
  try {
    const res = await fetch('/api/sessions?limit=30');
    const sessions = await res.json();
    const el = document.getElementById('sessions');
    if (!sessions.length) {
      el.innerHTML = '<div class="empty">No sessions recorded yet. Run a session on the device to see events here.</div>';
      return;
    }
    el.innerHTML = sessions.map((s, i) => {
      const dt = new Date(s.started_at + 'Z');
      const dateStr = dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      const timeStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const elapsed = s.total_elapsed_sec
        ? Math.floor(s.total_elapsed_sec / 60) + 'm ' + (s.total_elapsed_sec % 60) + 's'
        : 'in progress';
      const status = s.completed_at ? elapsed : 'in progress';
      const meds = s.events.filter(e => e.event_type === 'med_done');
      const eventsHtml = s.events.map(e => {
        const t = new Date(e.created_at + 'Z').toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        let desc = e.event_type;
        if (e.medication_name) desc = e.medication_name;
        let eyeHtml = e.medication_eye ? '<span class="med-eye ' + e.medication_eye + '">' + e.medication_eye + '</span>' : '';
        let indexHtml = e.med_index != null ? ' (' + (e.med_index + 1) + '/' + e.med_total + ')' : '';
        return '<div class="event-row"><div><span class="event-type ' + e.event_type + '">' + e.event_type.replace('_', ' ') + '</span> ' + desc + indexHtml + ' ' + eyeHtml + '</div><div>' + t + '</div></div>';
      }).join('');
      return '<div class="session-card"><div class="session-header" onclick="toggle(this)"><div><span class="session-name">' + s.session_name + '</span> <span class="session-meta">' + dateStr + ' ' + timeStr + ' &mdash; ' + meds.length + ' drops</span></div><div><span class="session-time">' + status + '</span> <span class="arrow">&#9654;</span></div></div><div class="session-events">' + eventsHtml + '</div></div>';
    }).join('');
  } catch (err) {
    console.error('Load error:', err);
  }
}

function toggle(header) {
  const events = header.nextElementSibling;
  const arrow = header.querySelector('.arrow');
  events.classList.toggle('open');
  arrow.classList.toggle('open');
}

load();
setInterval(load, 30000);
</script>
</body>
</html>`;

app.listen(PORT, () => {
  console.log('Eyedrop dashboard running at http://localhost:' + PORT);
});
