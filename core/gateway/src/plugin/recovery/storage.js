"use strict";
/**
 * Storage utilities for reading Alloy's session data.
 *
 * Based on oh-my-Alloy/src/hooks/session-recovery/storage.ts
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePartId = generatePartId;
exports.getMessageDir = getMessageDir;
exports.readMessages = readMessages;
exports.readParts = readParts;
exports.hasContent = hasContent;
exports.messageHasContent = messageHasContent;
exports.injectTextPart = injectTextPart;
exports.findMessagesWithThinkingBlocks = findMessagesWithThinkingBlocks;
exports.findMessagesWithThinkingOnly = findMessagesWithThinkingOnly;
exports.findMessagesWithOrphanThinking = findMessagesWithOrphanThinking;
exports.prependThinkingPart = prependThinkingPart;
exports.stripThinkingParts = stripThinkingParts;
exports.findEmptyMessages = findEmptyMessages;
exports.findEmptyMessageByIndex = findEmptyMessageByIndex;
exports.findMessageByIndexNeedingThinking = findMessageByIndexNeedingThinking;
exports.replaceEmptyTextParts = replaceEmptyTextParts;
exports.findMessagesWithEmptyTextParts = findMessagesWithEmptyTextParts;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const constants_1 = require("./constants");
// =============================================================================
// ID Generation
// =============================================================================
function generatePartId() {
    const timestamp = Date.now().toString(16);
    const random = Math.random().toString(36).substring(2, 10);
    return `prt_${timestamp}${random}`;
}
// =============================================================================
// Directory Helpers
// =============================================================================
function getMessageDir(sessionID) {
    if (!(0, node_fs_1.existsSync)(constants_1.MESSAGE_STORAGE))
        return "";
    const directPath = (0, node_path_1.join)(constants_1.MESSAGE_STORAGE, sessionID);
    if ((0, node_fs_1.existsSync)(directPath)) {
        return directPath;
    }
    // Search in subdirectories
    try {
        for (const dir of (0, node_fs_1.readdirSync)(constants_1.MESSAGE_STORAGE)) {
            const sessionPath = (0, node_path_1.join)(constants_1.MESSAGE_STORAGE, dir, sessionID);
            if ((0, node_fs_1.existsSync)(sessionPath)) {
                return sessionPath;
            }
        }
    }
    catch {
        // Ignore read errors
    }
    return "";
}
// =============================================================================
// Message Reading
// =============================================================================
function readMessages(sessionID) {
    const messageDir = getMessageDir(sessionID);
    if (!messageDir || !(0, node_fs_1.existsSync)(messageDir))
        return [];
    const messages = [];
    try {
        for (const file of (0, node_fs_1.readdirSync)(messageDir)) {
            if (!file.endsWith(".json"))
                continue;
            try {
                const content = (0, node_fs_1.readFileSync)((0, node_path_1.join)(messageDir, file), "utf-8");
                messages.push(JSON.parse(content));
            }
            catch {
                continue;
            }
        }
    }
    catch {
        return [];
    }
    return messages.sort((a, b) => {
        const aTime = a.time?.created ?? 0;
        const bTime = b.time?.created ?? 0;
        if (aTime !== bTime)
            return aTime - bTime;
        return a.id.localeCompare(b.id);
    });
}
// =============================================================================
// Part Reading
// =============================================================================
function readParts(messageID) {
    const partDir = (0, node_path_1.join)(constants_1.PART_STORAGE, messageID);
    if (!(0, node_fs_1.existsSync)(partDir))
        return [];
    const parts = [];
    try {
        for (const file of (0, node_fs_1.readdirSync)(partDir)) {
            if (!file.endsWith(".json"))
                continue;
            try {
                const content = (0, node_fs_1.readFileSync)((0, node_path_1.join)(partDir, file), "utf-8");
                parts.push(JSON.parse(content));
            }
            catch {
                continue;
            }
        }
    }
    catch {
        return [];
    }
    return parts;
}
// =============================================================================
// Content Helpers
// =============================================================================
function hasContent(part) {
    if (constants_1.THINKING_TYPES.has(part.type))
        return false;
    if (constants_1.META_TYPES.has(part.type))
        return false;
    if (part.type === "text") {
        const textPart = part;
        return !!(textPart.text?.trim());
    }
    if (part.type === "tool" || part.type === "tool_use") {
        return true;
    }
    if (part.type === "tool_result") {
        return true;
    }
    return false;
}
function messageHasContent(messageID) {
    const parts = readParts(messageID);
    return parts.some(hasContent);
}
// =============================================================================
// Part Injection (for recovery)
// =============================================================================
function injectTextPart(sessionID, messageID, text) {
    const partDir = (0, node_path_1.join)(constants_1.PART_STORAGE, messageID);
    try {
        if (!(0, node_fs_1.existsSync)(partDir)) {
            (0, node_fs_1.mkdirSync)(partDir, { recursive: true });
        }
        const partId = generatePartId();
        const part = {
            id: partId,
            sessionID,
            messageID,
            type: "text",
            text,
            synthetic: true,
        };
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(partDir, `${partId}.json`), JSON.stringify(part, null, 2));
        return true;
    }
    catch {
        return false;
    }
}
// =============================================================================
// Thinking Block Recovery
// =============================================================================
function findMessagesWithThinkingBlocks(sessionID) {
    const messages = readMessages(sessionID);
    const result = [];
    for (const msg of messages) {
        if (msg.role !== "assistant")
            continue;
        const parts = readParts(msg.id);
        const hasThinking = parts.some((p) => constants_1.THINKING_TYPES.has(p.type));
        if (hasThinking) {
            result.push(msg.id);
        }
    }
    return result;
}
function findMessagesWithThinkingOnly(sessionID) {
    const messages = readMessages(sessionID);
    const result = [];
    for (const msg of messages) {
        if (msg.role !== "assistant")
            continue;
        const parts = readParts(msg.id);
        if (parts.length === 0)
            continue;
        const hasThinking = parts.some((p) => constants_1.THINKING_TYPES.has(p.type));
        const hasTextContent = parts.some(hasContent);
        // Has thinking but no text content = orphan thinking
        if (hasThinking && !hasTextContent) {
            result.push(msg.id);
        }
    }
    return result;
}
function findMessagesWithOrphanThinking(sessionID) {
    const messages = readMessages(sessionID);
    const result = [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (!msg || msg.role !== "assistant")
            continue;
        const parts = readParts(msg.id);
        if (parts.length === 0)
            continue;
        const sortedParts = [...parts].sort((a, b) => a.id.localeCompare(b.id));
        const firstPart = sortedParts[0];
        if (!firstPart)
            continue;
        const firstIsThinking = constants_1.THINKING_TYPES.has(firstPart.type);
        // If first part is not thinking, it's orphan
        if (!firstIsThinking) {
            result.push(msg.id);
        }
    }
    return result;
}
function prependThinkingPart(sessionID, messageID) {
    const partDir = (0, node_path_1.join)(constants_1.PART_STORAGE, messageID);
    try {
        if (!(0, node_fs_1.existsSync)(partDir)) {
            (0, node_fs_1.mkdirSync)(partDir, { recursive: true });
        }
        const partId = "prt_0000000000_thinking";
        const part = {
            id: partId,
            sessionID,
            messageID,
            type: "thinking",
            thinking: "",
            synthetic: true,
        };
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(partDir, `${partId}.json`), JSON.stringify(part, null, 2));
        return true;
    }
    catch {
        return false;
    }
}
function stripThinkingParts(messageID) {
    const partDir = (0, node_path_1.join)(constants_1.PART_STORAGE, messageID);
    if (!(0, node_fs_1.existsSync)(partDir))
        return false;
    let anyRemoved = false;
    try {
        for (const file of (0, node_fs_1.readdirSync)(partDir)) {
            if (!file.endsWith(".json"))
                continue;
            try {
                const filePath = (0, node_path_1.join)(partDir, file);
                const content = (0, node_fs_1.readFileSync)(filePath, "utf-8");
                const part = JSON.parse(content);
                if (constants_1.THINKING_TYPES.has(part.type)) {
                    (0, node_fs_1.unlinkSync)(filePath);
                    anyRemoved = true;
                }
            }
            catch {
                continue;
            }
        }
    }
    catch {
        return false;
    }
    return anyRemoved;
}
// =============================================================================
// Empty Message Recovery
// =============================================================================
function findEmptyMessages(sessionID) {
    const messages = readMessages(sessionID);
    const emptyIds = [];
    for (const msg of messages) {
        if (!messageHasContent(msg.id)) {
            emptyIds.push(msg.id);
        }
    }
    return emptyIds;
}
function findEmptyMessageByIndex(sessionID, targetIndex) {
    const messages = readMessages(sessionID);
    // API index may differ from storage index due to system messages
    const indicesToTry = [targetIndex, targetIndex - 1, targetIndex - 2];
    for (const idx of indicesToTry) {
        if (idx < 0 || idx >= messages.length)
            continue;
        const targetMsg = messages[idx];
        if (!targetMsg)
            continue;
        if (!messageHasContent(targetMsg.id)) {
            return targetMsg.id;
        }
    }
    return null;
}
function findMessageByIndexNeedingThinking(sessionID, targetIndex) {
    const messages = readMessages(sessionID);
    if (targetIndex < 0 || targetIndex >= messages.length)
        return null;
    const targetMsg = messages[targetIndex];
    if (!targetMsg || targetMsg.role !== "assistant")
        return null;
    const parts = readParts(targetMsg.id);
    if (parts.length === 0)
        return null;
    const sortedParts = [...parts].sort((a, b) => a.id.localeCompare(b.id));
    const firstPart = sortedParts[0];
    if (!firstPart)
        return null;
    const firstIsThinking = constants_1.THINKING_TYPES.has(firstPart.type);
    if (!firstIsThinking) {
        return targetMsg.id;
    }
    return null;
}
function replaceEmptyTextParts(messageID, replacementText) {
    const partDir = (0, node_path_1.join)(constants_1.PART_STORAGE, messageID);
    if (!(0, node_fs_1.existsSync)(partDir))
        return false;
    let anyReplaced = false;
    try {
        for (const file of (0, node_fs_1.readdirSync)(partDir)) {
            if (!file.endsWith(".json"))
                continue;
            try {
                const filePath = (0, node_path_1.join)(partDir, file);
                const content = (0, node_fs_1.readFileSync)(filePath, "utf-8");
                const part = JSON.parse(content);
                if (part.type === "text") {
                    const textPart = part;
                    if (!textPart.text?.trim()) {
                        textPart.text = replacementText;
                        textPart.synthetic = true;
                        (0, node_fs_1.writeFileSync)(filePath, JSON.stringify(textPart, null, 2));
                        anyReplaced = true;
                    }
                }
            }
            catch {
                continue;
            }
        }
    }
    catch {
        return false;
    }
    return anyReplaced;
}
function findMessagesWithEmptyTextParts(sessionID) {
    const messages = readMessages(sessionID);
    const result = [];
    for (const msg of messages) {
        const parts = readParts(msg.id);
        const hasEmptyTextPart = parts.some((p) => {
            if (p.type !== "text")
                return false;
            const textPart = p;
            return !textPart.text?.trim();
        });
        if (hasEmptyTextPart) {
            result.push(msg.id);
        }
    }
    return result;
}
//# sourceMappingURL=storage.js.map