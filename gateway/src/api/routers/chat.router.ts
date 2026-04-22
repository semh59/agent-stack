import type { FastifyInstance } from "fastify";
import { AlloyGatewayClient } from "../../orchestration/gateway-client";
import { type TokenStore } from "../../gateway/token-store";
import { type AccountManager } from "../../plugin/accounts";
import { apiResponse, apiError } from "../../gateway/rest-response";
import { type SQLiteChatRepository } from "../../persistence/SQLiteChatRepository";
import type { SlashCommandRegistry, SlashCommandContext } from "../../orchestration/commands/SlashCommandRegistry";
import type { PipelineState } from "../../orchestration/shared-memory";



/**
 * Dependencies for the Chat Router
 */
export interface ChatRouteDependencies {
  tokenStore: TokenStore;
  getAccountManager: () => AccountManager | null;
  chatRepository: SQLiteChatRepository;
  slashCommandRegistry: SlashCommandRegistry;
}


/**
 * Chat Router â€” Statless LLM Inference
 */
export function registerChatRoutes(app: FastifyInstance, dependencies: ChatRouteDependencies): void {
  const { tokenStore, getAccountManager, chatRepository } = dependencies;

  // 1. List conversations
  app.get("/api/chat/conversations", async (request, reply) => {
     const activeAccount = tokenStore.getActiveToken();
     if (!activeAccount) return reply.status(401).send(apiError("Unauthorized"));
     const list = await chatRepository.listConversations(activeAccount.email || "");
     return apiResponse(list);
  });

  // 2. Get history
  app.get<{ Params: { id: string } }>("/api/chat/conversations/:id", async (request, _reply) => {
     const history = await chatRepository.getHistory(request.params.id);
     return apiResponse(history);
  });

  // 3. Create conversation
  app.post<{ Body: { title: string, mode?: string } }>("/api/chat/conversations", async (request, reply) => {
     const activeAccount = tokenStore.getActiveToken();
     if (!activeAccount) return reply.status(401).send(apiError("Unauthorized"));
     
     const id = `conv_${Date.now()}`;
     await chatRepository.createConversation({
        id,
        title: request.body.title || "New Chat",
        mode: request.body.mode || "code",
        ownerAccount: activeAccount.email || "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
     });
     return apiResponse({ id });
  });

  // 5. Chat Endpoint (Streaming support)
  app.post<{ Body: { message: string; conversationId: string; model?: string; stream?: boolean } }>(
    "/api/chat",
    async (request, reply) => {
      const { message, conversationId, model, stream } = request.body ?? {};

      if (!message || !conversationId) {
        return reply.status(400).send(apiError("message and conversationId are required"));
      }

      const accountManager = getAccountManager();
      const accessToken = await tokenStore.getValidAccessToken();
      const activeAccount = tokenStore.getActiveToken();

      if (!accessToken || !accountManager || !activeAccount) {
        return reply.status(401).send(apiError("Active account or token session not found."));
      }

      const client = AlloyGatewayClient.fromToken(accessToken, activeAccount.email, accountManager);
      const selectedModel = model || "gemini-1.5-pro";
      const cleanModel = selectedModel.includes("/") ? (selectedModel.split("/")[1] || selectedModel) : selectedModel;
      
      // Save User Message
      await chatRepository.saveMessage({
         conversationId,
         role: "user",
         content: message,
         createdAt: new Date().toISOString()
      });

      const historyEntities = await chatRepository.getHistory(conversationId);
      const contents = historyEntities.map(m => ({
         role: m.role,
         parts: [{ text: m.content }]
      }));

      // If streaming is requested, we use the streamGenerateContent endpoint
      if (stream) {
         const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:streamGenerateContent?alt=sse`;
         const res = await client.fetch(url, {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ contents, generationConfig: { temperature: 0.7, maxOutputTokens: 2048 } }),
         });

         if (!res.ok) {
           return reply.status(res.status).send(apiError(`LLM Stream Error: ${res.status}`));
         }

         reply.raw.setHeader("Content-Type", "text/event-stream");
         reply.raw.setHeader("Cache-Control", "no-cache");
         reply.raw.setHeader("Connection", "keep-alive");

         let fullResponse = "";
         const reader = res.body?.getReader();
         if (!reader) return reply.status(500).send(apiError("No response body"));

         const decoder = new TextDecoder();
         let buffer = "";

         try {
            let isDone = false;
            while (!isDone) {
               const { done, value } = await reader.read();
               if (done) {
                  isDone = true;
                  break;
               }

               buffer += decoder.decode(value, { stream: true });
               const lines = buffer.split("\n");
               buffer = lines.pop() || "";

               for (const line of lines) {
                  const trimmed = line.trim();
                  if (!trimmed || !trimmed.startsWith("data: ")) continue;

                  const dataStr = trimmed.slice(6);
                  if (dataStr === "[DONE]") continue;

                  try {
                     const json = JSON.parse(dataStr);
                     let deltaText = "";
                     
                     // Provider-agnostic extraction logic
                     if (json.candidates?.[0]?.content?.parts?.[0]?.text) {
                        // Google Gemini format
                        deltaText = json.candidates[0].content.parts[0].text;
                     } else if (json.choices?.[0]?.delta?.content) {
                        // OpenAI / Anthropic-compatibility format
                        deltaText = String(json.choices[0].delta.content);
                     } else if (json.type === "content_block_delta" && json.delta?.text) {
                        // Native Anthropic format
                        deltaText = String(json.delta.text);
                     }

                     if (deltaText) {
                        fullResponse += deltaText;
                        reply.raw.write(`data: ${JSON.stringify({ text: deltaText })}\n\n`);
                     }
                  } catch (_e) {
                     // Ignore partial or malformed lines
                  }
               }
            }

            // Save Assistant Response to DB after stream completion
            await chatRepository.saveMessage({
               conversationId,
               role: "model",
               content: fullResponse, 
               model: selectedModel,
               createdAt: new Date().toISOString()
            });
         } finally {
            reply.raw.end();
            reader.releaseLock();
         }
         return;
      }

      // Non-streaming fallback
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent`;
      try {
        const res = await client.fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents, generationConfig: { temperature: 0.7, maxOutputTokens: 2048 } }),
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => "Unknown error");
          return reply.status(res.status).send(apiError(`LLM Error: ${errBody}`));
        }

        const data = await res.json() as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
        };
        const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

        await chatRepository.saveMessage({
           conversationId,
           role: "model",
           content: replyText,
           model: selectedModel,
           tokensInput: data.usageMetadata?.promptTokenCount,
           tokensOutput: data.usageMetadata?.candidatesTokenCount,
           createdAt: new Date().toISOString()
        });

        return apiResponse({
          text: replyText,
          model: selectedModel,
          usage: {
            prompt: data.usageMetadata?.promptTokenCount ?? 0,
            completion: data.usageMetadata?.candidatesTokenCount ?? 0,
            total: data.usageMetadata?.totalTokenCount ?? 0
          }
        });
      } catch (err) {
        return reply.status(500).send(apiError(err instanceof Error ? err.message : String(err)));
      }
    }
  );

  // 6. Execute Slash Command
  app.post<{ Body: { command: string; sessionId?: string } }>(
    "/api/chat/command",
    async (request, reply) => {
      const { command, sessionId } = request.body ?? {};
      if (!command) return reply.status(400).send(apiError("command is required"));

      const activeAccount = tokenStore.getActiveToken();
      if (!activeAccount) return reply.status(401).send(apiError("Unauthorized"));

      const sid = sessionId || `cmd_${Date.now()}`;
      
      // We need a dummy state for commands that don't have a mission context yet
      const context: SlashCommandContext = {
        projectRoot: (app as unknown as { projectRoot: string }).projectRoot || process.cwd(), 
        sessionId: sid,
        state: { 
          userTask: "",
          pipelineStatus: "idle",
          completedAgents: [],
          filesCreated: [],
          knownIssues: []
        } as PipelineState, 
        updateState: async () => {},
      };

      const result = await dependencies.slashCommandRegistry.execute(command, context);
      return apiResponse(result);

    }
  );
}
