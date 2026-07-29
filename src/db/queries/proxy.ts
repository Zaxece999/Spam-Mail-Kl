import { db } from "../index";
import { users, proxies } from "../schema";
import { eq, and, asc, gt } from "drizzle-orm";

export class ProxyRepo {

  private static async _getUserId(telegramId: number): Promise<number> {
    const row = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .get();

    if (!row) throw new Error(`User with telegramId=${telegramId} not found`);
    return row.id;
  }

  static async add(telegramId: number, proxyList: string[]) {
    const userId = await this._getUserId(telegramId);

    const uniqueList = [...new Set(proxyList.map((p) => p.trim()))];

    const existing = await db
      .select({ proxy: proxies.proxy })
      .from(proxies)
      .where(eq(proxies.userId, userId))
      .all();

    const existingSet = new Set(existing.map((e) => e.proxy));

    const toInsert = uniqueList.filter((p) => !existingSet.has(p));

    if (toInsert.length === 0) return 0;

    await db
      .insert(proxies)
      .values(toInsert.map((p) => ({ userId, proxy: p, isValid: 1 })))
      .run();

    return toInsert.length;
  }

  static async update(
    telegramId: number,
    proxyId: number,
    newProxy: string,
    isValid: boolean
  ) {
    const userId = await this._getUserId(telegramId);

    await db
      .update(proxies)
      .set({ proxy: newProxy.trim(), isValid: isValid ? 1 : 0 })
      .where(and(eq(proxies.id, proxyId), eq(proxies.userId, userId)))
      .run();
  }

  static async setValid(telegramId: number, proxyId: number, isValid: boolean) {
    const userId = await this._getUserId(telegramId);

    await db
      .update(proxies)
      .set({ isValid: isValid ? 1 : 0 })
      .where(and(eq(proxies.id, proxyId), eq(proxies.userId, userId)))
      .run();
  }

  static async markInvalidByProxy(telegramId: number, proxyString: string) {
    const userId = await this._getUserId(telegramId);

    await db
      .update(proxies)
      .set({ isValid: 0 })
      .where(and(eq(proxies.userId, userId), eq(proxies.proxy, proxyString)))
      .run();
  }

  static async remove(telegramId: number, proxyId: number) {
    const userId = await this._getUserId(telegramId);

    await db
      .delete(proxies)
      .where(and(eq(proxies.id, proxyId), eq(proxies.userId, userId)))
      .run();
  }

  static async clear(telegramId: number) {
    const userId = await this._getUserId(telegramId);

    await db.delete(proxies).where(eq(proxies.userId, userId)).run();
  }

  static async list(telegramId: number) {
    const userId = await this._getUserId(telegramId);

    return db
      .select({
        id: proxies.id,
        proxy: proxies.proxy,
        isValid: proxies.isValid,
      })
      .from(proxies)
      .where(eq(proxies.userId, userId))
      .all();
  }

  static async nextValidProxy(
    telegramId: number
  ): Promise<{ id: number; proxy: string } | null> {
    const userId = await this._getUserId(telegramId);

    return db.transaction(async (tx) => {

      const cur = await tx
        .select({ cursor: users.proxyCursorId })
        .from(users)
        .where(eq(users.id, userId))
        .get();

      const cursor = cur?.cursor ?? 0;

      const next = await tx
        .select({ id: proxies.id, proxy: proxies.proxy })
        .from(proxies)
        .where(
          and(
            eq(proxies.userId, userId),
            eq(proxies.isValid, 1),
            gt(proxies.id, cursor)
          )
        )
        .orderBy(asc(proxies.id))
        .limit(1)
        .get();

      const chosen =
        next ??
        (await tx
          .select({ id: proxies.id, proxy: proxies.proxy })
          .from(proxies)
          .where(and(eq(proxies.userId, userId), eq(proxies.isValid, 1)))
          .orderBy(asc(proxies.id))
          .limit(1)
          .get());

      if (!chosen) return null;

      await tx
        .update(users)
        .set({ proxyCursorId: chosen.id })
        .where(eq(users.id, userId))
        .run();

      return chosen;
    });
  }

  static async resetCursor(telegramId: number) {
    const userId = await this._getUserId(telegramId);
    await db
      .update(users)
      .set({ proxyCursorId: null })
      .where(eq(users.id, userId))
      .run();
  }
}
