import { createLogger } from "../logger";
import { fixToolResponseGrouping } from "../request-helpers";
import type { MessageContent, MessagePart, AlloyTool } from "../types";

const log = createLogger("tool-hardening");

export function detectToolIdMismatches(contents: MessageContent[]): {
  hasMismatches: boolean;
  expectedIds: string[];
  foundIds: string[];
  missingIds: string[];
  orphanIds: string[];
} {
  const expectedIds: string[] = [];
  const foundIds: string[] = [];
  
  for (const content of contents) {
    const parts = content.parts || [];
    
    for (const part of parts) {
      if (part.functionCall?.id) {
        expectedIds.push(part.functionCall.id);
      }
      if (part.functionResponse?.id) {
        foundIds.push(part.functionResponse.id);
      }
    }
  }
  
  const expectedSet = new Set(expectedIds);
  const foundSet = new Set(foundIds);
  
  const missingIds = expectedIds.filter(id => !foundSet.has(id));
  const orphanIds = foundIds.filter(id => !expectedSet.has(id));
  
  return {
    hasMismatches: missingIds.length > 0 || orphanIds.length > 0,
    expectedIds,
    foundIds,
    missingIds,
    orphanIds,
  };
}

// ============================================================================
// CLAUDE FORMAT TOOL PAIRING (Defense in Depth)
// ============================================================================

/**
 * Find orphaned tool_use IDs (tool_use without matching tool_result).
 * Works on Claude format messages.
 */
export function findOrphanedToolUseIds(messages: MessageContent[]): Set<string> {
  const toolUseIds = new Set<string>();
  const toolResultIds = new Set<string>();

  for (const msg of messages) {
    const content = (msg.content || msg.parts) as Record<string, unknown>[] | undefined;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_use" && typeof block.id === "string") {
          toolUseIds.add(block.id);
        }
        if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
          toolResultIds.add(block.tool_use_id);
        }
      }
    }
  }

  return new Set([...toolUseIds].filter((id) => !toolResultIds.has(id)));
}

/**
 * Fix orphaned tool_use blocks in Claude format messages.
 * Mirrors fixToolResponseGrouping() but for Claude's messages[] format.
 *
 * Claude format:
 * - assistant message with content[]: { type: 'tool_use', id, name, input }
 * - user message with content[]: { type: 'tool_result', tool_use_id, content }
 *
 * @param messages - Claude format messages array
 * @returns Fixed messages with placeholder tool_results for orphans
 */
export function fixClaudeToolPairing(messages: MessageContent[]): MessageContent[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  // 1. Collect all tool_use IDs from assistant messages
  const toolUseMap = new Map<string, { name: string; msgIndex: number }>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    const role = msg.role;
    const content = (msg.content || msg.parts) as Record<string, unknown>[] | undefined;
    if (role === "assistant" && Array.isArray(content)) {
      for (const block of content) {
        if (block && block.type === "tool_use" && typeof block.id === "string") {
          toolUseMap.set(block.id, { name: (block.name as string) || `tool-${toolUseMap.size}`, msgIndex: i });
        }
      }
    }
  }

  // 2. Collect all tool_result IDs from user messages
  const toolResultIds = new Set<string>();

  for (const msg of messages) {
    const content = (msg.content || msg.parts) as Record<string, unknown>[] | undefined;
    if (msg.role === "user" && Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
          toolResultIds.add(block.tool_use_id);
        }
      }
    }
  }

  // 3. Find orphaned tool_use (no matching tool_result)
  const orphans: Array<{ id: string; name: string; msgIndex: number }> = [];

  for (const [id, info] of toolUseMap) {
    if (!toolResultIds.has(id)) {
      orphans.push({ id, ...info });
    }
  }

  if (orphans.length === 0) {
    return messages;
  }

  // 4. Group orphans by message index (insert after each assistant message)
  const orphansByMsgIndex = new Map<number, typeof orphans>();
  for (const orphan of orphans) {
    const existing = orphansByMsgIndex.get(orphan.msgIndex) || [];
    existing.push(orphan);
    orphansByMsgIndex.set(orphan.msgIndex, existing);
  }

  // 5. Build new messages array with injected tool_results
  const result: MessageContent[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    result.push(msg);

    const orphansForMsg = orphansByMsgIndex.get(i);
    if (orphansForMsg && orphansForMsg.length > 0) {
      // Check if next message is user with tool_result - if so, merge into it
      const nextMsg = messages[i + 1] as MessageContent | undefined;
      const nextContent = (nextMsg?.content || nextMsg?.parts) as Record<string, unknown>[] | undefined;

      if (nextMsg && nextMsg.role === "user" && Array.isArray(nextContent)) {
        // Will be handled when we push nextMsg - add to its content
        const placeholders = orphansForMsg.map((o) => ({
          type: "tool_result" as const,
          tool_use_id: o.id,
          content: `[Tool "${o.name}" execution was cancelled or failed]`,
          is_error: true,
        }));
        // Prepend placeholders to next message's content
        if (nextMsg.content) {
            nextMsg.content = [...placeholders, ...(nextMsg.content as Record<string, unknown>[])];
        } else if (nextMsg.parts) {
            nextMsg.parts = [...placeholders as MessagePart[], ...nextMsg.parts];
        }
      } else {
        // Inject new user message with placeholder tool_results
        result.push({
          role: "user",
          parts: orphansForMsg.map((o) => ({
            type: "tool_result",
            tool_use_id: o.id,
            content: `[Tool "${o.name}" execution was cancelled or failed]`,
            is_error: true,
          } as MessagePart)),
        });
      }
    }
  }

  return result;
}

/**
 * Nuclear option: Remove orphaned tool_use blocks entirely.
 * Called when fixClaudeToolPairing() fails to pair all tools.
 */
function removeOrphanedToolUse(messages: MessageContent[], orphanIds: Set<string>): MessageContent[] {
  return messages
    .map((msg) => {
      const content = (msg.content || msg.parts) as Record<string, unknown>[] | undefined;
      if (msg.role === "assistant" && Array.isArray(content)) {
        const filteredContent = content.filter(
          (block) => block.type !== "tool_use" || !orphanIds.has(block.id as string)
        );
        return {
          ...msg,
          parts: filteredContent as MessagePart[],
        };
      }
      return msg;
    })
    .filter(
      (msg) => {
        const content = (msg.content || msg.parts) as Record<string, unknown>[] | undefined;
        // Remove empty assistant messages
        return !(msg.role === "assistant" && Array.isArray(content) && content.length === 0);
      }
    );
}

/**
 * Validate and fix tool pairing with fallback nuclear option.
 * Defense in depth: tries gentle fix first, then nuclear removal.
 */
export function validateAndFixClaudeToolPairing(messages: MessageContent[]): MessageContent[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  // First: Try gentle fix (inject placeholder tool_results)
  const fixed = fixClaudeToolPairing(messages);

  // Second: Validate - find any remaining orphans
  const orphanIds = findOrphanedToolUseIds(fixed);

  if (orphanIds.size === 0) {
    return fixed;
  }

  // Third: Nuclear option - remove orphaned tool_use entirely
  // This should rarely happen, but provides defense in depth
  console.warn("[Alloy] fixClaudeToolPairing left orphans, applying nuclear option", {
    orphanIds: [...orphanIds],
  });

  return removeOrphanedToolUse(fixed, orphanIds);
}

// ============================================================================
// TOOL HALLUCINATION PREVENTION (Ported from LLM-API-Key-Proxy)
// ============================================================================

/**
 * Formats a type hint for a property schema.
 * Port of LLM-API-Key-Proxy's _format_type_hint()
 */
function formatTypeHint(propData: Record<string, unknown>, depth = 0): string {
  const type = propData.type as string ?? "unknown";

  // Handle enum values
  if (propData.enum && Array.isArray(propData.enum)) {
    const enumVals = propData.enum as unknown[];
    if (enumVals.length <= 5) {
      return `string ENUM[${enumVals.map(v => JSON.stringify(v)).join(", ")}]`;
    }
    return `string ENUM[${enumVals.length} options]`;
  }

  // Handle const values
  if (propData.const !== undefined) {
    return `string CONST=${JSON.stringify(propData.const)}`;
  }

  if (type === "array") {
    const items = propData.items as Record<string, unknown> | undefined;
    if (items && typeof items === "object") {
      const itemType = items.type as string ?? "unknown";
      if (itemType === "object") {
        const nestedProps = items.properties as Record<string, unknown> | undefined;
        const nestedReq = items.required as string[] | undefined ?? [];
        if (nestedProps && depth < 1) {
          const nestedList = Object.entries(nestedProps).map(([n, d]) => {
            const t = (d as Record<string, unknown>).type as string ?? "unknown";
            const req = nestedReq.includes(n) ? " REQUIRED" : "";
            return `${n}: ${t}${req}`;
          });
          return `ARRAY_OF_OBJECTS[${nestedList.join(", ")}]`;
        }
        return "ARRAY_OF_OBJECTS";
      }
      return `ARRAY_OF_${itemType.toUpperCase()}`;
    }
    return "ARRAY";
  }

  if (type === "object") {
    const nestedProps = propData.properties as Record<string, unknown> | undefined;
    const nestedReq = propData.required as string[] | undefined ?? [];
    if (nestedProps && depth < 1) {
      const nestedList = Object.entries(nestedProps).map(([n, d]) => {
        const t = (d as Record<string, unknown>).type as string ?? "unknown";
        const req = nestedReq.includes(n) ? " REQUIRED" : "";
        return `${n}: ${t}${req}`;
      });
      return `object{${nestedList.join(", ")}}`;
    }
  }

  return type;
}

/**
 * Injects parameter signatures into tool descriptions.
 * Port of LLM-API-Key-Proxy's _inject_signature_into_descriptions()
 * 
 * @param tools - Array of tool definitions (Gemini format)
 * @param promptTemplate - Template for the signature (default: "\n\nSTRICT PARAMETERS: {params}.")
 * @returns Modified tools array with signatures injected
 */
export function injectParameterSignatures(
  tools: AlloyTool[],
  promptTemplate = "\n\n⚠️ STRICT PARAMETERS: {params}.",
): AlloyTool[] {
  if (!tools || !Array.isArray(tools)) return tools;

  return tools.map((tool) => {
    const declarations = tool.functionDeclarations;
    if (!Array.isArray(declarations)) return tool;

    const newDeclarations = declarations.map((decl: AlloyTool) => {
      // Skip if signature already injected (avoids duplicate injection)
      if (decl.description?.includes("STRICT PARAMETERS:")) {
        return decl;
      }

      const schema = decl.parameters || decl.parametersJsonSchema;
      if (!schema) return decl;

      const required = schema.required as string[] ?? [];
      const properties = schema.properties as Record<string, unknown> ?? {};

      if (Object.keys(properties).length === 0) return decl;

      const paramList = Object.entries(properties).map(([propName, propData]) => {
        const typeHint = formatTypeHint(propData as Record<string, unknown>);
        const isRequired = required.includes(propName);
        return `${propName} (${typeHint}${isRequired ? ", REQUIRED" : ""})`;
      });

      const sigStr = promptTemplate.replace("{params}", paramList.join(", "));
      
      return {
        ...decl,
        description: (decl.description || "") + sigStr,
      };
    });

    return { ...tool, functionDeclarations: newDeclarations };
  });
}

/**
 * Injects a tool hardening system instruction into the request payload.
 * Port of LLM-API-Key-Proxy's _inject_tool_hardening_instruction()
 * 
 * @param payload - The Gemini request payload
 * @param instructionText - The instruction text to inject
 */
export function injectToolHardeningInstruction(
  payload: Record<string, unknown>,
  instructionText: string,
): void {
  if (!instructionText) return;

  // Skip if instruction already present (avoids duplicate injection)
  const existing = payload.systemInstruction as Record<string, unknown> | undefined;
  if (existing && typeof existing === "object" && "parts" in existing) {
    const parts = existing.parts as Array<{ text?: string }>;
    if (Array.isArray(parts) && parts.some(p => p.text?.includes("CRITICAL TOOL USAGE INSTRUCTIONS"))) {
      return;
    }
  }

  const instructionPart = { text: instructionText };

  if (payload.systemInstruction) {
    if (existing && typeof existing === "object" && "parts" in existing) {
      const parts = existing.parts as unknown[];
      if (Array.isArray(parts)) {
        parts.unshift(instructionPart);
      }
    } else if (typeof existing === "string") {
      payload.systemInstruction = {
        role: "assistant",
        parts: [instructionPart, { text: existing }],
      };
    } else {
      payload.systemInstruction = {
        role: "assistant",
        parts: [instructionPart],
      };
    }
  } else {
    payload.systemInstruction = {
      role: "assistant",
      parts: [instructionPart],
    };
  }
}

// ============================================================================
// TOOL PROCESSING FOR WRAPPED REQUESTS
// Shared logic for assigning tool IDs and fixing tool pairing
// ============================================================================

/**
 * Assigns IDs to functionCall parts and returns the pending call IDs by name.
 * This is the first pass of tool ID assignment.
 * 
 * @param contents - Gemini-style contents array
 * @returns Object with modified contents and pending call IDs map
 */
export function assignToolIdsToContents(
  contents: MessageContent[]
): { contents: MessageContent[]; pendingCallIdsByName: Map<string, string[]>; toolCallCounter: number } {
  if (!Array.isArray(contents)) {
    return { contents, pendingCallIdsByName: new Map(), toolCallCounter: 0 };
  }

  let toolCallCounter = 0;
  const pendingCallIdsByName = new Map<string, string[]>();

  const newContents = contents.map((content) => {
    if (!content || !Array.isArray(content.parts)) {
      return content;
    }

    const newParts = content.parts.map((part) => {
      if (part && typeof part === "object" && part.functionCall) {
        const call = { ...part.functionCall };
        if (!call.id) {
          call.id = `tool-call-${++toolCallCounter}`;
        }
        const nameKey = typeof call.name === "string" ? call.name : `tool-${toolCallCounter}`;
        const queue = pendingCallIdsByName.get(nameKey) || [];
        queue.push(call.id);
        pendingCallIdsByName.set(nameKey, queue);
        return { ...part, functionCall: call };
      }
      return part;
    });

    return { ...content, parts: newParts };
  });

  return { contents: newContents, pendingCallIdsByName, toolCallCounter };
}

/**
 * Matches functionResponse IDs to their corresponding functionCall IDs.
 * This is the second pass of tool ID assignment.
 * 
 * @param contents - Gemini-style contents array
 * @param pendingCallIdsByName - Map of function names to pending call IDs
 * @returns Modified contents with matched response IDs
 */
export function matchResponseIdsToContents(
  contents: MessageContent[],
  pendingCallIdsByName: Map<string, string[]>
): MessageContent[] {
  if (!Array.isArray(contents)) {
    return contents;
  }

  return contents.map((content) => {
    if (!content || !Array.isArray(content.parts)) {
      return content;
    }

    const newParts = content.parts.map((part) => {
      if (part && typeof part === "object" && part.functionResponse) {
        const resp = { ...part.functionResponse };
        if (!resp.id && typeof resp.name === "string") {
          const queue = pendingCallIdsByName.get(resp.name);
          if (queue && queue.length > 0) {
            resp.id = queue.shift();
            pendingCallIdsByName.set(resp.name, queue);
          }
        }
        return { ...part, functionResponse: resp };
      }
      return part;
    });

    return { ...content, parts: newParts };
  });
}

/**
 * Applies all tool fixes to a request payload for Claude models.
 * This includes:
 * 1. Tool ID assignment for functionCalls
 * 2. Response ID matching for functionResponses
 * 3. Orphan recovery via fixToolResponseGrouping
 * 4. Claude format pairing fix via validateAndFixClaudeToolPairing
 * 
 * @param payload - Request payload object
 * @param isClaude - Whether this is a Claude model request
 * @returns Object with fix applied status
 */
export function applyToolPairingFixes(
  payload: Record<string, unknown>,
  isClaude: boolean
): { contentsFixed: boolean; messagesFixed: boolean } {
  let contentsFixed = false;
  let messagesFixed = false;

  if (!isClaude) {
    return { contentsFixed, messagesFixed };
  }

  // Fix Gemini format (contents[])
  if (Array.isArray(payload.contents)) {
    // First pass: assign IDs to functionCalls
    const { contents: contentsWithIds, pendingCallIdsByName } = assignToolIdsToContents(
      payload.contents as MessageContent[]
    );

    // Second pass: match functionResponse IDs
    const contentsWithMatchedIds = matchResponseIdsToContents(contentsWithIds, pendingCallIdsByName);

    // Third pass: fix orphan recovery
    payload.contents = fixToolResponseGrouping(contentsWithMatchedIds);
    contentsFixed = true;

    log.debug("Applied tool pairing fixes to contents[]", {
      originalLength: (payload.contents as MessageContent[]).length,
    });
  }

  if (Array.isArray(payload.messages)) {
    payload.messages = validateAndFixClaudeToolPairing(payload.messages as MessageContent[]);
    messagesFixed = true;

    log.debug("Applied tool pairing fixes to messages[]", {
      originalLength: (payload.messages as MessageContent[]).length,
    });
  }

  return { contentsFixed, messagesFixed };
}

/**
 * Creates a synthetic Claude SSE streaming response with error content.
 */
export function createSyntheticErrorResponse(
  errorMessage: string,
  requestedModel: string = "unknown",
): Response {
  // Generate a unique message ID
  const messageId = `msg_synthetic_${Date.now()}`;
  
  // Build Claude SSE events that represent a complete message with error text
  const events: string[] = [];
  
  // 1. message_start event
  events.push(`event: message_start\ndata: ${JSON.stringify({
    type: "message_start",
    message: {
      id: messageId,
      type: "message",
      role: "assistant",
      content: [],
      model: requestedModel,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })}\n\n`);

  // 2. content_block_start event
  events.push(`event: content_block_start\ndata: ${JSON.stringify({
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  })}\n\n`);

  // 3. content_block_delta event with the error message
  events.push(`event: content_block_delta\ndata: ${JSON.stringify({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: errorMessage },
  })}\n\n`);

  // 4. content_block_stop event
  events.push(`event: content_block_stop\ndata: ${JSON.stringify({
    type: "content_block_stop",
    index: 0,
  })}\n\n`);

  // 5. message_delta event (end_turn)
  events.push(`event: message_delta\ndata: ${JSON.stringify({
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: Math.ceil(errorMessage.length / 4) },
  })}\n\n`);

  // 6. message_stop event
  events.push(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);

  const body = events.join("");

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Alloy-Synthetic": "true",
      "X-Alloy-Error-Type": "prompt_too_long",
    },
  });
}
