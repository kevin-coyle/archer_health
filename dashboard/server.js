const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = 3000;

// SQLite setup
const dbPath = process.env.DB_PATH || path.join(__dirname, 'eyedrops.db');
const db = new Database(dbPath);
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

// GET /api/calendar?days=14 - per-day summary for calendar view
app.get('/api/calendar', (req, res) => {
  const days = parseInt(req.query.days) || 14;
  try {
    const rows = db.prepare(`
      SELECT
        date(created_at) as day,
        session_name,
        session_id,
        SUM(CASE WHEN event_type = 'med_done' THEN 1 ELSE 0 END) as meds_done,
        MAX(med_total) as meds_total,
        MAX(CASE WHEN event_type = 'session_complete' THEN 1 ELSE 0 END) as is_complete,
        MAX(CASE WHEN event_type = 'session_complete' THEN elapsed_sec END) as elapsed_sec,
        MAX(created_at) as last_event_at
      FROM events
      WHERE session_id IS NOT NULL
        AND created_at >= date('now', '-' || ? || ' days')
      GROUP BY session_id
      ORDER BY day DESC, session_name
    `).all(days);

    // Group by date
    const byDate = {};
    for (const row of rows) {
      if (!byDate[row.day]) byDate[row.day] = {};
      const existing = byDate[row.day][row.session_name];
      // Keep the most recent session per name per day (by timestamp)
      if (!existing || row.last_event_at > existing.last_event_at) {
        byDate[row.day][row.session_name] = {
          status: row.is_complete ? 'complete' : 'partial',
          meds_done: row.meds_done,
          meds_total: row.meds_total,
          session_id: row.session_id,
          elapsed_sec: row.elapsed_sec,
          last_event_at: row.last_event_at
        };
      }
    }

    // Always include today so the ESP32 doesn't mistake yesterday for today
    const today = new Date().toISOString().slice(0, 10);
    if (!byDate[today]) byDate[today] = {};

    const result = Object.keys(byDate).sort().reverse().map(date => ({
      date,
      sessions: {
        Morning: byDate[date].Morning || null,
        Midday: byDate[date].Midday || null,
        Evening: byDate[date].Evening || null
      }
    }));

    res.json(result);
  } catch (err) {
    console.error('Calendar query error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/resume?session_name=Morning - resume info for today's incomplete session
app.get('/api/resume', (req, res) => {
  const sessionName = req.query.session_name;
  if (!sessionName) {
    return res.json({ found: false });
  }
  try {
    // Find latest session_id for today matching session_name with no session_complete event
    const row = db.prepare(`
      SELECT session_id, MAX(med_total) as med_total
      FROM events
      WHERE session_name = ?
        AND date(created_at) = date('now')
        AND session_id NOT IN (
          SELECT session_id FROM events
          WHERE event_type = 'session_complete'
            AND session_id IS NOT NULL
        )
      GROUP BY session_id
      ORDER BY MAX(created_at) DESC
      LIMIT 1
    `).get(sessionName);

    if (!row) {
      return res.json({ found: false });
    }

    // Find the max med_index from med_done events for this session
    const maxIdx = db.prepare(`
      SELECT MAX(med_index) as max_idx
      FROM events
      WHERE session_id = ?
        AND event_type = 'med_done'
    `).get(row.session_id);

    const resumeIndex = (maxIdx && maxIdx.max_idx != null) ? maxIdx.max_idx + 1 : 0;

    res.json({
      found: true,
      session_id: row.session_id,
      resume_index: resumeIndex,
      med_total: row.med_total
    });
  } catch (err) {
    console.error('Resume query error:', err.message);
    res.status(500).json({ found: false, error: err.message });
  }
});

// DELETE /api/session/:session_id - clear a session's events
app.delete('/api/session/:session_id', (req, res) => {
  const sessionId = req.params.session_id;
  try {
    const result = db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId);
    console.log(`Deleted ${result.changes} events for session ${sessionId}`);
    res.json({ ok: true, deleted: result.changes });
  } catch (err) {
    console.error('Delete session error:', err.message);
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
    max-width: 900px;
    margin: 0 auto;
  }
  h1 { color: #e94560; margin-bottom: 4px; font-size: 1.5em; }
  .subtitle { color: #666; margin-bottom: 20px; font-size: 0.9em; }
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

  /* Calendar grid */
  .cal-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 20px;
  }
  .cal-table th {
    background: #0f3460;
    padding: 8px 12px;
    text-align: center;
    font-size: 0.85em;
    color: #aaa;
    border-bottom: 2px solid #1a1a2e;
  }
  .cal-table td {
    padding: 8px 12px;
    text-align: center;
    border-bottom: 1px solid #0f3460;
    font-size: 0.9em;
  }
  .cal-row { background: #16213e; cursor: pointer; }
  .cal-row:hover { background: #1a2744; }
  .cal-date { text-align: left !important; white-space: nowrap; font-weight: bold; color: #ccc; }
  .cal-cell { min-width: 80px; }
  .status-complete { color: #53d769; font-weight: bold; }
  .status-partial { color: #f0c030; }
  .status-none { color: #444; }

  /* Expanded session events */
  .detail-row { display: none; background: #111a30; }
  .detail-row.open { display: table-row; }
  .detail-cell { padding: 8px 16px; text-align: left; }
  .event-row {
    padding: 6px 0;
    border-bottom: 1px solid #0f3460;
    display: flex;
    justify-content: space-between;
    font-size: 0.85em;
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
  .event-type.session_resumed { background: #3d3d0a; color: #f0e030; }
  .event-type.session_complete { background: #0a2d3d; color: #30c0f0; }
  .event-type.timer_skipped { background: #3d2a0a; color: #f0a030; }
  .med-eye { color: #888; }
  .med-eye.LEFT { color: #ff6b6b; }
  .med-eye.RIGHT { color: #4ecdc4; }
  .med-eye.BOTH { color: #ffe66d; }
  .empty { text-align: center; padding: 40px; color: #666; }
  .session-label { font-weight: bold; color: #e94560; margin: 8px 0 4px; display: flex; justify-content: space-between; align-items: center; }
  .clear-btn {
    background: #3d0a0a;
    color: #f06060;
    border: 1px solid #602020;
    padding: 2px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.75em;
  }
  .clear-btn:hover { background: #601010; }
</style>
</head>
<body>
<h1>Eyedrop Timer</h1>
<p class="subtitle">Medication calendar</p>
<div class="refresh-bar">
  <span class="auto-label">Auto-refreshes every 30s</span>
  <button class="refresh-btn" onclick="load()">Refresh</button>
</div>
<div id="calendar"></div>

<script>
let calendarData = [];
let sessionsCache = {};

async function load() {
  try {
    const [calRes, sesRes] = await Promise.all([
      fetch('/api/calendar?days=14'),
      fetch('/api/sessions?limit=60')
    ]);
    calendarData = await calRes.json();
    const sesArr = await sesRes.json();
    sessionsCache = {};
    for (const s of sesArr) sessionsCache[s.session_id] = s;
    render();
  } catch (err) {
    console.error('Load error:', err);
  }
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function cellHtml(info) {
  if (!info) return '<span class="status-none">&mdash;</span>';
  if (info.status === 'complete') {
    const mins = info.elapsed_sec ? Math.floor(info.elapsed_sec / 60) + 'm' : '';
    return '<span class="status-complete">&#10003; ' + info.meds_done + '/' + info.meds_total + '</span>' + (mins ? ' <small>' + mins + '</small>' : '');
  }
  return '<span class="status-partial">' + info.meds_done + '/' + info.meds_total + '</span>';
}

function eventHtml(events) {
  return events.map(e => {
    const t = new Date(e.created_at + 'Z').toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    let desc = e.event_type;
    if (e.medication_name) desc = e.medication_name;
    const eyeH = e.medication_eye ? ' <span class="med-eye ' + e.medication_eye + '">' + e.medication_eye + '</span>' : '';
    const idxH = e.med_index != null ? ' (' + (e.med_index + 1) + '/' + e.med_total + ')' : '';
    return '<div class="event-row"><div><span class="event-type ' + e.event_type + '">' + e.event_type.replace(/_/g, ' ') + '</span> ' + desc + idxH + eyeH + '</div><div>' + t + '</div></div>';
  }).join('');
}

function render() {
  const el = document.getElementById('calendar');
  if (!calendarData.length) {
    el.innerHTML = '<div class="empty">No sessions recorded yet. Run a session on the device to see events here.</div>';
    return;
  }
  let html = '<table class="cal-table"><thead><tr><th>Date</th><th>Morning</th><th>Midday</th><th>Evening</th></tr></thead><tbody>';
  calendarData.forEach((day, di) => {
    html += '<tr class="cal-row" onclick="toggleDay(' + di + ')">';
    html += '<td class="cal-date">' + fmtDate(day.date) + '</td>';
    html += '<td class="cal-cell">' + cellHtml(day.sessions.Morning) + '</td>';
    html += '<td class="cal-cell">' + cellHtml(day.sessions.Midday) + '</td>';
    html += '<td class="cal-cell">' + cellHtml(day.sessions.Evening) + '</td>';
    html += '</tr>';
    // Detail row
    html += '<tr class="detail-row" id="detail-' + di + '"><td class="detail-cell" colspan="4">';
    ['Morning', 'Midday', 'Evening'].forEach(sn => {
      const info = day.sessions[sn];
      if (info && info.session_id && sessionsCache[info.session_id]) {
        html += '<div class="session-label"><span>' + sn + '</span><button class="clear-btn" onclick="clearSession(event, \\'' + info.session_id + '\\')">Clear</button></div>';
        html += eventHtml(sessionsCache[info.session_id].events);
      }
    });
    html += '</td></tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function toggleDay(idx) {
  const row = document.getElementById('detail-' + idx);
  row.classList.toggle('open');
}

async function clearSession(e, sessionId) {
  e.stopPropagation();
  if (!confirm('Clear this session? The device will allow it to be logged again.')) return;
  try {
    const res = await fetch('/api/session/' + sessionId, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) load();
  } catch (err) {
    console.error('Clear error:', err);
  }
}

load();
setInterval(load, 30000);
</script>
</body>
</html>`;

app.listen(PORT, '0.0.0.0', () => {
  console.log('Eyedrop dashboard running at http://0.0.0.0:' + PORT);
});
