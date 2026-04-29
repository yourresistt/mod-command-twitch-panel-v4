import { chatCommands, moderationEvents } from "@shared/schema";
import type {
  ChatCommand,
  InsertChatCommand,
  InsertModerationEvent,
  ModerationEvent,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);
export const sqliteDb = sqlite;

sqlite
  .prepare(
    `CREATE TABLE IF NOT EXISTS moderation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_user TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      moderator TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  )
  .run();

sqlite
  .prepare(
    `CREATE TABLE IF NOT EXISTS chat_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      response TEXT NOT NULL,
      cooldown_seconds INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    )`,
  )
  .run();

export interface IStorage {
  listModerationEvents(): Promise<ModerationEvent[]>;
  createModerationEvent(event: InsertModerationEvent): Promise<ModerationEvent>;
  listCommands(): Promise<ChatCommand[]>;
  upsertCommand(command: InsertChatCommand): Promise<ChatCommand>;
}

const defaultCommands: InsertChatCommand[] = [
  {
    name: "!rules",
    response: "Respect everyone, no spoilers, no links without permission.",
    cooldownSeconds: 30,
    enabled: true,
  },
  {
    name: "!clip",
    response: "Clip that moment and drop it in Discord after stream.",
    cooldownSeconds: 20,
    enabled: true,
  },
  {
    name: "!uptime",
    response: "Stream has been live for 02:41.",
    cooldownSeconds: 10,
    enabled: true,
  },
  {
    name: "!lurk",
    response: "Thanks for lurking. Enjoy the stream in the background.",
    cooldownSeconds: 15,
    enabled: true,
  },
];

export class DatabaseStorage implements IStorage {
  constructor() {
    const existing = db.select().from(chatCommands).all();
    if (existing.length === 0) {
      defaultCommands.forEach((command) => {
        db.insert(chatCommands).values(command).returning().get();
      });
    }
  }

  async listModerationEvents(): Promise<ModerationEvent[]> {
    return db.select().from(moderationEvents).all().reverse();
  }

  async createModerationEvent(event: InsertModerationEvent): Promise<ModerationEvent> {
    return db.insert(moderationEvents).values(event).returning().get();
  }

  async listCommands(): Promise<ChatCommand[]> {
    return db.select().from(chatCommands).all();
  }

  async upsertCommand(command: InsertChatCommand): Promise<ChatCommand> {
    const existing = db
      .select()
      .from(chatCommands)
      .where(eq(chatCommands.name, command.name))
      .get();

    if (!existing) {
      return db.insert(chatCommands).values(command).returning().get();
    }

    return db
      .update(chatCommands)
      .set(command)
      .where(eq(chatCommands.name, command.name))
      .returning()
      .get();
  }
}

export const storage = new DatabaseStorage();
