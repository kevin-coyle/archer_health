const express = require('express');
const router = express.Router();

module.exports = function(db) {
  // POST /api/health - Receive Health Auto Export data
  router.post('/', (req, res) => {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    if (apiKey !== process.env.HEALTH_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const data = req.body?.data;
    if (!data) {
      return res.status(400).json({ error: 'No data field in payload' });
    }

    const insert = db.prepare(`
      INSERT INTO health_metrics (metric_name, date, qty, units, raw_json)
      VALUES (?, ?, ?, ?, ?)
    `);

    let count = 0;

    // Process metrics array
    if (data.metrics && Array.isArray(data.metrics)) {
      for (const metric of data.metrics) {
        const name = metric.name;
        const units = metric.units;
        if (metric.data && Array.isArray(metric.data)) {
          for (const point of metric.data) {
            // Sleep data has different structure
            if (name === 'sleep_analysis') {
              insert.run(name, point.date || point.startDate, point.totalSleep || point.qty || 0, units, JSON.stringify(point));
            } else {
              insert.run(name, point.date, point.qty ?? point.Avg ?? 0, units, JSON.stringify(point));
            }
            count++;
          }
        }
      }
    }

    // Process workouts array
    if (data.workouts && Array.isArray(data.workouts)) {
      const insertWorkout = db.prepare(`
        INSERT INTO health_workouts (name, start, end, duration, calories, distance, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const w of data.workouts) {
        insertWorkout.run(
          w.name || 'Unknown',
          w.start,
          w.end,
          w.duration || 0,
          w.activeEnergy || 0,
          w.distance || 0,
          JSON.stringify(w)
        );
        count++;
      }
    }

    console.log(`[health-export] Received ${count} data points`);
    res.json({ ok: true, count });
  });

  // GET /api/health/sleep?days=7
  router.get('/sleep', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const rows = db.prepare(`
      SELECT date, qty, units, raw_json FROM health_metrics
      WHERE metric_name = 'sleep_analysis'
      ORDER BY date DESC LIMIT ?
    `).all(days);
    
    res.json({ results: rows.map(r => ({ ...r, details: JSON.parse(r.raw_json) })) });
  });

  // GET /api/health/metrics/:name?days=7
  router.get('/metrics/:name', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const rows = db.prepare(`
      SELECT date, qty, units FROM health_metrics
      WHERE metric_name = ? AND date >= datetime('now', '-' || ? || ' days')
      ORDER BY date DESC
    `).all(req.params.name, days);
    
    res.json({ results: rows });
  });

  // GET /api/health/workouts?days=30
  router.get('/workouts', (req, res) => {
    const days = parseInt(req.query.days) || 30;
    const rows = db.prepare(`
      SELECT name, start, end, duration, calories, distance FROM health_workouts
      WHERE start >= datetime('now', '-' || ? || ' days')
      ORDER BY start DESC
    `).all(days);
    
    res.json({ results: rows });
  });

  // GET /api/health/summary - Quick overview
  router.get('/summary', (req, res) => {
    const lastSleep = db.prepare(`
      SELECT date, qty, units, raw_json FROM health_metrics
      WHERE metric_name = 'sleep_analysis' ORDER BY date DESC LIMIT 1
    `).get();
    
    const lastWorkout = db.prepare(`
      SELECT name, start, duration, calories FROM health_workouts
      ORDER BY start DESC LIMIT 1
    `).get();

    const todaySteps = db.prepare(`
      SELECT SUM(qty) as total FROM health_metrics
      WHERE metric_name = 'step_count' AND date >= date('now')
    `).get();

    res.json({
      lastSleep: lastSleep ? { ...lastSleep, details: JSON.parse(lastSleep.raw_json) } : null,
      lastWorkout,
      todaySteps: todaySteps?.total || 0
    });
  });

  return router;
};
