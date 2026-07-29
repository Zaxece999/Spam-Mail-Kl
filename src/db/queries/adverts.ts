import { db } from "../index";
import { adverts, users, emailMessages } from "../schema";
import { eq, and, asc } from "drizzle-orm";
import { retryOnBusy } from "../../utils/dbRetry";
import { EmailMsgRepo } from "./emailMessage";

import type { Adv } from "../../utils/nickify";

export class AdvertsRepo {
  private static async _getUserId(telegramId: number): Promise<number> {
    const row = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .get();

    if (!row) throw new Error(`User with telegramId=${telegramId} not found`);
    return row.id;
  }

  static async add(params: {
    userId: number;
    title: string;
    price: string;
    photo: string;
    link: string;
    personDotName: string;
  }): Promise<boolean> {
    const { userId, title, price, photo, link, personDotName } = params;

    const inserted = await retryOnBusy(() =>
      db
        .insert(adverts)
        .values({
          userId,
          title,
          price,
          photo,
          link,
          personDotName,
          status: 0,
        })
        .onConflictDoNothing({ target: [adverts.userId, adverts.personDotName] })
        .returning({ id: adverts.id })
    );

    if (inserted.length > 0) {
      return true;
    }

    return false;
  }

  static async bulkAdd(userId: number, candidates: Adv[]): Promise<number> {
    if (!candidates.length) return 0;

    const values = candidates.map((c) => ({
      userId,
      title: c.title,
      price: c.price,
      photo: c.photo,
      link: c.link,
      personDotName: c.personDotName,
      status: 0 as 0,
    }));

    const inserted = await retryOnBusy(() =>
      db
        .insert(adverts)
        .values(values)
        .onConflictDoNothing({ target: [adverts.userId, adverts.personDotName] })
        .returning({ id: adverts.id })
    );

    return inserted.length;
  }

  static async bulkAddByTelegramId(
    telegramId: number,
    candidates: Adv[]
  ): Promise<number> {
    const row = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .get();
    if (!row) throw new Error(`User with telegramId=${telegramId} not found`);
    return this.bulkAdd(row.id, candidates);
  }

  static async setReady(advertId: number, email: string) {
    const updated = await db
      .update(adverts)
      .set({ email, status: 2 })
      .where(eq(adverts.id, advertId))
      .returning({ id: adverts.id });
    return updated.length > 0;
  }

  static async setNotFound(advertId: number) {
    const updated = await db
      .update(adverts)
      .set({ status: 1 })
      .where(eq(adverts.id, advertId))
      .returning({ id: adverts.id });
    return updated.length > 0;
  }

  static async listPendingByTelegramId(telegramId: number, limit = 5000) {
    const userId = await this._getUserId(telegramId);
    return db
      .select({
        id: adverts.id,
        personDotName: adverts.personDotName,
      })
      .from(adverts)
      .where(and(eq(adverts.userId, userId), eq(adverts.status, 0)))
      .limit(limit)
      .all();
  }

  static async setFakeLink(advertId: number, fakeLink: string) {
    const updated = await db
      .update(adverts)
      .set({ fakeLink })
      .where(eq(adverts.id, advertId))
      .returning({ id: adverts.id });

    return updated.length > 0;
  }

  static async setPrice(advertId: number, price: string) {
    const updated = await db
      .update(adverts)
      .set({ price })
      .where(eq(adverts.id, advertId))
      .returning({ id: adverts.id });

    return updated.length > 0;
  }

  static async setEmail(advertId: number, email: string | null) {
    const updated = await db
      .update(adverts)
      .set({ email })
      .where(eq(adverts.id, advertId))
      .returning({ id: adverts.id });

    return updated.length > 0;
  }

  static async setStatus(advertId: number, status: 0 | 1 | 2 | 3) {
    const updated = await db
      .update(adverts)
      .set({ status })
      .where(eq(adverts.id, advertId))
      .returning({ id: adverts.id });

    return updated.length > 0;
  }

  static async listReadyByTelegramId(telegramId: number) {
    const row = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .get();
    if (!row) throw new Error(`User with telegramId=${telegramId} not found`);
    const userId = row.id;

    return db
      .select({
        id: adverts.id,
        title: adverts.title,
        email: adverts.email,
      })
      .from(adverts)
      .where(and(eq(adverts.userId, userId), eq(adverts.status, 2)))
      .orderBy(asc(adverts.id))
      .all();
  }

  static async getAdvertByMailId(mailId: number) {
    console.log(`[getAdvertByMailId] Fetching advert for mailId=${mailId}`);
    const row = await db
      .select({
        advertId: emailMessages.advertId,
        link: adverts.link,
      })
      .from(emailMessages)
      .leftJoin(adverts, eq(emailMessages.advertId, adverts.id))
      .where(eq(emailMessages.id, mailId))
      .get();

    let advertId = row?.advertId ?? null;
    let link = row?.link ?? null;

    console.log(`[getAdvertByMailId] Initial advertId=${advertId}, link=${link ? 'present' : 'null'}`);

    if (!advertId) {
      console.log(`[getAdvertByMailId] No advertId found, trying fallback search...`);
      const guessedAdvertId = await EmailMsgRepo.findAdvertIdByContent(mailId);
      if (guessedAdvertId) {
        advertId = guessedAdvertId;
        const adv = await db
          .select({ link: adverts.link })
          .from(adverts)
          .where(eq(adverts.id, guessedAdvertId))
          .get();
        link = adv?.link ?? link;
        console.log(`[getAdvertByMailId] Fallback found advertId=${advertId}, link=${link ? 'present' : 'null'}`);
      } else {
        console.log(`[getAdvertByMailId] Fallback search returned no results`);
      }
    }

    console.log(`[getAdvertByMailId] Final result: advertId=${advertId}, link=${link ? 'present' : 'null'}`);
    return {
      advertId,
      link,
    };
  }

  static async getTextByMailId(mailId: number) {
    const row = await db
      .select({
        text: emailMessages.text,
      })
      .from(emailMessages)
      .where(eq(emailMessages.id, mailId))
      .get();

    return row?.text ?? null;
  }

  static async getFakeLink(mailId: number): Promise<string | null> {
    const row = await db
      .select({ fakeLink: adverts.fakeLink })
      .from(emailMessages)
      .leftJoin(adverts, eq(emailMessages.advertId, adverts.id))
      .where(eq(emailMessages.id, mailId))
      .get();

    return row?.fakeLink ?? null;
  }

  static async getFakeLinkByAdvertId(advertId: number): Promise<string | null> {
    const row = await db
      .select({ fakeLink: adverts.fakeLink })
      .from(adverts)
      .where(eq(adverts.id, advertId))
      .get();

    return row?.fakeLink ?? null;
  }

  static async getAdvertDataByMailId(mailId: number) {
    const row = await db
      .select({
        title: adverts.title,
        price: adverts.price,
        photo: adverts.photo,
        link: adverts.link,
        fakeLink: adverts.fakeLink,
      })
      .from(emailMessages)
      .innerJoin(adverts, eq(emailMessages.advertId, adverts.id))
      .where(eq(emailMessages.id, mailId))
      .get();

    return row ?? null;
  }
}
