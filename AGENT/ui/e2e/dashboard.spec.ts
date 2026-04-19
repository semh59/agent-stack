import { test, expect } from '@playwright/test';

test.describe('LojiNext Dashboard UI Core Tests', () => {

  test('Core Layout & Navigation', async ({ page }) => {
    await page.goto('/#/');

    // Verify Header and basic layout
    await expect(page.locator('span').filter({ hasText: 'LOJINEXT' })).toBeVisible();

    // Verify Navigation links
    const sidebar = page.locator('nav');
    await expect(sidebar.getByRole('link', { name: /Mission Control/i })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: /Accounts/i })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: /Models/i })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: /Settings/i })).toBeVisible();
  });

  test('Dashboard View Metrics', async ({ page }) => {
    await page.goto('/#/dashboard');
    
    // Verify metric cards exist
    await expect(page.getByText('Running', { exact: true })).toBeVisible();
    await expect(page.getByText('Queued', { exact: true })).toBeVisible();
    await expect(page.getByText('Done / Failed', { exact: true })).toBeVisible();
    await expect(page.getByText('Workspace Stats', { exact: true })).toBeVisible();
  });

  test('Account Management View', async ({ page }) => {
    await page.goto('/#/accounts');
    await page.waitForTimeout(2000); // 2 seconds to render
    await page.screenshot({ path: 'accounts-debug.png', fullPage: true });

    // Verify Header
    await expect(page.locator('h2').filter({ hasText: /HESAP/i })).toBeVisible();
    
    // Verify 'Hesap Ekle' button is present and is NOT a mockup (should not contain "Test")
    const addBtn = page.getByRole('button', { name: 'Hesap Ekle', exact: true });
    await expect(addBtn).toBeVisible();
    await expect(addBtn).not.toContainText('(Test)'); 

    // Verify Rotation Strategy configuration options exist
    await expect(page.getByText(/Rotasyon Stratejisi/i)).toBeVisible();
    await expect(page.getByText(/Round Robin/i)).toBeVisible();
    await expect(page.getByText(/Quota Eşiği/i)).toBeVisible();
    
    // Verify refresh button exists (using .first() because there might be multiple)
    const refreshBtn = page.getByRole('button', { name: 'Yenile', exact: true }).first();
    await expect(refreshBtn).toBeVisible();
  });

  test('Models View', async ({ page }) => {
    await page.goto('/#/models');

    // Verify Models View header exists
    await expect(page.locator('h1')).toContainText('Models', { ignoreCase: true });
  });

  test('Mission Control / Pipelines View', async ({ page }) => {
    await page.goto('/#/mission');

    // Verify Header
    await expect(page.locator('h1')).toContainText('Mission Control', { ignoreCase: true });
  });

  test('Settings View', async ({ page }) => {
    await page.goto('/#/settings');

    // Verify Settings Panels
    await expect(page.locator('h1')).toContainText('Settings', { ignoreCase: true });
  });

});
