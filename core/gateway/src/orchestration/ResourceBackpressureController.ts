import * as os from 'node:os';

/**
 * ResourceBackpressureController: Implements dynamic QoS for the agent loop.
 * Throttles execution intensity based on host system telemetry.
 */
export class ResourceBackpressureController {
  private currentInterval: number = 100; // ms

  constructor(private readonly cpuThreshold: number = 0.8) {}

  /**
   * waitIfOverloaded: Blocks execution if system load exceeds threshold.
   * Implements an Exponential Backoff if pressure persists.
   */
  public async waitIfOverloaded(): Promise<void> {
    const load = await this.getCurrentLoad();
    const memRatio = 1 - (os.freemem() / os.totalmem());

    if (load > this.cpuThreshold || memRatio > 0.9) {
      console.warn(`[QoS] High Load Detected (${(load * 100).toFixed(1)}%). Throttling agent loop...`);
      await new Promise(resolve => setTimeout(resolve, this.currentInterval));
      
      // Gradually increase backoff up to 5 seconds
      this.currentInterval = Math.min(5000, this.currentInterval * 1.5);
    } else {
      // Cooldown: gradually reset interval
      this.currentInterval = Math.max(100, this.currentInterval * 0.5);
    }
  }

  /**
   * getCurrentLoad: Calculates current system load (Unix LoadAvg or Windows Delta Sample).
   */
  private async getCurrentLoad(): Promise<number> {
    const loads = os.loadavg();
    const unixLoad = (loads[0] || 0) / (os.cpus().length || 1);
    
    // Windows Fallback: Calculate load via CPU times delta if unixLoad is 0
    if (unixLoad === 0 || os.platform() === 'win32') {
       const initial = os.cpus();
       await new Promise(resolve => setTimeout(resolve, 100)); // Sample over 100ms
       const final = os.cpus();
       
       let totalIdle = 0, totalTick = 0;
       for (let i = 0; i < initial.length; i++) {
         const start = initial[i]!.times;
         const end = final[i]!.times;
         totalIdle += end.idle - start.idle;
         totalTick += (end.user - start.user) + (end.nice - start.nice) + (end.sys - start.sys) + (end.irq - start.irq) + (end.idle - start.idle);
       }
       return totalTick === 0 ? 0 : (totalTick - totalIdle) / totalTick;
    }

    return unixLoad;
  }

  /**
   * getAdaptivePollInterval: Recommended interval for FsWatcher.
   */
  public getAdaptivePollInterval(): number {
    // Basic heuristic based on current throttle interval
    return this.currentInterval > 500 ? 1000 : 100;
  }
}
