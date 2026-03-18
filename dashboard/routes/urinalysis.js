/**
 * Urinalysis dipstick logging API routes
 */

const express = require('express');
const router = express.Router();

function urinalysisRoutes(db) {
  // POST /api/urinalysis — log a dipstick result
  router.post('/', (req, res) => {
    const { timestamp, glucose, ketones, ph, specific_gravity, protein, blood, leukocytes, nitrite, bilirubin, urobilinogen, notes } = req.body;

    try {
      const result = db.prepare(`
        INSERT INTO urinalysis (timestamp, glucose, ketones, ph, specific_gravity, protein, blood, leukocytes, nitrite, bilirubin, urobilinogen, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        timestamp || new Date().toISOString(),
        glucose || null,
        ketones || null,
        ph || null,
        specific_gravity || null,
        protein || null,
        blood || null,
        leukocytes || null,
        nitrite || null,
        bilirubin || null,
        urobilinogen || null,
        notes || null
      );

      res.json({ ok: true, id: result.lastInsertRowid });
    } catch (err) {
      console.error('Urinalysis insert error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/urinalysis/recent?limit=10 — get recent results
  router.get('/recent', (req, res) => {
    const limit = parseInt(req.query.limit) || 10;

    try {
      const results = db.prepare(`
        SELECT *
        FROM urinalysis
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(limit);

      res.json({ results });
    } catch (err) {
      console.error('Urinalysis query error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/urinalysis/:id — get single result
  router.get('/:id', (req, res) => {
    const id = parseInt(req.params.id);

    try {
      const result = db.prepare('SELECT * FROM urinalysis WHERE id = ?').get(id);

      if (!result) {
        return res.status(404).json({ error: 'Not found' });
      }

      res.json(result);
    } catch (err) {
      console.error('Urinalysis query error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = urinalysisRoutes;
