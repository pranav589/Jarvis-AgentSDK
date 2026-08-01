import { BaseMemoryBank } from "./base.js";
import { Message } from "../types/index.js";

export class InMemoryMemoryBank extends BaseMemoryBank {
  private sessions = new Map<string, Message[]>();

  async getMessages(sessionId: string): Promise<Message[]> {
    return this.sessions.get(sessionId) || [];
  }

  async saveMessages(sessionId: string, messages: Message[]): Promise<void> {
    this.sessions.set(sessionId, [...messages]);
  }

  async clear(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
