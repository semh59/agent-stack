import { test, expect } from '@playwright/test';

test.describe('Alloy Unified UI - Comprehensive Feature Test', () => {

  test.beforeEach(async ({ page }) => {
    // 0. Diagnostic logging
    page.on('console', msg => console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', err => console.log(`[BROWSER ERROR] ${err.message}`));

    // 1. Mock the backend API
    await page.route('**/api/**', async route => {
      const url = route.request().url();
      if (url.includes('/api/accounts')) {
        await route.fulfill({ 
          json: {
            data: [{ 
              email: 'test@alloy.ai', 
              isValid: true, 
              status: 'active', 
              provider: 'google',
              expiresAt: Date.now() + 86400000 
            }]
          }
        });
      } else {
        await route.fulfill({ json: { data: { success: true } } });
      }
    });

    // 2. Automate Guest Login
    await page.goto('http://127.0.0.1:5173/#/auth');
    // Wait for the auth page to actually mount
    await page.waitForSelector('input[placeholder*="email"]', { timeout: 10000 });
    await page.fill('input[placeholder*="email"]', 'test@alloy.ai');
    // Use text-based click for robustness
    await page.click('text=Enter as Guest');

    // 3. Wait for the main UI (aside) to confirm successful entry
    await expect(page.locator('aside')).toBeVisible({ timeout: 15000 });
  });

  test('Global UI: Theme, Sidebar, and Language Toggles', async ({ page }) => {
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();

    // 1. Sidebar Toggle
    const toggleButton = page.locator('aria-label=Daralt');
    await toggleButton.click();
    await expect(sidebar).toHaveClass(/w-\[60px\]/);
    await page.locator('aria-label=Genislet').click();
    await expect(sidebar).toHaveClass(/w-\[220px\]/);

    // 2. Theme Toggle
    const html = page.locator('html');
    const initialTheme = await html.getAttribute('data-theme');
    await page.locator('aria-label=Temayi degistir').click();
    const newTheme = await html.getAttribute('data-theme');
    expect(initialTheme).not.toBe(newTheme);

    // 3. Language Toggle
    const langButton = page.locator('button:has-text("EN"), button:has-text("TR")');
    const initialLang = await langButton.innerText();
    await langButton.click();
    const newLang = await langButton.innerText();
    expect(initialLang).not.toBe(newLang);
  });

  test('Navigation: All Sidebar Links', async ({ page }) => {
    const links = [
      { label: 'Projeler', url: '/projects' },
      { label: 'Chat',     url: '/chat' },
      { label: 'Watchdog', url: '/metro' },
      { label: 'Gorevler', url: '/dashboard' },
      { label: 'Gecmis',   url: '/pipeline/history' },
      { label: 'Ayarlar',  url: '/settings' },
    ];

    for (const link of links) {
      await page.click(`aria-label=${link.label}`);
      await expect(page).toHaveURL(new RegExp(link.url.replace(/\//g, '\\/')));
    }
  });

  test('Polymorphic Components: CodeBlock Console Mode', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/#/chat');
    await page.waitForSelector('aside');
    
    // Ensure chat logic is fully initialized
    await page.waitForTimeout(2000); 

    // Inject message
    await page.evaluate(() => {
      window.postMessage({ 
        type: 'assistantText', 
        content: '```javascript\nconsole.log("Unified");\n```' 
      }, '*');
    });

    // Check rendering
    const pre = page.locator('pre');
    await expect(pre).toBeVisible({ timeout: 10000 });

    // Console mode check: Copy exists, Apply does not
    await expect(page.getByRole('button', { name: 'Copy' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply' })).not.toBeVisible();
  });

});
