/**
 * Event handler module extracted from plugin.ts monolith.
 * Handles session recovery, update checking, and child session tracking.
 */
import type { SovereignGatewayConfig } from "./config";
import { createLogger } from "./logger";

const log = createLogger("event-handler");

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface EventHandlerClient {
  session: {
    prompt(opts: any): Promise<any>;
  };
  tui: {
    showToast(opts: any): Promise<any>;
  };
}

export interface SessionRecoveryHook {
  isRecoverableError(error: unknown): boolean;
  handleSessionRecovery(messageInfo: {
    id?: string;
    role: "assistant";
    sessionID?: string;
    error: unknown;
  }): Promise<boolean>;
}

export interface UpdateCheckerHook {
  event(input: { event: { type: string; properties?: unknown } }): void | Promise<void>;
}

export interface ChildSessionState {
  isChildSession: boolean;
  childSessionParentID: string | undefined;
}

export interface EventHandlerDeps {
  client: EventHandlerClient;
  config: SovereignGatewayConfig;
  directory: string;
  sessionRecovery: SessionRecoveryHook | null;
  updateChecker: UpdateCheckerHook;
  getRecoverySuccessToast: () => { title: string; message: string };
  childState: ChildSessionState;
}

/**
 * Creates the event handler function for the Sovereign plugin.
 * Handles session.created, session.error, and update checker forwarding.
 */
export function createEventHandler(deps: EventHandlerDeps) {
  const { client, config, directory, sessionRecovery, updateChecker, getRecoverySuccessToast, childState } = deps;

  return async (input: { event: { type: string; properties?: unknown } }) => {
    // Forward to update checker
    await updateChecker.event(input);

    // Track if this is a child session (subagent, background task)
    // This is used to filter toasts based on toast_scope config
    if (input.event.type === "session.created") {
      const props = input.event.properties as { info?: { parentID?: string } } | undefined;
      if (props?.info?.parentID) {
        childState.isChildSession = true;
        childState.childSessionParentID = props.info.parentID;
        log.debug("child-session-detected", { parentID: props.info.parentID });
      } else {
        // Reset for root sessions - important when plugin instance is reused
        childState.isChildSession = false;
        childState.childSessionParentID = undefined;
        log.debug("root-session-detected", {});
      }
    }

    // Handle session recovery
    if (sessionRecovery && input.event.type === "session.error") {
      const props = input.event.properties as Record<string, unknown> | undefined;
      const sessionID = props?.sessionID as string | undefined;
      const messageID = props?.messageID as string | undefined;
      const error = props?.error;

      if (sessionRecovery.isRecoverableError(error)) {
        const messageInfo = {
          id: messageID,
          role: "assistant" as const,
          sessionID,
          error,
        };

        // handleSessionRecovery now does the actual fix (injects tool_result, etc.)
        const recovered = await sessionRecovery.handleSessionRecovery(messageInfo);

        // Only send "continue" AFTER successful tool_result_missing recovery
        // (thinking recoveries already resume inside handleSessionRecovery)
        if (recovered && sessionID && config.auto_resume) {
          // For tool_result_missing, we need to send continue after injecting tool_results
          await client.session.prompt({
            path: { id: sessionID },
            body: { parts: [{ type: "text", text: config.resume_text }] },
            query: { directory },
          }).catch(() => {});

          // Show success toast (respects toast_scope for child sessions)
          const successToast = getRecoverySuccessToast();
          log.debug("recovery-toast", { ...successToast, isChildSession: childState.isChildSession, toastScope: config.toast_scope });
          if (!(config.toast_scope === "root_only" && childState.isChildSession)) {
            await client.tui.showToast({
              body: {
                title: successToast.title,
                message: successToast.message,
                variant: "success",
              },
            }).catch(() => {});
          }
        }
      }
    }
  };
}
