import type { Context, NextFunction } from "grammy";
import { UserRepo } from "../db/queries";
import { ADMIN_IDS } from "../config";

export function requireRole(requiredRole: "user" | "admin") {
  return async (ctx: Context, next: NextFunction) => {
    if (!ctx.from) {
      await ctx.reply("❌ Ошибка: Не удалось определить пользователя");
      return;
    }

    try {
      const userRole = await UserRepo.getRole(ctx.from.id);

      if (userRole === "guest") {
        await ctx.reply("🚫 У вас нет доступа к боту. Обратитесь к администратору.");
        return;
      }

      if (requiredRole === "admin" && userRole !== "admin") {
        await ctx.reply("🚫 Только администраторы могут использовать эту функцию.");
        return;
      }

      await next();
    } catch (error) {
      console.error("Role check error:", error);
      await ctx.reply("❌ Ошибка проверки прав доступа");
    }
  };
}

export async function isAdmin(telegramId: number): Promise<boolean> {
  try {

    const role = await UserRepo.getRole(telegramId);
    if (role === "admin") {
      return true;
    }

    if (ADMIN_IDS.length > 0 && ADMIN_IDS.includes(telegramId.toString())) {
      return true;
    }

    return false;
  } catch (error) {

    console.error("Database error, falling back to ADMIN_IDS:", error);
    return ADMIN_IDS.length > 0 && ADMIN_IDS.includes(telegramId.toString());
  }
}

export async function hasAccess(telegramId: number): Promise<boolean> {
  try {
    const role = await UserRepo.getRole(telegramId);
    if (role !== "guest") {
      return true;
    }

    if (ADMIN_IDS.length > 0 && ADMIN_IDS.includes(telegramId.toString())) {
      return true;
    }

    return false;
  } catch (error) {

    console.error("Database error, falling back to ADMIN_IDS:", error);
    return ADMIN_IDS.length > 0 && ADMIN_IDS.includes(telegramId.toString());
  }
}
