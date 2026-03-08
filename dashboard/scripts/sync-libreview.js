#!/usr/bin/env node
/**
 * Combined script: Download from LibreView → Import to database
 * Usage: node scripts/sync-libreview.js
 */

const { downloadLibreViewCSV } = require('./libreview-final');
const { parseLibreCSV, importReadings } = require('./import-glucose');
const fs = require('fs');

async function sync() {
  console.log('🔄 Starting LibreView sync...\n');
  
  try {
    // Step 1: Download CSV
    console.log('Step 1: Downloading CSV from LibreView...');
    const csvPath = await downloadLibreViewCSV();
    console.log(`✅ CSV downloaded: ${csvPath}\n`);
    
    // Step 2: Parse and import
    console.log('Step 2: Importing readings to database...');
    const readings = parseLibreCSV(csvPath);
    importReadings(readings);
    console.log(`✅ Imported ${readings.length} readings\n`);
    
    // Step 3: Cleanup (keep CSV for debugging)
    console.log('Step 3: Keeping CSV for records...');
    console.log(`CSV saved at: ${csvPath}\n`);
    
    console.log('🎉 Sync complete!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Sync failed:', error.message);
    process.exit(1);
  }
}

sync();
