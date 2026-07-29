import { db } from "../index";
import { users } from "../schema";
import { eq, not } from "drizzle-orm";
import { retryOnBusy } from "../../utils/dbRetry";

type UserFlag =
  | "topicMode"
  | "smartMode"
  | "spoofMode"
  | "htmlMailerMode"
  | "shortMode"
  | "paypalMode"
  | "giroMode"
  | "lockMode";

export type TeamProvider = "gag" | "tsum" | "aqua";

export class UserRepo {
  static async exists(telegramId: number): Promise<boolean> {
    const row = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .get();

    return !!row;
  }

  static async upsert(telegramId: number, username?: string) {
    const exists = await this.exists(telegramId);
    if (!exists) {
      await db.insert(users).values({
        telegramId,
        username: username ?? null,
      });
      console.log(`✅ Новый пользователь добавлен: ${telegramId}`);
    }
  }

  static async updateLastOnline(telegramId: number) {
    await db
      .update(users)
      .set({ lastOnline: new Date().toISOString() })
      .where(eq(users.telegramId, telegramId))
      .run();
  }

  static async updateUsername(
    telegramId: number,
    username: string | undefined
  ) {
    if (!username) return;

    const duplicate = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .get();

    if (duplicate && duplicate.id) {
      await retryOnBusy(() =>
        db
          .update(users)
          .set({ username: null })
          .where(eq(users.id, duplicate.id))
          .run()
      );
    }

    await retryOnBusy(() =>
      db
        .update(users)
        .set({ username })
        .where(eq(users.telegramId, telegramId))
        .run()
    );
  }

  static async toggleFlag(telegramId: number, column: UserFlag) {
    await db
      .update(users)
      .set({ [column]: not(users[column]) })
      .where(eq(users.telegramId, telegramId))
      .run();
  }

  static async getFlags(telegramId: number) {
    const row = await db
      .select({
        topicMode: users.topicMode,
        smartMode: users.smartMode,
        spoofMode: users.spoofMode,
        htmlMailerMode: users.htmlMailerMode,
        shortMode: users.shortMode,
        paypalMode: users.paypalMode,
        giroMode: users.giroMode,
        lockMode: users.lockMode,
      })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .get();

    if (!row) throw new Error(`User ${telegramId} not found`);
    return row;
  }

  static async getSpoofName(telegramId: number) {
    const row = await db
      .select({ spoofName: users.spoofName })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .get();

    if (!row) throw new Error(`User ${telegramId} not found`);
    return row.spoofName;
  }

  static async setSpoofName(telegramId: number, spoofName: string) {
    await db
      .update(users)
      .set({ spoofName })
      .where(eq(users.telegramId, telegramId))
      .run();
  }

  static async getInterval(
    telegramId: number
  ): Promise<{ min: number; max: number }> {
    const row = await db
      .select({ interval: users.interval })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .get();

    if (!row) throw new Error(`User ${telegramId} not found`);

    try {
      let [min, max] = JSON.parse(row.interval) as [number, number];

      if (!Number.isFinite(min) || !Number.isFinite(max))
        return { min: 1, max: 1 };
      if (min < 0) min = 0;
      if (max < 0) max = 0;
      if (max < min) [min, max] = [max, min];
      min = Math.floor(min);
      max = Math.floor(max);
      return { min, max };
    } catch {
      return { min: 1, max: 1 };
    }
  }

  static async setInterval(telegramId: number, min: number, max: number) {
    if (min < 0 || max < 0 || min > 30 || max > 30 || min > max) {
      throw new Error("Интервал должен быть 0–30 секунд, min ≤ max");
    }

    await db
      .update(users)
      .set({ interval: JSON.stringify([min, max]) })
      .where(eq(users.telegramId, telegramId))
      .run();
  }

  static async getApiKey(provider: TeamProvider, telegramId: number) {
    const apiKeyCol =
      provider === "tsum" ? users.apiKeyTsum
      : provider === "aqua" ? users.apiKeyAqua
      : users.apiKeyGag;

    const row = await db
      .select({ apiKey: apiKeyCol })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .get();

    if (!row) throw new Error(`User ${telegramId} not found`);
    return row.apiKey;
  }

  static async setApiKey(
    provider: TeamProvider,
    telegramId: number,
    apiKey: string
  ) {
    const setObj: Partial<typeof users.$inferInsert> =
      provider === "tsum" ? { apiKeyTsum: apiKey }
      : provider === "aqua" ? { apiKeyAqua: apiKey }
      : { apiKeyGag: apiKey };

    await db
      .update(users)
      .set(setObj)
      .where(eq(users.telegramId, telegramId))
      .run();
  }

  static async getProfileId(provider: TeamProvider, telegramId: number) {
    const profileIdCol =
      provider === "tsum" ? users.profileIdTsum : users.profileIdAqua;

    const row = await db
      .select({ profileId: profileIdCol })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .get();

    if (!row) throw new Error(`User ${telegramId} not found`);
    return row.profileId;
  }

  static async setProfileId(
    provider: TeamProvider,
    telegramId: number,
    profileId: string
  ) {
    const setObj: Partial<typeof users.$inferInsert> =
      provider === "tsum"
        ? { profileIdTsum: profileId }
        : { profileIdAqua: profileId };

    await db
      .update(users)
      .set(setObj)
      .where(eq(users.telegramId, telegramId))
      .run();
  }

  static async getAddress(telegramId: number) {
    const row = await db
      .select({ address: users.addressGag })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .get();

    if (!row) throw new Error(`User ${telegramId} not found`);
    return row.address;
  }

  static async setAddress(telegramId: number, address: string) {
    await db
      .update(users)
      .set({ addressGag: address })
      .where(eq(users.telegramId, telegramId))
      .run();
  }

  static async getBuyerName(telegramId: number) {
    const row = await db
      .select({ buyer: users.buyerNameGag })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .get();

    if (!row) throw new Error(`User ${telegramId} not found`);
    return row.buyer;
  }

  static async setBuyerName(telegramId: number, buyerName: string) {
    await db
      .update(users)
      .set({ buyerNameGag: buyerName })
      .where(eq(users.telegramId, telegramId))
      .run();
  }

  static async getTeam(telegramId: number): Promise<TeamProvider> {
    const row = await db
      .select({ team: users.team })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .get();

    if (!row) throw new Error(`User ${telegramId} not found`);
    return row.team;
  }

  static async setTeam(telegramId: number, team: TeamProvider) {
    await db
      .update(users)
      .set({ team })
      .where(eq(users.telegramId, telegramId))
      .run();
  }

  static async listForEmails(): Promise<{ id: number; telegramId: number }[]> {
    return await db
      .select({ id: users.id, telegramId: users.telegramId })
      .from(users)
      .all();
  }

  static async getRole(telegramId: number): Promise<"guest" | "user" | "admin"> {
    const row = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .get();

    if (!row) throw new Error(`User ${telegramId} not found`);
    return row.role;
  }

  static async setRole(telegramId: number, role: "guest" | "user" | "admin") {
    await db
      .update(users)
      .set({ role })
      .where(eq(users.telegramId, telegramId))
      .run();
  }

  static async getAllUsers() {
    return await db
      .select({
        id: users.id,
        telegramId: users.telegramId,
        username: users.username,
        role: users.role,
        createdAt: users.createdAt,
        lastOnline: users.lastOnline,
      })
      .from(users)
      .all();
  }

  static async getUsersWithAccess() {
    return await db
      .select({
        id: users.id,
        telegramId: users.telegramId,
        username: users.username,
        role: users.role,
        lastOnline: users.lastOnline,
      })
      .from(users)
      .where(not(eq(users.role, "guest")))
      .all();
  }

  static async getUserByTelegramId(telegramId: number) {
    return await db
      .select({
        id: users.id,
        telegramId: users.telegramId,
        username: users.username,
        role: users.role,
        createdAt: users.createdAt,
        lastOnline: users.lastOnline,
      })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .get();
  }
}
