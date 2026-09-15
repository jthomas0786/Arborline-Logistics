import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const base = 'http://127.0.0.1:3000/demo';
const outDir = path.resolve('dist/recordings');
await fs.mkdir(outDir, { recursive: true });

const clips = [
  { scene: 'full', name: '01_ArborLine_End_to_End_Demo_LinkedIn_X', duration: 39200 },
  { scene: 'discover', name: '02_Prospect_Discovery_LinkedIn_X', duration: 8000 },
  { scene: 'contact', name: '03_Decision_Maker_Enrichment_LinkedIn_X', duration: 8000 },
  { scene: 'outreach', name: '04_Personalized_Outreach_LinkedIn_X', duration: 8400 },
  { scene: 'reply', name: '05_Reply_Intelligence_90_Second_Video_LinkedIn_X', duration: 8600 },
  { scene: 'handoff', name: '06_Qualified_Handoff_LinkedIn_X', duration: 8000 }
];

const browser = await chromium.launch({ headless: true });
for (const clip of clips) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    recordVideo: { dir: outDir, size: { width: 1280, height: 720 } }
  });
  const page = await context.newPage();
  await page.goto(`${base}?scene=${clip.scene}&record=1`, { waitUntil: 'networkidle' });
  await page.evaluate(() => { document.documentElement.style.cursor = 'none'; });
  await page.waitForTimeout(clip.duration);
  const video = page.video();
  const rawPath = await video.path();
  await context.close();
  await video.saveAs(path.join(outDir, `${clip.name}.webm`));
  if (rawPath !== path.join(outDir, `${clip.name}.webm`)) {
    try { await fs.unlink(rawPath); } catch {}
  }
}
await browser.close();
