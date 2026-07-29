import { UserRepo } from "../db/queries";

export async function createFirstAdmin(telegramId: number) {
  try {

    const userExists = await UserRepo.exists(telegramId);

    if (!userExists) {
      console.log(`❌ Пользователь с ID ${telegramId} не найден. Сначала пользователь должен написать /start боту.`);
      return false;
    }

    await UserRepo.setRole(telegramId, "admin");
    console.log(`✅ Пользователь ${telegramId} успешно назначен администратором!`);
    return true;

  } catch (error) {
    console.error("Ошибка при создании администратора:", error);
    return false;
  }
}

export async function makeAdmin(telegramId: number) {
  return await createFirstAdmin(telegramId);
}
