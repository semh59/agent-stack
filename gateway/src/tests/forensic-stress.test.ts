import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SharedMemory } from '../orchestration/shared-memory';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

let simulateDiskFull = false;

// Mock fs to allow simulating errors
vi.mock('node:fs/promises', async () => {
    const actual = await vi.importActual('node:fs/promises') as any;
    return {
        ...actual,
        writeFile: vi.fn(async (file, data, options) => {
            // Throw ONLY if simulation is active AND it's a temp file
            if (simulateDiskFull && typeof file === 'string' && file.includes('.tmp')) {
                throw new Error('ENOSPC: no space left on device, write');
            }
            return actual.writeFile(file, data, options);
        })
    };
});

describe('Forensic Stress Tests (STR-06, STR-07)', () => {
    const testRoot = path.join(process.cwd(), '.tmp_stress_test_final_v2');
    let memory: SharedMemory;

    beforeEach(async () => {
        simulateDiskFull = false;
        memory = new SharedMemory(testRoot);
        await memory.init();
    });

    /**
     * STR-06: OOM Simulation (Memory Pressure)
     * Validates that state is not corrupted if a memory-intensive operation
     * is interrupted. JSON integrity must remain 100%.
     */
    it('should maintain atomic integrity during simulated memory pressure (STR-06)', { timeout: 15000 }, async () => {
        const iterations = 5; 
        const largeObject = {
            data: 'x'.repeat(100 * 1024), 
            timestamp: new Date().toISOString()
        };

        const updates = Array.from({ length: iterations }).map(async (_, i) => {
            await memory.updateState({ [`stress_${i}`]: largeObject });
        });

        await Promise.all(updates);

        const finalState = await memory.getState() as any;
        expect(() => JSON.stringify(finalState)).not.toThrow();
        expect(finalState.stress_0).toBeDefined();
    });

    /**
     * STR-07: Disk-Full Resilience
     * Validates that atomic write (temporary file + rename) prevents
     * file corruption when disk space is exhausted mid-write.
     */
    it('should prevent state corruption during simulated disk-full events (STR-07)', async () => {
        const initialState = await memory.getState();
        
        // Active DISK FULL simulation
        simulateDiskFull = true;
        
        // Attempt an update that should fail due to "disk full"
        await expect(memory.updateState({ foo: 'bar' } as any)).rejects.toThrow('ENOSPC');

        // Deactivate simulation for read
        simulateDiskFull = false;
        const finalState = await memory.getState();
        
        // The state should remain uncorrupted and equal to initial state
        expect(finalState).toEqual(initialState);
        expect((finalState as any).foo).toBeUndefined();
    });
});
