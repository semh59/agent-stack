import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const outDir = path.join(process.cwd(), 'screenshots-debug');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  const urls = [
    { name: 'Dashboard', path: '/#/' },
    { name: 'Accounts', path: '/#/accounts' },
    { name: 'Models', path: '/#/models' },
    { name: 'Mission', path: '/#/mission' },
    { name: 'Settings', path: '/#/settings' },
    { name: 'Skills', path: '/#/skills' }
  ];

  for (const url of urls) {
    console.log(`Navigating to ${url.name}...`);
    await page.goto(`http://127.0.0.1:51122${url.path}`);
    await page.waitForTimeout(2000); // give time to fetch data
    const p = path.join(outDir, `${url.name}.png`);
    await page.screenshot({ path: p, fullPage: true });
    console.log(`Captured ${url.name}`);
  }

  await browser.close();
  console.log('Done capturing.');
})();
