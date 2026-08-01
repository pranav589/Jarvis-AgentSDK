import { promises as fs } from "fs";
import * as path from "path";
import { BaseMemoryBank } from "./base.js";
import { Message } from "../types/index.js";

export class FileMemoryBank extends BaseMemoryBank {
  private filePath: string;
  private cache: Record<string, Message[]> = {};
  private isLoaded = false;

  constructor(filePath: string = "jarvis_memory.json") {
    super();
    this.filePath = path.resolve(filePath);
  }

  private async load() {
    if (this.isLoaded) return;
    try {
      const data = await fs.readFile(this.filePath, "utf-8");
      const json = JSON.parse(data);
      this.cache = {};
      for (const [key, value] of Object.entries(json)) {
        if (key !== "__cognitive_facts__" && Array.isArray(value)) {
          this.cache[key] = value;
        }
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        console.error("Failed to load MemoryBank file:", err);
      }
      this.cache = {};
    }
    this.isLoaded = true;
  }

  private async save() {
    try {
      let currentData: any = {};
      try {
        const data = await fs.readFile(this.filePath, "utf-8");
        currentData = JSON.parse(data);
      } catch (err) {
        currentData = {};
      }

      // Merge session histories
      for (const [sessionId, messages] of Object.entries(this.cache)) {
        currentData[sessionId] = messages;
      }

      await fs.writeFile(this.filePath, JSON.stringify(currentData, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to write to MemoryBank file:", err);
    }
  }

  async getMessages(sessionId: string): Promise<Message[]> {
    await this.load();
    return this.cache[sessionId] || [];
  }

  async saveMessages(sessionId: string, messages: Message[]): Promise<void> {
    // Force reload to get latest external changes
    this.isLoaded = false;
    await this.load();
    this.cache[sessionId] = [...messages];
    await this.save();
  }

  async clear(sessionId: string): Promise<void> {
    this.isLoaded = false;
    await this.load();
    delete this.cache[sessionId];
    await this.save();
  }
}
