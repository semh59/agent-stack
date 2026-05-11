"use strict";
/**
 * Session recovery hook for handling recoverable errors.
 *
 * Supports:
 * - tool_result_missing: When ESC is pressed during tool execution
 * - thinking_block_order: When thinking blocks are corrupted/stripped
 * - thinking_disabled_violation: Thinking in non-thinking model
 *
 * Based on oh-my-Alloy/src/hooks/session-recovery/index.ts
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectErrorType = detectErrorType;
exports.isRecoverableError = isRecoverableError;
exports.getRecoveryToastContent = getRecoveryToastContent;
exports.getRecoverySuccessToast = getRecoverySuccessToast;
exports.getRecoveryFailureToast = getRecoveryFailureToast;
exports.createSessionRecoveryHook = createSessionRecoveryHook;
const constants_1 = require("../constants");
const logger_1 = require("./logger");
const debug_1 = require("./debug");
const storage_1 = require("./recovery/storage");
// =============================================================================
// Constants
const log = (0, logger_1.createLogger)("recovery");
/**
 * Maximum number of recovery attempts per session to avoid infinite loops.
 */
const MAX_RECOVERY_ATTEMPTS = 3;
/**
 * Maps session IDs to recovery attempt counts.
 */
const recoveryAttempts = new Map();
// =============================================================================
// Error Detection
// =============================================================================
/**
 * Extract a normalized error message string from an unknown error.
 */
function getErrorMessage(error) {
    if (!error)
        return "";
    if (typeof error === "string")
        return error.toLowerCase();
    const errorObj = error;
    const paths = [
        errorObj.data,
        errorObj.error,
        errorObj,
        errorObj.data?.error,
    ];
    for (const obj of paths) {
        if (obj && typeof obj === "object") {
            const msg = obj.message;
            if (typeof msg === "string" && msg.length > 0) {
                return msg.toLowerCase();
            }
        }
    }
    try {
        return JSON.stringify(error).toLowerCase();
    }
    catch {
        return "";
    }
}
/**
 * Extract the message index from an error message (e.g., "messages.79").
 */
function extractMessageIndex(error) {
    const message = getErrorMessage(error);
    const match = message.match(/messages\.(\d+)/);
    if (!match || !match[1])
        return null;
    return parseInt(match[1], 10);
}
/**
 * Detect the type of recoverable error from an error object.
 */
function detectErrorType(error) {
    const message = getErrorMessage(error);
    // tool_result_missing: Happens when ESC is pressed during tool execution
    if (message.includes("tool_use") && message.includes("tool_result")) {
        return "tool_result_missing";
    }
    // thinking_block_order: Happens when thinking blocks are corrupted
    if (message.includes("thinking") &&
        (message.includes("first block") ||
            message.includes("must start with") ||
            message.includes("preceeding") ||
            (message.includes("expected") && message.includes("found")))) {
        return "thinking_block_order";
    }
    // thinking_disabled_violation: Thinking in non-thinking model
    if (message.includes("thinking is disabled") && message.includes("cannot contain")) {
        return "thinking_disabled_violation";
    }
    return null;
}
/**
 * Check if an error is recoverable.
 */
function isRecoverableError(error) {
    return detectErrorType(error) !== null;
}
function extractToolUseIds(parts) {
    return parts
        .filter((p) => p.type === "tool_use" && !!p.id)
        .map((p) => p.id);
}
// =============================================================================
// Recovery Functions
// =============================================================================
/**
 * Recover from tool_result_missing error by injecting synthetic tool_result blocks.
 */
async function recoverToolResultMissing(client, sessionID, failedMsg) {
    // Try API parts first, fallback to filesystem if empty
    let parts = failedMsg.parts || [];
    if (parts.length === 0 && failedMsg.info?.id) {
        const storedParts = (0, storage_1.readParts)(failedMsg.info.id);
        parts = storedParts.map((p) => ({
            type: p.type === "tool" ? "tool_use" : p.type,
            id: "callID" in p ? p.callID : p.id,
            name: "tool" in p ? p.tool : undefined,
            input: "state" in p ? p.state?.input : undefined,
        }));
    }
    const toolUseIds = extractToolUseIds(parts);
    if (toolUseIds.length === 0) {
        return false;
    }
    const toolResultParts = toolUseIds.map((id) => ({
        type: "tool_result",
        tool_use_id: id,
        content: "Operation cancelled by user (ESC pressed)",
    }));
    try {
        await client.session.prompt({
            path: { id: sessionID },
            // @ts-expect-error - SDK types may not include tool_result parts
            body: { parts: toolResultParts },
        });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Recover from thinking_block_order error by prepending thinking parts.
 */
async function recoverThinkingBlockOrder(sessionID, _failedMsg, error) {
    // Try to find the target message index from error
    const targetIndex = extractMessageIndex(error);
    if (targetIndex !== null) {
        const targetMessageID = (0, storage_1.findMessageByIndexNeedingThinking)(sessionID, targetIndex);
        if (targetMessageID) {
            return (0, storage_1.prependThinkingPart)(sessionID, targetMessageID);
        }
    }
    // Fallback: find all orphan thinking messages
    const orphanMessages = (0, storage_1.findMessagesWithOrphanThinking)(sessionID);
    if (orphanMessages.length === 0) {
        return false;
    }
    let anySuccess = false;
    for (const messageID of orphanMessages) {
        if ((0, storage_1.prependThinkingPart)(sessionID, messageID)) {
            anySuccess = true;
        }
    }
    return anySuccess;
}
/**
 * Recover from thinking_disabled_violation by stripping thinking parts.
 */
async function recoverThinkingDisabledViolation(sessionID, _failedMsg) {
    const messagesWithThinking = (0, storage_1.findMessagesWithThinkingBlocks)(sessionID);
    if (messagesWithThinking.length === 0) {
        return false;
    }
    let anySuccess = false;
    for (const messageID of messagesWithThinking) {
        if ((0, storage_1.stripThinkingParts)(messageID)) {
            anySuccess = true;
        }
    }
    return anySuccess;
}
// =============================================================================
// Resume Session Helper
// =============================================================================
function findLastUserMessage(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.info?.role === "user") {
            return messages[i];
        }
    }
    return undefined;
}
function extractResumeConfig(userMessage, sessionID) {
    return {
        sessionID,
        agent: userMessage?.info?.agent,
        model: userMessage?.info?.model,
    };
}
async function resumeSession(client, config, directory) {
    try {
        await client.session.prompt({
            path: { id: config.sessionID },
            body: {
                parts: [{ type: "text", text: constants_1.RECOVERY_RESUME_TEXT }],
                agent: config.agent,
                model: config.model,
            },
            query: { directory },
        });
        return true;
    }
    catch {
        return false;
    }
}
// =============================================================================
// Toast Messages
// =============================================================================
const TOAST_TITLES = {
    tool_result_missing: "Tool Crash Recovery",
    thinking_block_order: "Thinking Block Recovery",
    thinking_disabled_violation: "Thinking Strip Recovery",
};
const TOAST_MESSAGES = {
    tool_result_missing: "Injecting cancelled tool results...",
    thinking_block_order: "Fixing message structure...",
    thinking_disabled_violation: "Stripping thinking blocks...",
};
function getRecoveryToastContent(errorType) {
    if (!errorType) {
        return {
            title: "Session Recovery",
            message: "Attempting to recover session...",
        };
    }
    return {
        title: TOAST_TITLES[errorType] || "Session Recovery",
        message: TOAST_MESSAGES[errorType] || "Attempting to recover session...",
    };
}
function getRecoverySuccessToast() {
    return {
        title: "Session Recovered",
        message: "Continuing where you left off...",
    };
}
function getRecoveryFailureToast() {
    return {
        title: "Recovery Failed",
        message: "Please retry or start a new session.",
    };
}
/**
 * Create a session recovery hook with the given configuration.
 */
function createSessionRecoveryHook(ctx, config) {
    // If session recovery is disabled, return null
    if (!config.session_recovery) {
        return null;
    }
    const { client, directory } = ctx;
    const processingErrors = new Set();
    let onAbortCallback = null;
    let onRecoveryCompleteCallback = null;
    const setOnAbortCallback = (callback) => {
        onAbortCallback = callback;
    };
    const setOnRecoveryCompleteCallback = (callback) => {
        onRecoveryCompleteCallback = callback;
    };
    const handleSessionRecovery = async (info) => {
        // Validate input
        if (!info || info.role !== "assistant" || !info.error)
            return false;
        const errorType = detectErrorType(info.error);
        if (!errorType)
            return false;
        const sessionID = info.sessionID;
        if (!sessionID)
            return false;
        // Recursive recovery hardening (Phase 2D)
        const attempts = recoveryAttempts.get(sessionID) || 0;
        if (attempts >= MAX_RECOVERY_ATTEMPTS) {
            log.warn("Maximum recovery attempts reached for session", { sessionID, attempts });
            recoveryAttempts.delete(sessionID);
            return false;
        }
        recoveryAttempts.set(sessionID, attempts + 1);
        log.debug("Recovery attempt started", {
            errorType,
            sessionID,
            providedMsgID: info.id ?? "none",
        });
        // Notify abort callback early
        if (onAbortCallback) {
            onAbortCallback(sessionID);
        }
        // Abort current request
        await client.session.abort({ path: { id: sessionID } }).catch(() => { });
        let assistantMsgID = info.id;
        let success = false;
        try {
            // Fetch messages - needed to find the failed message
            const messagesResp = await client.session.messages({
                path: { id: sessionID },
                query: { directory },
            });
            const msgs = messagesResp.data;
            // If messageID wasn't provided, find the latest assistant message with an error
            if (!assistantMsgID && msgs && msgs.length > 0) {
                for (let i = msgs.length - 1; i >= 0; i--) {
                    const m = msgs[i];
                    if (m && m.info?.role === "assistant" && m.info?.id) {
                        assistantMsgID = m.info.id;
                        log.debug("Found assistant message ID from session messages", {
                            msgID: assistantMsgID,
                            msgIndex: i,
                        });
                        break;
                    }
                }
            }
            if (!assistantMsgID) {
                log.debug("No assistant message ID found, cannot recover");
                return false;
            }
            if (processingErrors.has(assistantMsgID))
                return false;
            processingErrors.add(assistantMsgID);
            const failedMsg = msgs?.find((m) => m.info?.id === assistantMsgID);
            if (!failedMsg) {
                return false;
            }
            // Show toast notification
            const toastContent = getRecoveryToastContent(errorType);
            (0, debug_1.logToast)(`${toastContent.title}: ${toastContent.message}`, "warning");
            await client.tui
                .showToast({
                body: {
                    title: toastContent.title,
                    message: toastContent.message,
                    variant: "warning",
                },
            })
                .catch(() => { });
            // Perform recovery based on error type
            if (errorType === "tool_result_missing") {
                success = await recoverToolResultMissing(client, sessionID, failedMsg);
            }
            else if (errorType === "thinking_block_order") {
                success = await recoverThinkingBlockOrder(sessionID, failedMsg, info.error);
                if (success && config.auto_resume) {
                    const lastUser = findLastUserMessage(msgs ?? []);
                    const resumeConfig = extractResumeConfig(lastUser, sessionID);
                    await resumeSession(client, resumeConfig, directory);
                }
            }
            else if (errorType === "thinking_disabled_violation") {
                success = await recoverThinkingDisabledViolation(sessionID, failedMsg);
                if (success && config.auto_resume) {
                    const lastUser = findLastUserMessage(msgs ?? []);
                    const resumeConfig = extractResumeConfig(lastUser, sessionID);
                    await resumeSession(client, resumeConfig, directory);
                }
            }
            return success;
        }
        catch (err) {
            log.error("Recovery failed", { error: String(err) });
            return false;
        }
        finally {
            if (assistantMsgID) {
                processingErrors.delete(assistantMsgID);
            }
            // Always notify recovery complete
            if (sessionID && onRecoveryCompleteCallback) {
                onRecoveryCompleteCallback(sessionID);
            }
        }
    };
    return {
        handleSessionRecovery,
        isRecoverableError,
        setOnAbortCallback,
        setOnRecoveryCompleteCallback,
    };
}
//# sourceMappingURL=recovery.js.map