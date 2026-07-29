export async function retryOnBusy<T>(
  operation: () => Promise<T>,
  maxRetries = 5,
  delayMs = 100
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      if (error?.code === "SQLITE_BUSY" && attempt < maxRetries - 1) {

        const delay = delayMs * Math.pow(2, attempt) + Math.random() * 100;
        console.log(`⚠️ [dbRetry] Database locked, retry ${attempt + 1}/${maxRetries} after ${delay.toFixed(0)}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}
