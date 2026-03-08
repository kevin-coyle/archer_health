/**
 * Glucose monitoring API routes
 */

const express = require('express');
const router = express.Router();

function glucoseRoutes(db) {
  const LIBRE_OFFSET = parseFloat(process.env.LIBRE_OFFSET) || 3.2;
  
  // GET /api/glucose/recent?hours=24 - Latest glucose readings
  router.get('/recent', (req, res) => {
    const hours = parseInt(req.query.hours) || 24;
    
    try {
      const readings = db.prepare(`
        SELECT 
          id,
          timestamp,
          libre_reading,
          libre_reading + ? as adjusted_reading,
          alphatrak_reading,
          trend,
          source,
          notes
        FROM glucose_readings
        WHERE datetime(timestamp) >= datetime('now', '-' || ? || ' hours')
        ORDER BY timestamp DESC
      `).all(LIBRE_OFFSET, hours);
      
      res.json({ readings, libre_offset: LIBRE_OFFSET });
    } catch (err) {
      console.error('Glucose query error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });
  
  // GET /api/glucose/stats - Daily statistics
  router.get('/stats', (req, res) => {
    try {
      const stats = db.prepare(`
        SELECT 
          COUNT(*) as reading_count,
          AVG(libre_reading) as avg_libre,
          MIN(libre_reading) as min_libre,
          MAX(libre_reading) as max_libre,
          AVG(libre_reading + ?) as avg_adjusted,
          MIN(libre_reading + ?) as min_adjusted,
          MAX(libre_reading + ?) as max_adjusted
        FROM glucose_readings
        WHERE datetime(timestamp) >= datetime('now', '-24 hours')
      `).get(LIBRE_OFFSET, LIBRE_OFFSET, LIBRE_OFFSET);
      
      res.json({ stats, libre_offset: LIBRE_OFFSET });
    } catch (err) {
      console.error('Stats query error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });
  
  // POST /api/glucose - Add manual reading
  router.post('/', (req, res) => {
    const { libre_reading, alphatrak_reading, trend, notes } = req.body;
    
    if (!libre_reading && !alphatrak_reading) {
      return res.status(400).json({ error: 'At least one reading required' });
    }
    
    try {
      const result = db.prepare(`
        INSERT INTO glucose_readings (timestamp, libre_reading, alphatrak_reading, trend, source, notes)
        VALUES (datetime('now'), ?, ?, ?, 'manual', ?)
      `).run(
        libre_reading || null,
        alphatrak_reading || null,
        trend || null,
        notes || null
      );
      
      res.json({ ok: true, id: result.lastInsertRowid });
    } catch (err) {
      console.error('Insert error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });
  
  // GET /api/insulin/recent?days=7 - Recent insulin doses
  router.get('/insulin/recent', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    
    try {
      const doses = db.prepare(`
        SELECT *
        FROM insulin_doses
        WHERE datetime(timestamp) >= datetime('now', '-' || ? || ' days')
        ORDER BY timestamp DESC
      `).all(days);
      
      res.json({ doses });
    } catch (err) {
      console.error('Insulin query error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });
  
  // POST /api/insulin - Log insulin dose
  router.post('/insulin', (req, res) => {
    const { meal_time, dose_units, libre_reading, notes } = req.body;
    
    if (!dose_units || !meal_time) {
      return res.status(400).json({ error: 'dose_units and meal_time required' });
    }
    
    if (!['morning', 'evening'].includes(meal_time)) {
      return res.status(400).json({ error: 'meal_time must be morning or evening' });
    }
    
    try {
      const result = db.prepare(`
        INSERT INTO insulin_doses (timestamp, meal_time, dose_units, libre_reading, notes)
        VALUES (datetime('now'), ?, ?, ?, ?)
      `).run(meal_time, dose_units, libre_reading || null, notes || null);
      
      res.json({ ok: true, id: result.lastInsertRowid });
    } catch (err) {
      console.error('Insulin insert error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });
  
  // POST /api/intervention - Log honey/food intervention
  router.post('/intervention', (req, res) => {
    const { intervention_type, amount, libre_reading, reason } = req.body;
    
    if (!intervention_type) {
      return res.status(400).json({ error: 'intervention_type required' });
    }
    
    if (!['honey', 'food', 'emergency'].includes(intervention_type)) {
      return res.status(400).json({ error: 'Invalid intervention_type' });
    }
    
    try {
      const result = db.prepare(`
        INSERT INTO interventions (timestamp, intervention_type, amount, libre_reading, reason)
        VALUES (datetime('now'), ?, ?, ?, ?)
      `).run(intervention_type, amount || null, libre_reading || null, reason || null);
      
      res.json({ ok: true, id: result.lastInsertRowid });
    } catch (err) {
      console.error('Intervention insert error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });
  
  // GET /api/interventions/recent?days=7
  router.get('/interventions/recent', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    
    try {
      const interventions = db.prepare(`
        SELECT *
        FROM interventions
        WHERE datetime(timestamp) >= datetime('now', '-' || ? || ' days')
        ORDER BY timestamp DESC
      `).all(days);
      
      res.json({ interventions });
    } catch (err) {
      console.error('Interventions query error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });
  
  return router;
}

module.exports = glucoseRoutes;
