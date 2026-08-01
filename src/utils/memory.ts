import { promises as fs } from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { z } from "zod";
import { createTool, JarvisTool } from "../core/subsystem.js";

export interface CognitiveMemory {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  list(): Promise<Record<string, string>>;
  clear(): Promise<void>;
}

export class InMemoryCognitiveMemory implements CognitiveMemory {
  private facts = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.facts.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.facts.set(key, value);
  }

  async list(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const [k, v] of this.facts.entries()) {
      result[k] = v;
    }
    return result;
  }

  async clear(): Promise<void> {
    this.facts.clear();
  }
}

export class FileCognitiveMemory implements CognitiveMemory {
  private filePath: string;

  constructor(filePath: string = "jarvis_memory.json") {
    this.filePath = path.resolve(filePath);
  }

  private async load(): Promise<Record<string, string>> {
    try {
      const data = await fs.readFile(this.filePath, "utf-8");
      const json = JSON.parse(data);
      return json.__cognitive_facts__ || {};
    } catch (err: any) {
      return {};
    }
  }

  private async save(facts: Record<string, string>): Promise<void> {
    let currentData: any = {};
    try {
      const data = await fs.readFile(this.filePath, "utf-8");
      currentData = JSON.parse(data);
    } catch (err) {
      currentData = {};
    }
    currentData.__cognitive_facts__ = facts;
    await fs.writeFile(this.filePath, JSON.stringify(currentData, null, 2), "utf-8");
  }

  async get(key: string): Promise<string | undefined> {
    const facts = await this.load();
    return facts[key];
  }

  async set(key: string, value: string): Promise<void> {
    const facts = await this.load();
    facts[key] = value;
    await this.save(facts);
  }

  async list(): Promise<Record<string, string>> {
    return this.load();
  }

  async clear(): Promise<void> {
    await this.save({});
  }
}

export class SqliteCognitiveMemory implements CognitiveMemory {
  private db: Database.Database;
  private sessionId: string;

  constructor(dbPath: string = "jarvis_memory.db", sessionId: string) {
    this.db = new Database(dbPath);
    this.sessionId = sessionId;
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cognitive_facts (
        sessionId TEXT,
        factKey TEXT,
        factValue TEXT,
        updatedAt INTEGER,
        PRIMARY KEY (sessionId, factKey)
      )
    `);
  }

  async get(key: string): Promise<string | undefined> {
    try {
      const stmt = this.db.prepare("SELECT factValue FROM cognitive_facts WHERE sessionId = ? AND factKey = ?");
      const row = stmt.get(this.sessionId, key) as { factValue: string } | undefined;
      return row?.factValue;
    } catch (err) {
      console.error("SqliteCognitiveMemory error in get:", err);
      return undefined;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO cognitive_facts (sessionId, factKey, factValue, updatedAt)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(sessionId, factKey) DO UPDATE SET
          factValue = excluded.factValue,
          updatedAt = excluded.updatedAt
      `);
      stmt.run(this.sessionId, key, value, Date.now());
    } catch (err) {
      console.error("SqliteCognitiveMemory error in set:", err);
    }
  }

  async list(): Promise<Record<string, string>> {
    try {
      const stmt = this.db.prepare("SELECT factKey, factValue FROM cognitive_facts WHERE sessionId = ?");
      const rows = stmt.all(this.sessionId) as Array<{ factKey: string; factValue: string }>;
      
      const result: Record<string, string> = {};
      for (const row of rows) {
        result[row.factKey] = row.factValue;
      }
      return result;
    } catch (err) {
      console.error("SqliteCognitiveMemory error in list:", err);
      return {};
    }
  }

  async clear(): Promise<void> {
    try {
      const stmt = this.db.prepare("DELETE FROM cognitive_facts WHERE sessionId = ?");
      stmt.run(this.sessionId);
    } catch (err) {
      console.error("SqliteCognitiveMemory error in clear:", err);
    }
  }
}

/**
 * Generates Zod-validated tools to let the LLM autonomously store and recall memories.
 */
export function createMemoryTools(memory: CognitiveMemory): JarvisTool<any>[] {
  const storeFact = createTool({
    name: "store_fact",
    description: "Store a specific piece of information or fact in your long-term memory bank.",
    parameters: z.object({
      key: z.string().describe("Descriptive name of the fact, e.g., 'userName', 'suitLocation'"),
      value: z.string().describe("The factual content to save"),
    }),
    execute: async ({ key, value }) => {
      await memory.set(key, value);
      return `Memory saved: '${key}' has been recorded as '${value}'.`;
    },
  });

  const recallFacts = createTool({
    name: "recall_facts",
    description: "Recall all stored facts or look up a specific fact by key to regain context.",
    parameters: z.object({
      key: z.string().optional().describe("Optional key to lookup a specific memory"),
    }),
    execute: async ({ key }) => {
      if (key) {
        const val = await memory.get(key);
        return val ? `Memory lookup [${key}]: "${val}"` : `No stored memory found for key: "${key}".`;
      }
      
      const all = await memory.list();
      if (Object.keys(all).length === 0) {
        return "Memory bank is currently empty. No facts stored.";
      }
      
      const listStr = Object.entries(all)
        .map(([k, v]) => `  - ${k}: ${v}`)
        .join("\n");
      return `Recalled memories:\n${listStr}`;
    },
  });

  return [storeFact, recallFacts];
}
