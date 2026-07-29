import { db } from "../index";
import { users, presets } from "../schema";
import { eq, and } from "drizzle-orm";

export class PresetRepo {

  private static async _getUserId(telegramId: number): Promise<number> {
    const row = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .get();

    if (!row) throw new Error(`User with telegramId=${telegramId} not found`);
    return row.id;
  }

  static async add(telegramId: number, title: string, text: string) {
    const userId = await this._getUserId(telegramId);
    await db.insert(presets).values({ userId, title, text }).run();
  }

  static async update(telegramId: number, presetId: number, text: string) {
    const userId = await this._getUserId(telegramId);
    await db
      .update(presets)
      .set({ text })
      .where(and(eq(presets.id, presetId), eq(presets.userId, userId)))
      .run();
  }

  static async remove(telegramId: number, presetId: number) {
    const userId = await this._getUserId(telegramId);
    await db
      .delete(presets)
      .where(and(eq(presets.id, presetId), eq(presets.userId, userId)))
      .run();
  }

  static async clear(telegramId: number) {
    const userId = await this._getUserId(telegramId);
    await db.delete(presets).where(eq(presets.userId, userId)).run();
  }

  static async list(telegramId: number) {
    const userId = await this._getUserId(telegramId);
    return db
      .select({
        id: presets.id,
        title: presets.title,
        text: presets.text,
      })
      .from(presets)
      .where(eq(presets.userId, userId))
      .all();
  }
}
