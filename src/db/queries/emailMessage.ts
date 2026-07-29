import { db } from "../index";
import { users, emails, emailMessages, adverts } from "../schema";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { retryOnBusy } from "../../utils/dbRetry";

export class EmailMsgRepo {

  static async has(emailId: number, msgId: string): Promise<boolean> {
    const row = await db
      .select({ id: emailMessages.id })
      .from(emailMessages)
      .where(
        and(eq(emailMessages.emailId, emailId), eq(emailMessages.msgId, msgId))
      )
      .limit(1)
      .get();
    return !!row;
  }

  static async logSent(
    emailId: number,
    msgId: string,
    subject: string,
    text: string,
    senderName: string,
    emailFrom: string,
    tgMsgId: number | null,
    advertId: number | null
  ): Promise<void> {
    await retryOnBusy(() =>
      db
        .insert(emailMessages)
        .values({
          emailId,
          msgId,
          subject: subject ?? "",
          text: text ?? "",
          senderName: senderName ?? "",
          emailFrom: emailFrom ?? "",
          tgMsgId: tgMsgId ?? null,
          advertId: advertId ?? null,
        })
        .run()
    );
  }

  static async getFullMessage(msgId: number) {
    const row = db
      .select({
        id: emailMessages.id,
        emailId: emailMessages.emailId,
        msgId: emailMessages.msgId,
        subject: emailMessages.subject,
        text: emailMessages.text,
        senderName: emailMessages.senderName,
        emailFrom: emailMessages.emailFrom,
        tgMsgId: emailMessages.tgMsgId,
        advertId: emailMessages.advertId,

        name: emails.name,
        email: emails.email,
        isSpam: emails.isSpam,
      })
      .from(emailMessages)
      .innerJoin(emails, eq(emailMessages.emailId, emails.id))
      .where(eq(emailMessages.id, msgId))
      .get();

    if (!row) return null;

    return {
      ...row,
      tgMsgId: row.tgMsgId ?? 0,
    };
  }

  static async getIdByMsgId(msgId: string): Promise<number | null> {
    const row = await db
      .select({ id: emailMessages.id })
      .from(emailMessages)
      .where(eq(emailMessages.msgId, msgId))
      .limit(1)
      .get();

    return row ? row.id : null;
  }

  static async getMessageMeta(emailId: number, msgId: string) {
    const row = await db
      .select({
        tgMsgId: emailMessages.tgMsgId,
        advertId: emailMessages.advertId,
      })
      .from(emailMessages)
      .where(
        and(eq(emailMessages.emailId, emailId), eq(emailMessages.msgId, msgId))
      )
      .get();

    return {
      tgMsgId: row?.tgMsgId ?? 0,
      advertId: row?.advertId ?? null,
    };
  }

  static async findAdvertIdByContent(mailId: number): Promise<number | null> {
    console.log(`[findAdvertIdByContent] Starting search for mailId=${mailId}`);
    const current = await db
      .select({
        emailId: emailMessages.emailId,
        subject: emailMessages.subject,
        text: emailMessages.text,
        emailFrom: emailMessages.emailFrom,
      })
      .from(emailMessages)
      .where(eq(emailMessages.id, mailId))
      .get();

    if (!current) {
      console.log(`[findAdvertIdByContent] mailId=${mailId} not found in DB`);
      return null;
    }

    const snippet = (current.text || "").trim().slice(0, 120);

    const orParts: any[] = [eq(emailMessages.subject, current.subject), eq(emailMessages.emailFrom, current.emailFrom)];

    if (snippet.length > 15) {

      orParts.push(sql`instr(${emailMessages.text}, ${snippet}) > 0`);
    }

    const contentMatch = orParts.length === 1 ? orParts[0]! : or(...(orParts as any));

    console.log(`[findAdvertIdByContent] Searching by subject="${current.subject.slice(0, 50)}", from="${current.emailFrom}", snippet.length=${snippet.length}`);
    const found = await db
      .select({ advertId: emailMessages.advertId })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.emailId, current.emailId),
          sql`${emailMessages.advertId} IS NOT NULL`,
          contentMatch
        )
      )
      .orderBy(desc(emailMessages.id))
      .get();

    let advertId = found?.advertId ?? null;

    if (!advertId) {
      console.log(`[findAdvertIdByContent] No matching advert found among email_messages, trying direct adverts match by email+title...`);
      advertId = await this.findAdvertIdDirectly(current.emailId, current.subject, current.emailFrom);
    }

    if (!advertId) {
      console.log(`[findAdvertIdByContent] No matching advert found for mailId=${mailId}`);
      return null;
    }

    console.log(`[findAdvertIdByContent] Found advertId=${advertId} for mailId=${mailId}, updating...`);

    await db
      .update(emailMessages)
      .set({ advertId })
      .where(eq(emailMessages.id, mailId));

    console.log(`[findAdvertIdByContent] Successfully linked mailId=${mailId} to advertId=${advertId}`);
    return advertId;
  }

  private static async findAdvertIdDirectly(
    emailId: number,
    subject: string,
    emailFrom: string
  ): Promise<number | null> {
    const owner = await db
      .select({ userId: emails.userId })
      .from(emails)
      .where(eq(emails.id, emailId))
      .get();

    if (!owner) {
      console.log(`[findAdvertIdByContent] Direct match: owning email account not found for emailId=${emailId}`);
      return null;
    }

    let normalizedSubject = subject.trim();
    while (/^(re|aw|fwd|fw):\s*/i.test(normalizedSubject)) {
      normalizedSubject = normalizedSubject.replace(/^(re|aw|fwd|fw):\s*/i, "").trim();
    }

    if (!normalizedSubject) {
      console.log(`[findAdvertIdByContent] Direct match: empty normalized subject, skipping`);
      return null;
    }

    const found = await db
      .select({ id: adverts.id })
      .from(adverts)
      .where(
        and(
          eq(adverts.userId, owner.userId),
          sql`lower(${adverts.email}) = lower(${emailFrom})`,
          sql`lower(${adverts.title}) = lower(${normalizedSubject})`
        )
      )
      .orderBy(desc(adverts.id))
      .get();

    if (!found) {
      console.log(`[findAdvertIdByContent] Direct match: no advert found for userId=${owner.userId}, email="${emailFrom}", title="${normalizedSubject.slice(0, 50)}"`);
      return null;
    }

    console.log(`[findAdvertIdByContent] Direct match: found advertId=${found.id}`);
    return found.id;
  }

  static async setMessageMeta(
    emailId: number,
    msgId: string,
    tgMsgId: number,
    advertId?: number | null
  ) {
    await db
      .update(emailMessages)
      .set({
        tgMsgId,
        advertId: advertId ?? null,
      })
      .where(
        and(eq(emailMessages.emailId, emailId), eq(emailMessages.msgId, msgId))
      );
  }

  static async trueMarkNew(
    emailId: number,
    msgId: string,
    subject: string,
    text: string,
    senderName: string,
    emailFrom: string
  ): Promise<boolean> {

    const exists = await this.has(emailId, msgId);
    if (exists) return false;

    try {
      await retryOnBusy(() =>
        db
          .insert(emailMessages)
          .values({ emailId, msgId, subject, text, senderName, emailFrom })
          .run()
      );
      return true;
    } catch {
      return false;
    }
  }

  static async anyForEmail(emailId: number): Promise<boolean> {
    const row = await db
      .select({ id: emailMessages.id })
      .from(emailMessages)
      .where(eq(emailMessages.emailId, emailId))
      .limit(1)
      .get();
    return !!row;
  }

  static async bulkMarkAllRead(
    emailId: number,
    msgIds: string[]
  ): Promise<void> {
    if (msgIds.length === 0) return;

    await retryOnBusy(() =>
      db
        .insert(emailMessages)
        .values(
          msgIds.map((msgId) => ({
            emailId,
            msgId,
            subject: "",
            text: "",
            senderName: "",
            emailFrom: "",
          }))
        )
        .onConflictDoNothing()
    );
  }

  static async hasAdvert(mailId: number): Promise<boolean> {
    const row = await db
      .select({ advertId: emailMessages.advertId })
      .from(emailMessages)
      .where(eq(emailMessages.id, mailId))
      .get();

    return !!row?.advertId;
  }
}
