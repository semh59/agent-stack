import type { FastifyInstance } from "fastify";
import { AlloyGatewayClient } from "../../orchestration/gateway-client";
import { type TokenStore } from "../../gateway/token-store";
import { type AccountManager } from "../../plugin/accounts";
import { apiResponse, apiError } from "../../gateway/rest-response";
import { type SQLiteChatRepository } from "../../persistence/SQLiteChatRepository";

/**
 * Dependencies for the Chat Router
 */
export interface ChatRouteDependencies {
  tokenStore: TokenStore;
  getAccountManager: () => AccountManager | null;
  chatRepository: SQLiteChatRepository;
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
     const list = await chatRepository.listConversations(activeAccount.email);
     return apiResponse(list);
  });

  // 2. Get history
  app.get<{ Params: { id: string } }>("/api/chat/conversations/:id", async (request, reply) => {
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
        ownerAccount: activeAccount.email,
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
      const cleanModel = selectedModel.includes("/") ? selectedModel.split("/")[1]! : selectedModel;
      
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

         let done = false;
         const decoder = new TextDecoder();
         while (!done) {
            const result = await reader.read();
            done = result.done;
            if (result.value) {
               const chunk = decoder.decode(result.value, { stream: true });
               fullResponse += chunk;
               reply.raw.write(chunk);
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

         reply.raw.end();
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

        const data = await res.json() as any;
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
}
