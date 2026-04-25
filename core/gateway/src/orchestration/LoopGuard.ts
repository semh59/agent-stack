/**
 * LoopGuard: Bulletproof protection for while loops.
 * Prevents hanging processes, infinite polling, and resource exhaustion.
 *
 * Prefer `while (guard.tick())` over `while (true) { guard.check() }` so the
 * termination bound is visible at the loop header and ESLint's
 * `no-constant-condition` rule doesn't flag the site.
 */
export class LoopGuard {
  private iterations = 0;
  private readonly startTime: number;

  constructor(
    private readonly name: string,
    private readonly maxIterations: number = 1000,
    private readonly timeBudgetMs: number = 30000,
  ) {
    this.startTime = Date.now();
  }

  /**
   * Performs a safety check. Throws if iterations or time budget exceeded.
   *
   * Kept for call sites that want a hard failure. For new code prefer
   * `tick()` which returns false on exhaustion instead of throwing.
   */
  public check(extraContext?: Record<string, unknown>): void {
    this.iterations++;

    const elapsed = Date.now() - this.startTime;

    if (this.iterations > this.maxIterations) {
      const msg = `[LoopGuard] ${this.name} exceeded max iterations (${this.maxIterations})`;
      console.error(msg, extraContext);
      throw new Error(msg);
    }

    if (elapsed > this.timeBudgetMs) {
      const msg = `[LoopGuard] ${this.name} exceeded time budget (${this.timeBudgetMs}ms)`;
      console.error(msg, extraContext);
      throw new Error(msg);
    }
  }

  /**
   * Non-throwing loop condition. Returns true while the guard still has
   * budget, false once iterations or time are exhausted. Use as
   * `while (guard.tick()) { ... }`.
   */
  public tick(): boolean {
    this.iterations++;
    const elapsed = Date.now() - this.startTime;
    if (this.iterations > this.maxIterations) {
      console.error(`[LoopGuard] ${this.name} exceeded max iterations (${this.maxIterations})`);
      return false;
    }
    if (elapsed > this.timeBudgetMs) {
      console.error(`[LoopGuard] ${this.name} exceeded time budget (${this.timeBudgetMs}ms)`);
      return false;
    }
    return true;
  }

  public getIterationCount(): number {
    return this.iterations;
  }

  public getElapsedMs(): number {
    return Date.now() - this.startTime;
  }
}
