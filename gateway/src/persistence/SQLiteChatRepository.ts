import { randomUUID } from "node:crypto";
import { MissionDatabase, getMissionDatabase } from "./database";

export interface ChatConversation {
  id: string;
  title: string;
  mode: string;
  ownerAccount: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageEntity {
  id?: string;
  conversationId: string;
  role: string; // "user", "model", "system"
  content: string;
  tokensInput?: number;
  tokensOutput?: number;
  model?: string;
  createdAt: string;
}

/**
 * SQLite implementation of Chat persistence.
 */
export class SQLiteChatRepository {
  constructor(private readonly database: MissionDatabase = getMissionDatabase()) {}

  public async createConversation(conv: ChatConversation): Promise<void> {
    try {
      this.database.connection
        .prepare(
          `INSERT INTO chat_conversations (id, title, mode, owner_account, created_at, updated_at)
           VALUES (@id, @title, @mode, @owner_account, @created_at, @updated_at)`
        )
        .run({
          id: conv.id,
          title: conv.title,
          mode: conv.mode,
          owner_account: conv.ownerAccount,
          created_at: conv.createdAt,
          updated_at: conv.updatedAt,
        });
    } catch (err) {
      throw new Error(`Failed to create conversation: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public async saveMessage(msg: ChatMessageEntity): Promise<void> {
     try {
       this.database.connection.transaction(() => {
          this.database.connection
            .prepare(
              `INSERT INTO chat_messages (id, conversation_id, role, content, tokens_input, tokens_output, model, created_at)
               VALUES (@id, @conversation_id, @role, @content, @tokens_input, @tokens_output, @model, @created_at)`
            )
            .run({
              id: msg.id || randomUUID(),
              conversation_id: msg.conversationId,
              role: msg.role,
              content: msg.content,
              tokens_input: msg.tokensInput ?? null,
              tokens_output: msg.tokensOutput ?? null,
              model: msg.model ?? null,
              created_at: msg.createdAt,
            });

          this.database.connection
            .prepare(`UPDATE chat_conversations SET updated_at = ? WHERE id = ?`)
            .run(new Date().toISOString(), msg.conversationId);
       })();
     } catch (err) {
       throw new Error(`Failed to save chat message: ${err instanceof Error ? err.message : String(err)}`);
     }
  }

  public async getHistory(conversationId: string): Promise<ChatMessageEntity[]> {
    try {
      const rows = this.database.connection
        .prepare(`SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC`)
        .all(conversationId) as any[];

      return rows.map(r => ({
        id: r.id,
        conversationId: r.conversation_id,
        role: r.role,
        content: r.content,
        tokensInput: r.tokens_input,
        tokensOutput: r.tokens_output,
        model: r.model,
        createdAt: r.created_at,
      }));
    } catch (err) {
      throw new Error(`Failed to load chat history: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public async listConversations(ownerAccount: string): Promise<ChatConversation[]> {
    try {
      const rows = this.database.connection
        .prepare(`SELECT * FROM chat_conversations WHERE owner_account = ? ORDER BY updated_at DESC`)
        .all(ownerAccount) as any[];

      return rows.map(r => ({
        id: r.id,
        title: r.title,
        mode: r.mode,
        ownerAccount: r.owner_account,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    } catch (err) {
      throw new Error(`Failed to list conversations: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public async deleteConversation(id: string): Promise<void> {
    try {
      this.database.connection
        .prepare(`DELETE FROM chat_conversations WHERE id = ?`)
        .run(id);
    } catch (err) {
      throw new Error(`Failed to delete conversation: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public async updateTitle(id: string, title: string): Promise<void> {
    try {
      this.database.connection
        .prepare(`UPDATE chat_conversations SET title = ?, updated_at = ? WHERE id = ?`)
        .run(title, new Date().toISOString(), id);
    } catch (err) {
      throw new Error(`Failed to rename conversation: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
