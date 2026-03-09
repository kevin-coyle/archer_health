#!/usr/bin/env node

/**
 * Fetch real-time glucose readings from LibreView API (follower account)
 * Usage: node scripts/fetch-libre-realtime.js [--import]
 */

const https = require('https');
const crypto = require('crypto');
require('dotenv').config();

async function httpsRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${parsed.message || data}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function login() {
  const email = process.env.LIBREVIEW_FOLLOWER_EMAIL || 'kevincoyle+libre@gmail.com';
  const password = process.env.LIBREVIEW_PASSWORD;

  if (!email || !password) {
    throw new Error('LIBREVIEW_FOLLOWER_EMAIL and LIBREVIEW_PASSWORD must be set in .env');
  }

  console.error('🔐 Logging in to LibreView (follower account)...');

  const response = await httpsRequest({
    hostname: 'api-eu2.libreview.io',
    path: '/llu/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
      'Accept-Language': 'en-GB,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Connection': 'Keep-Alive',
      'product': 'llu.android',
      'version': '4.16.0'
    }
  }, {
    email,
    password
  });

  if (!response.data || !response.data.authTicket || !response.data.authTicket.token) {
    throw new Error('Login failed: no token in response');
  }

  console.error('✅ Login successful');
  return {
    token: response.data.authTicket.token,
    userId: response.data.user.id
  };
}

async function getConnections(token, userId) {
  console.error('📋 Fetching connections...');

  const accountId = crypto.createHash('sha256').update(userId).digest('hex');

  const response = await httpsRequest({
    hostname: 'api-eu2.libreview.io',
    path: '/llu/connections',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
      'Cache-Control': 'no-cache',
      'Connection': 'Keep-Alive',
      'product': 'llu.android',
      'version': '4.16.0',
      'account-id': accountId
    }
  });

  if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
    throw new Error('No connections found');
  }

  console.error(`✅ Found ${response.data.length} connection(s)`);
  return response.data[0]; // Return first connection (Archer/Kevin)
}

async function getGraphData(token, userId, patientId) {
  console.error(`📊 Fetching glucose graph data for patient ${patientId}...`);

  const accountId = crypto.createHash('sha256').update(userId).digest('hex');

  const response = await httpsRequest({
    hostname: 'api-eu2.libreview.io',
    path: `/llu/connections/${patientId}/graph`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
      'Cache-Control': 'no-cache',
      'Connection': 'Keep-Alive',
      'product': 'llu.android',
      'version': '4.16.0',
      'account-id': accountId
    }
  });

  if (!response.data || !response.data.graphData) {
    throw new Error('No graph data in response');
  }

  console.error(`✅ Fetched ${response.data.graphData.length} readings`);
  return response.data;
}

function convertToCSV(graphData, patientName, offset = 0) {
  let readings = graphData.graphData || [];
  
  // Add the latest glucoseMeasurement if it's newer than graphData
  if (graphData.connection && graphData.connection.glucoseMeasurement) {
    const latest = graphData.connection.glucoseMeasurement;
    const latestTimestamp = new Date(latest.Timestamp);
    const lastGraphTimestamp = readings.length > 0 ? new Date(readings[readings.length - 1].Timestamp) : null;
    
    // If glucoseMeasurement is newer, add it
    if (!lastGraphTimestamp || latestTimestamp > lastGraphTimestamp) {
      readings = [...readings, latest];
      console.error(`📍 Added latest reading from glucoseMeasurement: ${latest.Value} mmol/L at ${latest.Timestamp}`);
    }
  }
  
  console.error(`📝 Converting ${readings.length} readings to CSV...`);

  const rows = readings.map(reading => {
    const ts = new Date(reading.Timestamp);
    const value = parseFloat(reading.Value);
    const adjusted = offset ? (value + offset).toFixed(1) : value.toFixed(1);
    
    // CSV format matching LibreView export:
    // Device,Serial Number,Device Timestamp,Record Type,Historic Glucose mmol/L,...
    return [
      'FreeStyle Libre',
      '', // serial
      ts.toISOString().replace('T', ' ').replace('Z', ''),
      reading.type.toString(), // 0 = historic, 1 = scan
      adjusted,
      '', '', '', '', '', '' // empty columns for other fields
    ].join(',');
  });

  const header = 'Device,Serial Number,Device Timestamp,Record Type,Historic Glucose mmol/L,Scan Glucose mmol/L,Non-numeric Rapid-Acting Insulin,Rapid-Acting Insulin (units),Non-numeric Food,Carbohydrates (grams),Carbohydrates (servings),Non-numeric Long-Acting Insulin,Long-Acting Insulin (units),Notes,Strip Glucose mmol/L,Ketone mmol/L,Meal Insulin (units),Correction Insulin (units),User Change Insulin (units)';

  return [header, ...rows].join('\n');
}

async function importCSV(csvData) {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  
  const tmpFile = path.join(__dirname, `libre-realtime-${Date.now()}.csv`);
  fs.writeFileSync(tmpFile, csvData);
  
  console.error(`📥 Importing to database...`);
  
  try {
    execSync(`node ${path.join(__dirname, 'import-glucose.js')} ${tmpFile}`, {
      stdio: 'inherit'
    });
    fs.unlinkSync(tmpFile);
    console.error('✅ Import complete, temp file cleaned up');
  } catch (e) {
    console.error('❌ Import failed:', e.message);
    console.error(`Temp CSV saved at: ${tmpFile}`);
    process.exit(1);
  }
}

async function main() {
  const shouldImport = process.argv.includes('--import');

  try {
    const { token, userId } = await login();
    const connection = await getConnections(token, userId);
    
    console.error(`👤 Using connection: ${connection.firstName} (Patient ID: ${connection.patientId})`);
    console.error(`📍 Last reading: ${connection.glucoseMeasurement.Value} mmol/L at ${connection.glucoseMeasurement.Timestamp}`);
    
    const graphData = await getGraphData(token, userId, connection.patientId);
    
    const offset = parseFloat(process.env.LIBRE_OFFSET || 0);
    const csv = convertToCSV(graphData, connection.firstName, offset);
    
    if (shouldImport) {
      await importCSV(csv);
    } else {
      console.log(csv);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
