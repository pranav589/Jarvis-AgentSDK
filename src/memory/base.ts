import { MemoryBank, Message } from "../types/index.js";

export abstract class BaseMemoryBank implements MemoryBank {
  abstract getMessages(sessionId: string): Promise<Message[]>;
  abstract saveMessages(sessionId: string, messages: Message[]): Promise<void>;
  abstract clear(sessionId: string): Promise<void>;
}
