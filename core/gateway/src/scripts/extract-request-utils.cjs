const fs = require('fs');
const path = require('path');

const requestFile = path.join(__dirname, '../plugin/request.ts');
const targetFile = path.join(__dirname, '../plugin/transform/request-thinking-utils.ts');

const lines = fs.readFileSync(requestFile, 'utf8').split('\n');

const startLine = 77 - 1; // 0-indexed
const endLine = 600 - 1; // 0-indexed: up to isGenerativeLanguageRequest

let extracted = lines.slice(startLine, endLine + 1);

// Replace "function " with "export function " to make them accessible
// and "const " with "export const " for top-level consts
extracted = extracted.map(line => {
  if (line.startsWith('function ')) return line.replace('function ', 'export function ');
  if (line.startsWith('const ') && !line.includes(' = require') && !line.startsWith('  ')) {
      return line.replace('const ', 'export const ');
  }
  return line;
});

const imports = `import crypto from "node:crypto";
import { SKIP_THOUGHT_SIGNATURE } from "../../constants";
import { getCachedSignature } from "../cache";
import { defaultSignatureStore } from "../stores/signature-store";
import { DEBUG_MESSAGE_PREFIX } from "../debug";
import { createLogger } from "../logger";

const log = createLogger("request-thinking-utils");
`;

fs.writeFileSync(targetFile, imports + '\n' + extracted.join('\n'));

// Now replace in request.ts
// Export all from the new file
const replacement = `export * from "./transform/request-thinking-utils";
import {
  buildSignatureSessionKey,
  shouldCacheThinkingSignatures,
  extractTextFromContent,
  resolveProjectKey,
  resolveConversationKey,
  resolveConversationKeyFromRequests,
  formatDebugLinesForThinking,
  injectDebugThinking,
  stripInjectedDebugFromRequestPayload,
  ensureThinkingBeforeToolUseInContents,
  ensureThinkingBeforeToolUseInMessages,
  hasToolUseInContents,
  hasSignedThinkingInContents,
  hasToolUseInMessages,
  hasSignedThinkingInMessages,
  getPluginSessionId,
  generateSyntheticProjectId,
  SYNTHETIC_THINKING_PLACEHOLDER,
  isGenerativeLanguageRequest,
  STREAM_ACTION
} from "./transform/request-thinking-utils";`;

const newLines = [
  ...lines.slice(0, startLine),
  replacement,
  ...lines.slice(endLine + 1)
];

fs.writeFileSync(requestFile, newLines.join('\n'));
console.log('Successfully extracted thinking utils');
