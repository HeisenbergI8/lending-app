// Shared helper: signs in as DEMO only, and refuses to run if "demo" is not the demo account.
import { chromium } from '/Users/johnrossrivera/.claude/skills/code-video/node_modules/playwright/index.mjs'
export const B = 'http://localhost:3456'
export async function demoSession() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(`${B}/login`)
  await page.fill('input[name="username"]', 'demo')
  await page.fill('input[name="password"]', 'demo1234')
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 })
  // The page header shows the signed-in username; stop unless it is demo.
  const who = await page.locator('text=Demo data').count()
  if (who === 0) { await browser.close(); throw new Error('SAFETY STOP: not signed in as the demo account') }
  const ask = async (turns) => (await page.request.post(`${B}/api/assistant`, { data: { messages: turns }, timeout: 300000 })).json()
  const act = async (action, fields, funders = [], file = null) => {
    if ((await page.locator('text=Demo data').count()) === 0) throw new Error('SAFETY STOP: lost demo session')
    const multipart = { action, fields: JSON.stringify(fields), funders: JSON.stringify(funders) }
    if (file) multipart.proof = file
    return (await page.request.post(`${B}/api/assistant/act`, { multipart, timeout: 120000 })).json()
  }
  return { browser, page, ask, act }
}
