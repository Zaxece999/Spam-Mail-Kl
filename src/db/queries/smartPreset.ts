import { db } from "../index";
import { users, smartPresets } from "../schema";
import { eq, and, asc, gt } from "drizzle-orm";

export class SmartPresetRepo {

  private static async _getUserId(telegramId: number): Promise<number> {
    const row = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .get();

    if (!row) throw new Error(`User with telegramId=${telegramId} not found`);
    return row.id;
  }

  static async add(telegramId: number, text: string) {
    const userId = await this._getUserId(telegramId);
    await db.insert(smartPresets).values({ userId, text }).run();
  }

  static async update(telegramId: number, presetId: number, text: string) {
    const userId = await this._getUserId(telegramId);
    await db
      .update(smartPresets)
      .set({ text })
      .where(and(eq(smartPresets.id, presetId), eq(smartPresets.userId, userId)))
      .run();
  }

  static async remove(telegramId: number, presetId: number) {
    const userId = await this._getUserId(telegramId);
    await db
      .delete(smartPresets)
      .where(and(eq(smartPresets.id, presetId), eq(smartPresets.userId, userId)))
      .run();
  }

  static async clear(telegramId: number) {
    const userId = await this._getUserId(telegramId);
    await db.delete(smartPresets).where(eq(smartPresets.userId, userId)).run();
  }

  static async list(telegramId: number) {
    const userId = await this._getUserId(telegramId);
    return db
      .select({
        id: smartPresets.id,
        text: smartPresets.text,
      })
      .from(smartPresets)
      .where(eq(smartPresets.userId, userId))
      .all();
  }

  static async nextSmartPreset(
    telegramId: number
  ): Promise<{ id: number; text: string } | null> {
    const userId = await this._getUserId(telegramId);

    return db.transaction(async (tx) => {

      const cur = await tx
        .select({ cursor: users.smartPresetCursorId })
        .from(users)
        .where(eq(users.id, userId))
        .get();

      const cursor = cur?.cursor ?? 0;

      const next = await tx
        .select({ id: smartPresets.id, text: smartPresets.text })
        .from(smartPresets)
        .where(and(eq(smartPresets.userId, userId), gt(smartPresets.id, cursor)))
        .orderBy(asc(smartPresets.id))
        .limit(1)
        .get();

      const chosen =
        next ??
        (await tx
          .select({ id: smartPresets.id, text: smartPresets.text })
          .from(smartPresets)
          .where(eq(smartPresets.userId, userId))
          .orderBy(asc(smartPresets.id))
          .limit(1)
          .get());

      if (!chosen) return null;

      await tx
        .update(users)
        .set({ smartPresetCursorId: chosen.id })
        .where(eq(users.id, userId))
        .run();

      return chosen;
    });
  }

  static async resetSmartPresetCursor(telegramId: number) {
    const userId = await this._getUserId(telegramId);
    await db
      .update(users)
      .set({ smartPresetCursorId: null })
      .where(eq(users.id, userId))
      .run();
  }
}
