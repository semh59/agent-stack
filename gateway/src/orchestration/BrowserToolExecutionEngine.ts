import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';

export interface BrowserAction {
  type: 'navigate' | 'click' | 'type' | 'press' | 'screenshot';
  url?: string;
  selector?: string;
  text?: string;
  key?: string;
  path?: string;
}

/**
 * BrowserToolExecutionEngine: The "Retina" engine for autonomous browser orchestration.
 * Hardened for security and high-fidelity DOM verification.
 */
export class BrowserToolExecutionEngine {
  private browser: Browser | null = null;
  private page: Page | null = null;

  constructor() {}

  public async init(headless: boolean = true): Promise<void> {
    this.browser = await chromium.launch({ headless });
    this.page = await this.browser.newPage();
  }

  public async execute(action: BrowserAction): Promise<unknown> {
    if (!this.page) throw new Error('Browser not initialized');

    switch (action.type) {
      case 'navigate':
        if (!action.url) throw new Error('URL required');
        await this.page.goto(action.url, { waitUntil: 'networkidle' });
        break;
      case 'click': {
        if (!action.selector) throw new Error('Selector required');
        // Z-Index Occlusion Analysis
        const isClickable = await this.page.evaluate((sel) => {
          const el = document.querySelector(sel) as HTMLElement;
          if (!el) return false;
          
          // Hardening: Ensure element is in viewport before analysis
          el.scrollIntoView({ block: 'center' });
          
          const rect = el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const topEl = document.elementFromPoint(cx, cy);
          return el === topEl || el.contains(topEl);
        }, action.selector);

        if (!isClickable) {
          throw new Error(`[BrowserEngine] Element ${action.selector} is occluded or not in viewport.`);
        }
        await this.page.click(action.selector);
        break;
      }
      case 'type':
        if (!action.selector || !action.text) throw new Error('Selector and text required');
        await this.page.fill(action.selector, action.text);
        break;
      case 'screenshot':
        if (!action.path) throw new Error('Screenshot path required');
        await this.page.screenshot({ path: action.path });
        break;
      default:
        throw new Error(`Unknown action: ${action.type}`);
    }
    return { success: true };
  }

  public async getPage(): Promise<Page> {
    if (!this.page) throw new Error('No page active');
    return this.page;
  }

  public async close(): Promise<void> {
    await this.browser?.close();
  }
}
