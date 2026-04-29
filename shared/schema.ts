import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const moderationEvents = sqliteTable("moderation_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  targetUser: text("target_user").notNull(),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  moderator: text("moderator").notNull(),
  createdAt: text("created_at").notNull(),
});

export const chatCommands = sqliteTable("chat_commands", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  response: text("response").notNull(),
  cooldownSeconds: integer("cooldown_seconds").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});

export const insertModerationEventSchema = createInsertSchema(moderationEvents).omit({
  id: true,
});

export const insertChatCommandSchema = createInsertSchema(chatCommands).omit({
  id: true,
});

export const moderationActionSchema = z.object({
  targetUser: z.string().min(1),
  action: z.enum(["timeout_60", "timeout_600", "ban", "delete", "warn"]),
  reason: z.string().min(1),
  messageId: z.string().optional(),
});

export const commandUpdateSchema = z.object({
  name: z.string().min(2),
  response: z.string().min(2),
  cooldownSeconds: z.number().int().min(0).max(3600),
  enabled: z.boolean(),
});

export type InsertModerationEvent = z.infer<typeof insertModerationEventSchema>;
export type ModerationEvent = typeof moderationEvents.$inferSelect;
export type InsertChatCommand = z.infer<typeof insertChatCommandSchema>;
export type ChatCommand = typeof chatCommands.$inferSelect;
export type ModerationAction = z.infer<typeof moderationActionSchema>;
export type CommandUpdate = z.infer<typeof commandUpdateSchema>;
