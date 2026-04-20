import { describe, expect, it, vi } from "vitest";
import { TelegramRecoveryNotifier } from "./TelegramRecoveryNotifier";

describe("TelegramRecoveryNotifier", () => {
  it("is a no-op when env credentials are missing", async () => {
    const notifier = new TelegramRecoveryNotifier("", "");
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);

    await notifier.notifyPendingRecoveries(
      [{ missionId: "m1", message: "msg", prompt: "Prompt", state: "coding", currentPhase: "execute", currentGear: "standard", interruptedAt: "2026-03-12T10:00:00.000Z", touchedFiles: [], reviewStatus: "none" }],
      "http://127.0.0.1:51122",
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends a telegram message when credentials are configured", async () => {
    const notifier = new TelegramRecoveryNotifier("bot-token", "chat-id");
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await notifier.notifyPendingRecoveries(
      [{ missionId: "m1", message: "msg", prompt: "Prompt", state: "coding", currentPhase: "execute", currentGear: "standard", interruptedAt: "2026-03-12T10:00:00.000Z", touchedFiles: [], reviewStatus: "none" }],
      "http://127.0.0.1:51122",
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toContain("api.telegram.org");
  });
});
