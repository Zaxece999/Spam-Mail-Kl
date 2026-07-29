export function toProxyAuth(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return s;

  let protocol = "";
  let rest = s;
  const protocolMatch = s.match(/^(socks[45]?|https?):\/\//i);
  if (protocolMatch) {
    protocol = protocolMatch[0];
    rest = s.substring(protocol.length);
  }

  if (rest.includes("@")) {

    return s;
  }

  const parts = rest.split(":");
  if (parts.length >= 4) {
    const host = parts[0] || "";
    const port = parts[1] || "";
    const user = parts[2] || "";
    const pass = parts.slice(3).join(":") || "";
    return `${protocol}${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
  }

  if (parts.length === 2) {
    const host = parts[0] || "";
    const port = parts[1] || "";
    return `${protocol}${host}:${port}`;
  }

  return s;
}
