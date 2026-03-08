#!/usr/bin/env node
/**
 * Import LibreView CSV into glucose database
 * Usage: node scripts/import-glucose.js <csv-path>
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/eyedrops.db');

function parseLibreCSV(csvPath) {
  console.log(`Parsing CSV: ${csvPath}`);
  
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n');
  
  // LibreView CSVs typically have 2 header rows, then data
  // Format: "Device Timestamp","Record Type","Historic Glucose mmol/L","Scan Glucose mmol/L","Rapid-Acting Insulin (units)","Food","Notes"
  // We want: timestamp, glucose value, trend (if available)
  
  const dataLines = lines.slice(2).filter(line => line.trim().length > 0);
  const readings = [];
  
  for (const line of dataLines) {
    // Simple CSV parser (doesn't handle quoted commas - upgrade if needed)
    const fields = line.split(',').map(f => f.replace(/^"|"$/g, '').trim());
    
    if (fields.length < 3) continue;
    
    const timestamp = fields[0]; // "Device Timestamp"
    const recordType = fields[1]; // "Record Type" (0=historic, 1=scan)
    const historicGlucose = fields[2]; // "Historic Glucose mmol/L"
    const scanGlucose = fields[3]; // "Scan Glucose mmol/L"
    
    // Use historic if available, otherwise scan
    const glucose = historicGlucose || scanGlucose;
    
    if (!timestamp || !glucose || glucose === '') continue;
    
    const glucoseValue = parseFloat(glucose);
    if (isNaN(glucoseValue)) continue;
    
    readings.push({
      timestamp: timestamp,
      libre_reading: glucoseValue,
      trend: null, // LibreView CSV doesn't include trend arrows
      source: 'libreview_import'
    });
  }
  
  console.log(`Parsed ${readings.length} readings from CSV`);
  return readings;
}

function importReadings(readings) {
  const db = new Database(DB_PATH);
  
  // Run migration if tables don't exist
  const migrationPath = path.join(__dirname, '../migrations/add-glucose-tables.sql');
  if (fs.existsSync(migrationPath)) {
    console.log('Running database migration...');
    const migration = fs.readFileSync(migrationPath, 'utf-8');
    db.exec(migration);
  }
  
  const insert = db.prepare(`
    INSERT OR IGNORE INTO glucose_readings 
    (timestamp, libre_reading, trend, source)
    VALUES (?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((readings) => {
    for (const reading of readings) {
      insert.run(
        reading.timestamp,
        reading.libre_reading,
        reading.trend,
        reading.source
      );
    }
  });
  
  insertMany(readings);
  db.close();
  
  console.log(`✅ Imported ${readings.length} glucose readings`);
}

// CLI usage
if (require.main === module) {
  const csvPath = process.argv[2];
  
  if (!csvPath) {
    console.error('Usage: node import-glucose.js <csv-path>');
    process.exit(1);
  }
  
  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }
  
  try {
    const readings = parseLibreCSV(csvPath);
    importReadings(readings);
    console.log('Import complete!');
  } catch (error) {
    console.error('Import failed:', error.message);
    process.exit(1);
  }
}

module.exports = { parseLibreCSV, importReadings };
