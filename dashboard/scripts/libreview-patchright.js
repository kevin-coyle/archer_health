#!/usr/bin/env node
/**
 * LibreView scraper using patchright (Playwright with anti-bot patches)
 * Better than vanilla Playwright for bypassing bot detection
 */

const { chromium } = require('patchright');
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
  console.log('Fetching 2FA code from Gmail...');
  
  try {
    const result = execSync(
      `gog gmail search "from:do-not-reply@libreview.io subject:verification" --account=suzy@drutek.com --max=1 --json`,
      { encoding: 'utf-8' }
    );
    
    const data = JSON.parse(result);
    if (!data.threads || data.threads.length === 0) {
      throw new Error('No 2FA email found');
    }
    
    const threadId = data.threads[0].id;
    
    const threadResult = execSync(
      `gog gmail thread get ${threadId} --account=suzy@drutek.com --json`,
      { encoding: 'utf-8' }
    );
    
    const threadData = JSON.parse(threadResult);
    const body = threadData.thread?.messages?.[0]?.snippet || '';
    
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

async function scrapeLibreView() {
  console.log('Starting LibreView scraper with patchright...');
  
  // Launch patchright browser (patched Chromium)
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox'
    ]
  });
  
  const context = await browser.newContext({
    acceptDownloads: true,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();
  
  try {
    // Navigate to LibreView
    console.log('Navigating to LibreView...');
    await page.goto(LIBREVIEW_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    
    // Screenshot for debugging
    await page.screenshot({ path: path.join(DOWNLOAD_DIR, 'step1-homepage.png') });
    
    // Accept cookies
    console.log('Accepting cookies...');
    try {
      await page.click('button:has-text("AGREE & PROCEED")', { timeout: 5000 });
      await page.waitForTimeout(2000);
    } catch (e) {
      console.log('No cookie banner or already accepted');
    }
    
    // Select UK
    console.log('Selecting UK...');
    await page.selectOption('select', { value: 'GB' });
    await page.waitForTimeout(1000);
    
    // Click Submit
    console.log('Clicking Submit...');
    await page.click('button:has-text("Submit")');
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await page.waitForTimeout(3000);
    
    await page.screenshot({ path: path.join(DOWNLOAD_DIR, 'step2-login-page.png') });
    
    // Fill login
    console.log('Filling login form...');
    const emailInput = await page.locator('input[placeholder=" "]').first();
    await emailInput.fill(process.env.LIBREVIEW_EMAIL);
    
    const passwordInput = await page.locator('input[placeholder=" "]').nth(1);
    await passwordInput.fill(process.env.LIBREVIEW_PASSWORD);
    
    // Click login
    console.log('Logging in...');
    await page.click('button:has-text("Log in")');
    await page.waitForTimeout(8000); // Wait for 2FA prompt
    
    await page.screenshot({ path: path.join(DOWNLOAD_DIR, 'step3-2fa-prompt.png') });
    
    // Wait for 2FA email
    console.log('Waiting for 2FA email (10s)...');
    await page.waitForTimeout(10000);
    
    // Get and enter code
    const code = await getLatest2FACode();
    console.log('Entering 2FA code...');
    
    const codeInput = await page.locator('input[name*="code"], input[name*="verification"]').first();
    await codeInput.fill(code);
    
    await page.click('button[type="submit"]');
    await page.waitForTimeout(5000);
    
    await page.screenshot({ path: path.join(DOWNLOAD_DIR, 'step4-dashboard.png') });
    
    console.log('✅ Login successful! Check screenshots in downloads/ for next steps.');
    console.log('Now you need to manually identify the CSV export button selectors.');
    
    await browser.close();
    return true;
    
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
  scrapeLibreView()
    .then(() => {
      console.log('Done!');
      process.exit(0);
    })
    .catch(error => {
      console.error('Failed:', error);
      process.exit(1);
    });
}
