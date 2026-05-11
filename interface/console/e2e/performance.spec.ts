import { test, expect } from '@playwright/test';

test.describe('Alloy Unified UI - Phase 4: Quality & Performance', () => {

  test('DOM Virtualization: Message List Windowing', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/#/mission');
    
    // Mock the state to have 100 messages
    // Since we are using Zustand, we can attempt to inject state via window
    // Or just simulate 100 incoming logs if the UI is listening
    
    // Check initial DOM node count for messages
    const initialNodes = await page.locator('.message-bubble, [class*="MessageBubble"]').count();
    
    // Simulate 100 messages
    await page.evaluate(() => {
      // Accessing internal store if exposed, or just sending events if using TransportProvider
      // For this test, we'll simulate large volume of logs
      for(let i=0; i<100; i++) {
        window.postMessage({ 
          type: 'log', 
          log: { id: i, source: 'test', text: `Message #${i}`, type: 'info', time: new Date().toISOString() } 
        }, '*');
      }
    });

    await page.waitForTimeout(2000);

    // With virtualization (react-virtuoso), only a fraction should be in DOM
    const finalNodes = await page.locator('.message-bubble, [class*="MessageBubble"]').count();
    
    console.log(`DOM Nodes for 100 messages: ${finalNodes}`);
    
    // Expect significantly less than 100 nodes in DOM
    expect(finalNodes).toBeLessThan(30); 
  });

  test('IPC Latency: Large Token Payload Handling', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173/#/');

    const startTime = Date.now();
    const largePayload = "A".repeat(1024 * 1024); // 1MB string

    await page.evaluate((payload) => {
      window.postMessage({ type: 'assistantText', content: payload }, '*');
    }, largePayload);

    // Check if the UI rendered the large payload without hanging
    await expect(page.getByText('AAAAAAAA')).toBeVisible({ timeout: 5000 });
    
    const duration = Date.now() - startTime;
    console.log(`Large payload render duration: ${duration}ms`);
    expect(duration).toBeLessThan(2000);
  });
});
