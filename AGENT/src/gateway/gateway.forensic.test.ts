import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GatewayServer } from './server';
import { MissionDatabase } from '../persistence/database';
import { SQLiteMissionRepository } from '../persistence/SQLiteMissionRepository';
import WebSocket from 'ws';
import path from 'node:path';
import fs from 'node:fs/promises';

describe('Gateway Forensic Integration Tests', () => {
    const projectRoot = path.resolve('d:/PROJECT/agent-stack/AGENT/test-workspace-forensic');
    const testDbPath = path.resolve('d:/PROJECT/agent-stack/AGENT/test-missions-forensic.db');
    let server: GatewayServer;
    const port = 51122;
    const authToken = "forensic-test-token";
    const testEmail = "tester@test.com";

    beforeEach(async () => {
        // Clean start
        await fs.mkdir(projectRoot, { recursive: true });
        const tokenStorePath = path.join(projectRoot, 'token-store.json');
        
        // Setup dummy token store
        await fs.writeFile(tokenStorePath, JSON.stringify({
            version: 1,
            accounts: [
                {
                    email: testEmail,
                    accessToken: "dummy-access-token",
                    refreshToken: "dummy-refresh-token",
                    expiresAt: Date.now() + 999999999,
                    createdAt: Date.now()
                }
            ],
            activeIndex: 0
        }));

        if (await fs.stat(testDbPath).catch(() => null)) {
            await fs.unlink(testDbPath).catch(() => null);
            await fs.unlink(`${testDbPath}-wal`).catch(() => null);
            await fs.unlink(`${testDbPath}-shm`).catch(() => null);
        }

        server = new GatewayServer({
            port,
            authToken,
            projectRoot,
            missionDatabasePath: testDbPath,
            tokenStorePath,
        });
        await server.start();
    });

    afterEach(async () => {
        if (server) {
            await server.stop();
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    });

    it('FS-01: Rate Limiting Sliding Window (Identity Isolation)', async () => {
        const fetchWithIdentity = (id: string) => fetch(`http://localhost:${port}/api/health`, {
            headers: { 'Authorization': `Bearer ${authToken}_${id}` }
        });

        const id1Results = await Promise.all(Array.from({ length: 10 }, (_, i) => fetchWithIdentity('user1')));
        const id2Results = await Promise.all(Array.from({ length: 10 }, (_, i) => fetchWithIdentity('user2')));

        expect(id1Results.every(r => r.status === 200)).toBe(true);
        expect(id2Results.every(r => r.status === 200)).toBe(true);
        
        const manyResults = await Promise.all(Array.from({ length: 105 }, () => fetch(`http://localhost:${port}/api/health`, {
             headers: { 'Authorization': `Bearer ${authToken}` }
        })));
        
        const statuses = manyResults.map(r => r.status);
        const limitReached = statuses.includes(429);
        expect(limitReached).toBe(true);
    }, 15000);

    it('FS-03: Massive Snapshot Pruning (Memory Safety)', async () => {
        const missionId = `persisted-giant-mission-${Date.now()}`;
        
        // Use a separate DB connection to insert directly (not through server API to avoid runtime session cache)
        const dbInstance = new MissionDatabase({ dbPath: testDbPath });
        const repo = new SQLiteMissionRepository(dbInstance);
        await repo.create({
            id: missionId,
            prompt: "Massive State Test",
            account: testEmail, // Must match token store to pass ticket auth
            state: "received",
            currentPhase: "received",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            artifacts: [
                { 
                    id: "art-01", 
                    kind: "raw_response", 
                    value: "X".repeat(1024 * 512), // 512KB artifact -> definitely > 256KB cap
                    createdAt: new Date().toISOString() 
                }
            ] as any,
            budget: {
                limits: { maxCycles: 10, maxDurationMs: 60000, maxInputTokens: 0, maxOutputTokens: 0, maxTPM: 0, maxRPD: 0, maxUsd: 0 },
                usage: { cyclesUsed: 0, requestsUsed: 0, inputTokensUsed: 0, outputTokensUsed: 0, currentTPM: 0, currentRPD: 0 }
            } as any,
            gateResults: [],
            timeline: [],
            scopePaths: ["src"],
            touchedFiles: [],
            strictMode: true,
            anchorModel: "pro-model",
            reviewStatus: "pending",
        } as any);
        dbInstance.connection.close(); 

        // 2. Mock a WS ticket (this should work because mission exists in DB and account matches)
        const ticketResult = server.getAuthManager().issueWsTicket(missionId, { clientId: "client-02" });
        const ticket = ticketResult.ticket;
        
        // 3. Connect and verify snapshot size
        const ws = new WebSocket(`ws://localhost:${port}/ws/mission/${missionId}?ticket=${ticket}`);
        let snapshotPayload: any = null;
        let receivedError: any = null;

        await new Promise((resolve, reject) => {
            ws.on('message', (data) => {
                const msg = JSON.parse(data.toString());
                if (msg.type === "autonomyEvent" && msg.eventType === "snapshot") {
                    snapshotPayload = msg.payload;
                    resolve(null);
                } else if (msg.type === "error" || msg.type === "snapshot_error") {
                    receivedError = msg;
                    resolve(null);
                }
            });
            ws.on('error', (err) => reject(err));
            setTimeout(() => reject(new Error('Snapshot timeout')), 10000);
        });

        if (receivedError) {
            expect(receivedError.type).toBe("snapshot_error");
        } else {
            expect(snapshotPayload.snapshotMeta).toBeDefined();
            expect(snapshotPayload.snapshotMeta.truncated).toBe(true);
            expect(snapshotPayload.snapshotMeta.droppedFields).toContain("artifacts.rawResponses");
        }
        ws.close();
    }, 15000);

    it('FS-04: Fail-Safe SQLite Integrity (Corruption Recovery)', async () => {
        await server.stop();
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const handle = await fs.open(testDbPath, 'r+');
        await handle.write(Buffer.from("NOT_A_SQLITE_FILE_ANYMORE_SO_LONG_AND_THANKS_FOR_ALL_THE_FISH"), 0, 60, 0);
        await handle.close();

        server = new GatewayServer({
            port,
            authToken,
            projectRoot,
            missionDatabasePath: testDbPath,
        });
        await server.start();
        
        const files = await fs.readdir(path.dirname(testDbPath));
        const corruptFound = files.some(f => f.includes('.corrupt'));
        expect(corruptFound).toBe(true);
        
        const health = await fetch(`http://localhost:${port}/api/health`);
        expect(health.status).toBe(200);
    }, 20000);
});
