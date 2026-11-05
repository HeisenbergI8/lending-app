// THROWAWAY manual verification script for the action-sounds feature.
// Not part of the `npm test` suite (doesn't match *.test.ts). Run directly with:
//   node tests/ui/manual-sound-verify.mjs
// Requires the `playwright` package, installed separately in a scratch dir
// (not added to package.json) and a dev server already running on :3001.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:3001';
const SHOT_DIR = process.env.SOUND_SHOT_DIR || path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const consoleErrors = [];
const pageErrors = [];
const log = [];

function record(step, msg) {
  const line = `[${step}] ${msg}`;
  log.push(line);
  console.log(line);
}

async function shot(page, name) {
  const p = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  return p;
}

async function soundsSince(page) {
  return await page.evaluate(() => {
    const s = window.__sounds || [];
    window.__sounds = [];
    return s;
  });
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  await context.addInitScript(() => {
    window.__sounds = [];
    const origOsc = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (...args) {
      window.__sounds.push({ kind: 'oscillator', t: Date.now() });
      return origOsc.apply(this, args);
    };
    const origBuf = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function (...args) {
      window.__sounds.push({ kind: 'bufferSource', t: Date.now() });
      return origBuf.apply(this, args);
    };
  });

  const results = {};

  try {
    // ---------- LOGIN ----------
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await shot(page, '01-login');
    await page.mouse.click(10, 10); // unlock AudioContext per sound.ts's wake listener
    await page.fill('input[name="username"]', 'demo');
    await page.fill('input[name="password"]', 'demo1234');
    await soundsSince(page);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    const loginSounds = await soundsSince(page);
    results.login = loginSounds.length;
    record('login', `landed on ${page.url()}, oscillator/bufferSource calls = ${loginSounds.length}`);
    await shot(page, '02-dashboard-after-login');

    // ---------- CREATE BORROWER (success -> 'create') ----------
    await page.goto(`${BASE}/borrowers`, { waitUntil: 'networkidle' });
    await soundsSince(page);
    const testName = `Zzztest-${Date.now()}`;
    await page.click('button:has-text("Add borrower")');
    await page.waitForSelector('#firstName');
    await page.fill('#firstName', testName);
    await page.fill('#lastName', 'SoundTest');
    await page.click('button[type="submit"]:has-text("Add borrower")');
    await page.waitForSelector(`text=${testName}`, { timeout: 10000 });
    await page.waitForTimeout(200);
    const createSounds = await soundsSince(page);
    results.create = createSounds.length;
    record('create-borrower', `dialog closed, borrower "${testName}" visible, sound calls = ${createSounds.length}`);
    await shot(page, '03-borrower-created');

    // ---------- FAILING SUBMIT (duplicate name -> 'error') ----------
    await page.click('button:has-text("Add borrower")');
    await page.waitForSelector('#firstName');
    await page.fill('#firstName', testName);
    await page.fill('#lastName', 'SoundTest');
    await soundsSince(page);
    await page.click('button[type="submit"]:has-text("Add borrower")');
    await page.waitForSelector('[role="alert"]', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(300);
    const errorSounds = await soundsSince(page);
    const errorAlertVisible = await page.locator('[role="alert"]').first().isVisible().catch(() => false);
    results.error = errorSounds.length;
    results.errorAlertVisible = errorAlertVisible;
    record('duplicate-name-error', `alert visible=${errorAlertVisible}, sound calls = ${errorSounds.length}`);
    await shot(page, '04-duplicate-name-error');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // ---------- DELETE + RESTORE the test borrower ----------
    await page.click(`text=${testName}`);
    await page.waitForURL(/\/borrowers\//, { timeout: 10000 });
    await soundsSince(page);
    await page.click('button:has-text("Delete")');
    await page.waitForSelector('text=Delete borrower', { timeout: 5000 });
    await page.click('button:has-text("Delete borrower")');
    await page.waitForURL(/\/borrowers$/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    const trashSounds = await soundsSince(page);
    results.trash = trashSounds.length;
    record('delete-borrower', `redirected to ${page.url()}, sound calls = ${trashSounds.length}`);
    await shot(page, '05-borrower-deleted');

    await page.goto(`${BASE}/deleted?tab=borrowers`, { waitUntil: 'networkidle' });
    await soundsSince(page);
    const restoreRow = page.locator(`text=${testName}`).first();
    await restoreRow.waitFor({ timeout: 10000 });
    const restoreButton = page
      .locator(`xpath=//*[contains(text(),"${testName}")]/ancestor::*[self::li or self::div][1]//button[contains(., "Restore")]`)
      .first();
    await restoreButton.click({ timeout: 10000 }).catch(async () => {
      await page.click('button:has-text("Restore")');
    });
    await page.waitForSelector('text=Restore this borrower?', { timeout: 5000 });
    await page.click('button:has-text("Restore borrower")');
    await page.waitForSelector(`text=${testName}`, { state: 'detached', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
    const restoreSounds = await soundsSince(page);
    results.restore = restoreSounds.length;
    record('restore-borrower', `sound calls = ${restoreSounds.length}`);
    await shot(page, '06-borrower-restored');

    // cleanup: delete it again so it stays out of the active list
    await page.goto(`${BASE}/borrowers`, { waitUntil: 'networkidle' });
    await page.click(`text=${testName}`);
    await page.waitForURL(/\/borrowers\//, { timeout: 10000 });
    await page.click('button:has-text("Delete")');
    await page.waitForSelector('text=Delete borrower', { timeout: 5000 });
    await page.click('button:has-text("Delete borrower")');
    await page.waitForURL(/\/borrowers$/, { timeout: 10000 });
    record('cleanup', `test borrower "${testName}" re-deleted (left archived)`);

    // ---------- LENDER MONEY IN / OUT ----------
    await page.goto(`${BASE}/lenders`, { waitUntil: 'networkidle' });
    await page.click('text=John Ross Santos');
    await page.waitForURL(/\/lenders\//, { timeout: 10000 });
    await soundsSince(page);
    await page.click('button:has-text("Record money in or out")');
    await page.waitForSelector('input[name="amount"]');
    await page.fill('input[name="amount"]', '1.00');
    await page.fill('input[name="note"]', 'sound-verify cash in');
    if ((await page.inputValue('input[name="amount"]')) !== '1.00') throw new Error('amount fill did not stick (cash in)');
    await page.click('button[type="submit"]:has-text("Record it")');
    await page.waitForSelector('input[name="amount"]', { state: 'detached', timeout: 10000 });
    await page.waitForSelector('text=sound-verify cash in', { timeout: 10000 });
    await page.waitForTimeout(200);
    const cashInSounds = await soundsSince(page);
    results.cashIn = cashInSounds.length;
    record('lender-cash-in', `sound calls = ${cashInSounds.length}`);
    await shot(page, '07-lender-cash-in');

    await page.click('button:has-text("Record money in or out")');
    await page.waitForSelector('input[name="amount"]');
    await page.click('label:has-text("Money out") input[type="radio"]');
    await page.fill('input[name="amount"]', '1.00');
    await page.fill('input[name="note"]', 'sound-verify cash out');
    if ((await page.inputValue('input[name="amount"]')) !== '1.00') throw new Error('amount fill did not stick (cash out)');
    await soundsSince(page);
    await page.click('button[type="submit"]:has-text("Record it")');
    await page.waitForSelector('input[name="amount"]', { state: 'detached', timeout: 10000 });
    await page.waitForSelector('text=sound-verify cash out', { timeout: 10000 });
    await page.waitForTimeout(200);
    const cashOutSounds = await soundsSince(page);
    results.cashOut = cashOutSounds.length;
    record('lender-cash-out', `sound calls = ${cashOutSounds.length}`);
    await shot(page, '08-lender-cash-out');

    for (const label of ['sound-verify cash in', 'sound-verify cash out']) {
      const row = page.locator(`text=${label}`).first();
      if (await row.isVisible().catch(() => false)) {
        await row.click({ force: true });
        await page.waitForSelector('text=Edit entry', { timeout: 5000 }).catch(() => {});
        const delBtn = page.locator('button:has-text("Delete entry")').first();
        if (await delBtn.isVisible().catch(() => false)) {
          await delBtn.click();
          // Trigger and the AlertDialogAction share the label "Delete entry" -
          // .last() is the confirm button, portaled after the trigger in the DOM.
          await page.waitForSelector('text=Delete this entry?', { timeout: 5000 });
          await page.locator('button:has-text("Delete entry")').last().click();
          await page.waitForTimeout(400);
        }
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(200);
      }
    }
    record('cleanup', 'test lender transactions removed');

    // ---------- MARK LOAN PAID / UNDO ----------
    await page.goto(`${BASE}/loans/cmuat91dz0010c2oozkfubvql`, { waitUntil: 'networkidle' });
    await shot(page, '09-loan-before-paid');
    await soundsSince(page);
    const paidOnInput = page.locator('#paidOn');
    if (await paidOnInput.isVisible().catch(() => false)) {
      await page.click('button:has-text("Mark as paid")');
      await page.waitForSelector('text=Undo payment', { timeout: 10000 });
      await page.waitForTimeout(200);
      const markPaidSounds = await soundsSince(page);
      results.markPaid = markPaidSounds.length;
      record('mark-paid', `sound calls = ${markPaidSounds.length}`);
      await shot(page, '10-loan-marked-paid');

      await page.click('button:has-text("Undo payment")');
      await page.waitForSelector('text=Undo this payment?', { timeout: 5000 });
      // Trigger and the AlertDialogAction share the label "Undo payment" - .last()
      // is the confirm button, portaled after the trigger in the DOM.
      await page.locator('button:has-text("Undo payment")').last().click();
      await page.waitForSelector('text=Mark as paid', { timeout: 10000 });
      await page.waitForTimeout(200);
      const undoSounds = await soundsSince(page);
      results.undoPaid = undoSounds.length;
      record('undo-paid', `sound calls = ${undoSounds.length}`);
      await shot(page, '11-loan-undone');
    } else {
      record('mark-paid', 'SKIPPED - loan already paid or panel not found');
      results.markPaid = 'SKIPPED';
    }

    // ---------- MUTE TOGGLE ----------
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.click('[aria-label="Account"]');
    await page.waitForSelector('text=Sounds on', { timeout: 5000 });
    await shot(page, '12-account-menu-open');
    await soundsSince(page);
    await page.click('text=Sounds on');
    await page.waitForTimeout(150);
    await shot(page, '13-muted-menu');

    await page.keyboard.press('Escape');
    await page.goto(`${BASE}/borrowers`, { waitUntil: 'networkidle' });
    await page.click('button:has-text("Add borrower")');
    await page.waitForSelector('#firstName');
    await page.fill('#firstName', 'Angel');
    await page.fill('#lastName', 'Dela Cruz');
    await soundsSince(page);
    await page.click('button[type="submit"]:has-text("Add borrower")');
    await page.waitForTimeout(500);
    const mutedSounds = await soundsSince(page);
    results.mutedActionSoundCalls = mutedSounds.length;
    record('muted-action', `oscillator/bufferSource calls while muted = ${mutedSounds.length} (expect 0)`);
    await shot(page, '14-muted-duplicate-attempt');
    await page.keyboard.press('Escape');

    await page.click('[aria-label="Account"]');
    await page.waitForSelector('text=Sounds off', { timeout: 5000 });
    await page.click('text=Sounds off');
    await page.keyboard.press('Escape');
  } catch (err) {
    record('FATAL', String(err && err.stack ? err.stack : err));
    await shot(page, 'FATAL-state').catch(() => {});
  }

  record('console-errors', JSON.stringify(consoleErrors));
  record('page-errors', JSON.stringify(pageErrors));
  record('results', JSON.stringify(results, null, 2));

  fs.writeFileSync(path.join(SHOT_DIR, '..', 'run-log.txt'), log.join('\n'));

  await browser.close();
})();
