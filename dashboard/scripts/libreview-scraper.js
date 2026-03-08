#!/usr/bin/env node
/**
 * LibreView CSV Scraper with automated 2FA via Gmail
 * Usage: node scripts/libreview-scraper.js
 */

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const LIBREVIEW_URL = 'https://www.libreview.com/';
const DOWNLOAD_DIR = path.join(__dirname, '../downloads');

// Ensure download directory exists
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

async function getLatest2FACode() {
  console.log('Fetching 2FA code from Gmail...');
  
  try {
    // Search for latest verification code email
    const result = execSync(
      `gog gmail search "from:do-not-reply@libreview.io subject:verification" --account=suzy@drutek.com --max=1 --json`,
      { encoding: 'utf-8' }
    );
    
    const data = JSON.parse(result);
    if (!data.threads || data.threads.length === 0) {
      throw new Error('No 2FA email found');
    }
    
    const threadId = data.threads[0].id;
    
    // Get email body
    const threadResult = execSync(
      `gog gmail thread get ${threadId} --account=suzy@drutek.com --json`,
      { encoding: 'utf-8' }
    );
    
    const threadData = JSON.parse(threadResult);
    const body = threadData.messages[0]?.snippet || threadData.messages[0]?.body || '';
    
    // Extract 6-digit code (common format for 2FA codes)
    const codeMatch = body.match(/\b(\d{6})\b/);
    
    if (!codeMatch) {
      console.error('Email body:', body);
      throw new Error('Could not extract 2FA code from email');
    }
    
    console.log(`Found 2FA code: ${codeMatch[1]}`);
    return codeMatch[1];
    
  } catch (error) {
    console.error('Error fetching 2FA code:', error.message);
    throw error;
  }
}

async function exportLibreViewCSV() {
  console.log('Starting LibreView CSV export...');
  
  const browser = await chromium.launch({ 
    headless: true,
    downloadsPath: DOWNLOAD_DIR
  });
  
  const context = await browser.newContext({
    acceptDownloads: true
  });
  
  const page = await context.newPage();
  
  try {
    // Navigate to LibreView
    console.log('Navigating to LibreView...');
    await page.goto(LIBREVIEW_URL, { timeout: 60000 });
    
    // Accept cookies if prompted
    console.log('Checking for cookie consent...');
    const cookieButton = page.locator('button:has-text("AGREE & PROCEED")');
    if (await cookieButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await cookieButton.click({ force: true });
      console.log('Accepted cookies');
      // Wait for banner to fully dismiss
      await page.waitForTimeout(2000);
    }
    
    // Select country/region (UK)
    console.log('Selecting country/region...');
    await page.waitForSelector('select', { timeout: 10000 });
    await page.selectOption('select', { value: 'GB' }); // United Kingdom
    console.log('Selected UK');
    
    // Wait for any loading overlays to disappear
    await page.waitForTimeout(1000);
    
    // Click Submit with force (bypass overlay checks) and wait for navigation
    console.log('Clicking Submit...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }),
      page.click('button:has-text("Submit")', { force: true })
    ]);
    console.log('Navigated to login page');
    
    // Login
    console.log('Filling login form...');
    await page.waitForSelector('text=Member login', { timeout: 15000 });
    
    // Fill email
    const emailInput = page.locator('input[placeholder=" "]').first();
    await emailInput.fill(process.env.LIBREVIEW_EMAIL);
    console.log('Filled email');
    
    // Fill password
    const passwordInput = page.locator('input[placeholder=" "]').nth(1);
    await passwordInput.fill(process.env.LIBREVIEW_PASSWORD);
    console.log('Filled password');
    
    // Click Log in button
    await page.click('button:has-text("Log in")');
    
    // Wait for 2FA prompt (selector might need adjustment)
    console.log('Waiting for 2FA prompt...');
    await page.waitForSelector('input[name*="code"], input[name*="verification"]', { timeout: 15000 });
    
    // Wait 10 seconds for email to arrive
    console.log('Waiting for 2FA email to arrive...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Fetch and enter 2FA code
    const code = await getLatest2FACode();
    await page.fill('input[name*="code"], input[name*="verification"]', code);
    await page.click('button[type="submit"]');
    
    // Wait for dashboard to load
    console.log('Waiting for dashboard...');
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
    
    // Navigate to export/download page
    // NOTE: These selectors are guesses - will need to be adjusted after manual exploration
    console.log('Looking for export option...');
    
    // Try clicking on Reports or Data Export link
    const exportLink = page.locator('text=/reports|export|download/i').first();
    if (await exportLink.isVisible()) {
      await exportLink.click();
      await page.waitForLoadState('networkidle');
    }
    
    // Look for CSV download button
    const downloadButton = page.locator('text=/download|export.*csv/i').first();
    if (await downloadButton.isVisible()) {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        downloadButton.click()
      ]);
      
      const filename = `libreview-${Date.now()}.csv`;
      const downloadPath = path.join(DOWNLOAD_DIR, filename);
      await download.saveAs(downloadPath);
      
      console.log(`CSV downloaded: ${downloadPath}`);
      await browser.close();
      return downloadPath;
    } else {
      throw new Error('Could not find download button');
    }
    
  } catch (error) {
    console.error('Scraper error:', error.message);
    
    // Take screenshot for debugging
    const screenshotPath = path.join(DOWNLOAD_DIR, `error-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Debug screenshot saved: ${screenshotPath}`);
    
    await browser.close();
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  exportLibreViewCSV()
    .then(csvPath => {
      console.log('✅ Export complete:', csvPath);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Export failed:', error);
      process.exit(1);
    });
}

module.exports = { exportLibreViewCSV };
