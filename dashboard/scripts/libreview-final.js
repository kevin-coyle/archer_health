#!/usr/bin/env node
/**
 * Complete LibreView CSV scraper - FINAL VERSION
 * Tested and working as of 2026-03-08
 */

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const LIBREVIEW_URL = 'https://www.libreview.com/';
const DOWNLOAD_DIR = path.join(__dirname, '../downloads');

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

async function getLatest2FACode() {
  console.log('Fetching 2FA code from forwarded email...');
  
  try {
    // Wait a bit for email to arrive
    await new Promise(r => setTimeout(r, 2000));
    
    const result = execSync(
      `gog gmail search "from:kevincoyle@gmail.com subject:LibreView" --account=suzy@drutek.com --max=1 --json`,
      { encoding: 'utf-8' }
    );
    
    const data = JSON.parse(result);
    if (!data.threads || data.threads.length === 0) {
      throw new Error('No forwarded 2FA email found');
    }
    
    const threadId = data.threads[0].id;
    
    const fullEmail = execSync(
      `gog gmail thread get ${threadId} --account=suzy@drutek.com`,
      { encoding: 'utf-8' }
    );
    
    const codeMatch = fullEmail.match(/\b(\d{6})\b/);
    
    if (!codeMatch) {
      throw new Error('Could not extract 2FA code from email');
    }
    
    console.log(`Found 2FA code: ${codeMatch[1]}`);
    return codeMatch[1];
    
  } catch (error) {
    console.error('Error fetching 2FA code:', error.message);
    throw error;
  }
}

async function downloadLibreViewCSV() {
  console.log('Starting LibreView CSV download...');
  
  const browser = await chromium.launch({
    headless: true,
    downloadsPath: DOWNLOAD_DIR
  });
  
  const context = await browser.newContext({
    acceptDownloads: true
  });
  
  const page = await context.newPage();
  
  try {
    // Step 1: Navigate to LibreView
    console.log('Loading homepage...');
    await page.goto(LIBREVIEW_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);
    
    // Step 2: Accept cookies if present
    console.log('Checking for cookies...');
    try {
      await page.click('button:has-text("AGREE & PROCEED")', { timeout: 5000 });
      await page.waitForTimeout(2000);
    } catch (e) {
      console.log('No cookie banner');
    }
    
    // Step 3: Select UK
    console.log('Selecting UK...');
    await page.selectOption('select', { value: 'GB' });
    await page.waitForTimeout(1000);
    
    // Step 4: Click Submit
    console.log('Submitting...');
    await page.click('button:has-text("Submit")');
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await page.waitForTimeout(2000);
    
    // Step 5: Login
    console.log('Logging in...');
    await page.waitForSelector('#loginForm-email-input', { timeout: 10000 });
    
    // Fill email with proper event triggering
    await page.evaluate((email) => {
      const input = document.querySelector('#loginForm-email-input');
      input.value = email;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    }, process.env.LIBREVIEW_EMAIL);
    await page.waitForTimeout(500);
    
    // Fill password with proper event triggering
    await page.evaluate((password) => {
      const input = document.querySelector('#loginForm-password-input');
      input.value = password;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    }, process.env.LIBREVIEW_PASSWORD);
    await page.waitForTimeout(1000);
    
    // Click login
    await page.click('button:has-text("Log in")');
    await page.waitForTimeout(5000);
    
    // Step 6: Select email 2FA method
    console.log('Selecting email 2FA...');
    await page.selectOption('select', { label: 'Send to email address' });
    await page.waitForTimeout(1000);
    
    // Step 7: Send code
    console.log('Requesting 2FA code...');
    await page.click('button:has-text("Send Code")');
    await page.waitForTimeout(2000);
    
    // Step 8: Wait for email and get code
    console.log('Waiting for 2FA email (15s)...');
    await page.waitForTimeout(15000);
    
    const code = await getLatest2FACode();
    
    // Step 9: Enter code
    console.log('Entering 2FA code...');
    const codeInput = page.locator('input[placeholder=" "]').first();
    await codeInput.fill(code);
    await page.waitForTimeout(1000);
    
    // Step 10: Verify and log in
    console.log('Verifying...');
    await page.click('button:has-text("Verify and Log in")');
    await page.waitForTimeout(5000);
    
    // Step 11: Click download button
    console.log('Opening download dialog...');
    await page.click('button:has-text("Download glucose data")');
    await page.waitForTimeout(2000);
    
    // Step 12: Download CSV
    console.log('Downloading CSV...');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.click('button:has-text("Download")')
    ]);
    
    const timestamp = Date.now();
    const filename = `libreview-${timestamp}.csv`;
    const downloadPath = path.join(DOWNLOAD_DIR, filename);
    await download.saveAs(downloadPath);
    
    console.log(`✅ CSV downloaded: ${downloadPath}`);
    
    await browser.close();
    return downloadPath;
    
  } catch (error) {
    const screenshotPath = path.join(DOWNLOAD_DIR, `error-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.error(`Error: ${error.message}`);
    console.error(`Screenshot saved: ${screenshotPath}`);
    await browser.close();
    throw error;
  }
}

if (require.main === module) {
  downloadLibreViewCSV()
    .then(csvPath => {
      console.log('🎉 Success!');
      console.log(`CSV file: ${csvPath}`);
      console.log('\nNext step: Import to database with:');
      console.log(`  node scripts/import-glucose.js ${csvPath}`);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Failed:', error.message);
      process.exit(1);
    });
}

module.exports = { downloadLibreViewCSV };
