import { toProxyAuth } from "./proxyForm";

export async function checkProxyHttp(proxy: string, retries = 3): Promise<boolean> {

  const normalized = toProxyAuth(proxy);
  if (!normalized) return false;

  const hasAuth = normalized.includes("@");
  if (!hasAuth) {

    const parts = normalized.split(":");
    if (parts.length !== 2) return false;
  }

  const proxyUrl = normalized.startsWith("http") ? normalized : `http://${normalized}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch("http://httpbin.org/ip", {
        proxy: proxyUrl,
        signal: controller.signal,
        headers: {
          Connection: "close",
          "Proxy-Connection": "close",
        },
      });

      if (res.ok) {
        clearTimeout(timeout);
        return true;
      }
    } catch {

    } finally {
      clearTimeout(timeout);
    }

    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return false;
}
