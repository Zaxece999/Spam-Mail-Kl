import { db } from "../index";
import { keys } from "../schema";
import { eq } from "drizzle-orm";

export type ApiKey = {
  id: number;
  keyValue: string;
  rps: number;
  enabled: boolean;
  errorMessage?: string | null;
  createdAt: number;
  updatedAt: number;
};

export class KeysRepo {

  static async getAll(): Promise<ApiKey[]> {
    const result = await db.select().from(keys);
    return result.map(k => ({
      ...k,
      enabled: k.enabled === 1
    }));
  }

  static async getEnabled(): Promise<ApiKey[]> {
    const result = await db.select().from(keys).where(eq(keys.enabled, 1));
    return result.map(k => ({
      ...k,
      enabled: true
    }));
  }

  static async getById(id: number): Promise<ApiKey | null> {
    const result = await db.select().from(keys).where(eq(keys.id, id)).limit(1);
    if (result.length === 0) return null;

    const key = result[0]!;
    return {
      ...key,
      enabled: key.enabled === 1
    };
  }

  static async create(keyValue: string, rps: number = 5): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    const result = await db.insert(keys).values({
      keyValue,
      rps,
      enabled: 1,
      errorMessage: null,
      createdAt: now,
      updatedAt: now
    }).returning({ id: keys.id });

    return result[0]!.id;
  }

  static async update(id: number, updates: {
    keyValue?: string;
    rps?: number;
    enabled?: boolean;
    errorMessage?: string | null;
  }): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const updateData: any = {
      ...updates,
      updatedAt: now
    };

    if (updates.enabled !== undefined) {
      updateData.enabled = updates.enabled ? 1 : 0;
    }

    const result = await db.update(keys)
      .set(updateData)
      .where(eq(keys.id, id));

    return result.changes > 0;
  }

  static async disable(id: number, errorMessage: string): Promise<boolean> {
    return this.update(id, {
      enabled: false,
      errorMessage
    });
  }

  static async disableByValue(keyValue: string, errorMessage: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);

    const existingKey = await db.select()
      .from(keys)
      .where(eq(keys.keyValue, keyValue))
      .limit(1);

    if (existingKey.length === 0) {
      console.warn(`Key ${keyValue} not found in database`);
      return false;
    }

    if (existingKey[0]!.enabled === 0) {
      console.warn(`Key ${keyValue} already disabled`);
      return false;
    }

    const result = await db.update(keys)
      .set({
        enabled: 0,
        errorMessage,
        updatedAt: now
      })
      .where(eq(keys.keyValue, keyValue));

    return result.changes > 0;
  }

  static async delete(id: number): Promise<boolean> {
    const result = await db.delete(keys).where(eq(keys.id, id));
    return result.changes > 0;
  }

  static async hasActiveKeys(): Promise<boolean> {
    const result = await db.select({ count: keys.id })
      .from(keys)
      .where(eq(keys.enabled, 1))
      .limit(1);

    return result.length > 0;
  }
}
