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
  
  // LibreView CSV format:
  // Device,Serial Number,Device Timestamp,Record Type,Historic Glucose mmol/L,...
  // Column 0: Device (FreeStyle Libre)
  // Column 2: Device Timestamp
  // Column 3: Record Type (0=historic, 1=scan)
  // Column 4: Historic Glucose mmol/L
  
  const dataLines = lines.slice(1).filter(line => line.trim().length > 0); // Skip 1 header row
  const readings = [];
  
  for (const line of dataLines) {
    // Simple CSV parser (doesn't handle quoted commas - upgrade if needed)
    const fields = line.split(',').map(f => f.replace(/^"|"$/g, '').trim());
    
    if (fields.length < 5) continue;
    
    const timestamp = fields[2]; // "Device Timestamp" (column 2)
    const recordType = fields[3]; // "Record Type" (column 3)
    const historicGlucose = fields[4]; // "Historic Glucose mmol/L" (column 4)
    const scanGlucose = fields[5]; // "Scan Glucose mmol/L" (column 5)
    
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
