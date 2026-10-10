/**
 * MARKETING screenshot capture — isolated under /marketing, uses the local Playwright
 * install in marketing/node_modules (never touches the production app's dependencies).
 *
 * Logs into the local dev server (http://localhost:3000) with the seeded demo org's
 * credentials, then visits a fixed list of routes and screenshots each one into
 * marketing/screenshots/. Uses ONLY the fictional "Orion Auto Components" demo org
 * created by marketing/scripts-seed/seed-demo-org.ts — never real data.
 *
 * Usage:
 *   cd G:/Pro-ERP/marketing
 *   DEMO_EMAIL=... DEMO_PASSWORD=... node scripts-capture/capture-screens.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "screenshots");
mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const EMAIL = process.env.DEMO_EMAIL;
const PASSWORD = process.env.DEMO_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("Set DEMO_EMAIL and DEMO_PASSWORD env vars (from seed-demo-org.ts output).");
  process.exit(1);
}

const DESKTOP = { width: 1920, height: 1080 };
const MOBILE = { width: 390, height: 844 };

const SHOTS = [
  { id: "02-dashboard", path: "/dashboard" },
  { id: "03-leads", path: "/leads" },
  { id: "04-orders", path: "/orders" },
  { id: "05-pdi", path: "/pdi" },
  { id: "06-tms", path: "/tms" },
  { id: "07-dispatch", path: "/dispatch" },
  { id: "08-accounts", path: "/accounts" },
  { id: "09-fms-templates", path: "/fms/templates" },
  { id: "10-inventory", path: "/inventory" },
  { id: "11-tasks", path: "/tasks" },
  { id: "12-parties", path: "/parties" },
  { id: "13-ppc", path: "/ppc" },
  { id: "14-bom", path: "/bom" },
];
async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();

  // --- 01 — login page (logged out) ---
  // NOTE: "load" not "networkidle" — Next.js dev's HMR websocket stays open forever,
  // so "networkidle" never resolves and every navigation would time out.
  await page.goto(`${BASE_URL}/login`, { waitUntil: "load" });
  await page.screenshot({ path: path.join(OUT_DIR, "01-login.png") });
  console.log("captured 01-login");

  // --- log in ---
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // --- desktop shots ---
  for (const shot of SHOTS) {
    try {
      await page.goto(`${BASE_URL}${shot.path}`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(OUT_DIR, `${shot.id}.png`), fullPage: false });
      console.log(`captured ${shot.id}`);
    } catch (e) {
      console.log(`SKIPPED ${shot.id}: ${e.message}`);
    }
  }

  // --- mobile shot ---
  await context.close();
  const mobileContext = await browser.newContext({ viewport: MOBILE });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(`${BASE_URL}/login`, { waitUntil: "load" });
  await mobilePage.fill("#email", EMAIL);
  await mobilePage.fill("#password", PASSWORD);
  await mobilePage.click('button[type="submit"]');
  await mobilePage.waitForURL(/\/dashboard/, { timeout: 15000 }).catch(() => {});
  await mobilePage.waitForTimeout(1500);
  await mobilePage.screenshot({ path: path.join(OUT_DIR, "15-dashboard-mobile.png") });
  console.log("captured 15-dashboard-mobile");
  await mobileContext.close();

  await browser.close();
  console.log("\nAll captures done -> marketing/screenshots/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
