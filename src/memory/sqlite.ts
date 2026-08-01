import Database from "better-sqlite3";
import { BaseMemoryBank } from "./base.js";
import { Message } from "../types/index.js";

export class SqliteMemoryBank extends BaseMemoryBank {
  private db: Database.Database;

  constructor(dbPath: string = "jarvis_memory.db") {
    super();
    this.db = new Database(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_sessions (
        sessionId TEXT PRIMARY KEY,
        messages TEXT,
        updatedAt INTEGER
      )
    `);
  }

  async getMessages(sessionId: string): Promise<Message[]> {
    try {
      const stmt = this.db.prepare("SELECT messages FROM memory_sessions WHERE sessionId = ?");
      const row = stmt.get(sessionId) as { messages: string } | undefined;
      
      if (!row) return [];
      return JSON.parse(row.messages);
    } catch (err) {
      console.error("SqliteMemoryBank error in getMessages:", err);
      return [];
    }
  }

  async saveMessages(sessionId: string, messages: Message[]): Promise<void> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO memory_sessions (sessionId, messages, updatedAt)
        VALUES (?, ?, ?)
        ON CONFLICT(sessionId) DO UPDATE SET
          messages = excluded.messages,
          updatedAt = excluded.updatedAt
      `);
      stmt.run(sessionId, JSON.stringify(messages), Date.now());
    } catch (err) {
      console.error("SqliteMemoryBank error in saveMessages:", err);
    }
  }

  async clear(sessionId: string): Promise<void> {
    try {
      const stmt = this.db.prepare("DELETE FROM memory_sessions WHERE sessionId = ?");
      stmt.run(sessionId);
    } catch (err) {
      console.error("SqliteMemoryBank error in clear:", err);
    }
  }
}
