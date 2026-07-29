export type NickOut = { nicks: string[]; text: string };
export type Adv = {
  title: string;
  price: string;
  photo: string;
  link: string;
  personDotName: string;
};

const RE_NON_LETTERS = /[^\p{L}]+/gu;
const RE_DIAC = /\p{Diacritic}/gu;

function normalizeTitleLine(line: string): string {
  let s = line.replace(/^\uFEFF/, "");
  s = s.replace(/^[^\p{L}📱]+/u, "");
  s = s.trimStart();
  if (!s.startsWith("📱")) s = "📱" + s;
  return s;
}

export function isName(s: string): boolean {
  if (!s) return false;
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return false;
  const words = t.split(/\s+/);
  if (words.length < 2) return false;
  const lettersCount = t.replace(RE_NON_LETTERS, "").length;
  return lettersCount >= 10;
}

export function toNick(raw: string): string {
  if (!raw) return "";
  let s = raw.normalize("NFD").replace(RE_DIAC, "").replace(/ß/g, "ss");
  s = s
    .toLowerCase()
    .replace(/[^a-z\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parts = s.split(" ").filter(Boolean);
  if (parts.length < 2) return "";

  const a = parts[0]!.replace(/-/g, "");
  const b = parts[1]!.replace(/-/g, "");
  if (!a || !b) return "";
  return `${a}.${b}`;
}

function parseItems(content: string): any[] {
  try {
    const p = JSON.parse(content);
    return Array.isArray(p?.items) ? p.items : [];
  } catch {
    return [];
  }
}

function splitBlocks(content: string): string[] {
  return content
    .split(/^\s*(?:=+|-+)\s*$/gm)
    .map((b) => b.trim())
    .filter(Boolean);
}

function parseTextBlocks(content: string): Adv[] {
  const blocks = splitBlocks(content);
  const res: Adv[] = [];

  for (const block of blocks) {

    const firstLine = block.split("\n").find((l) => l.trim().length > 0) ?? "";
    const normLine = normalizeTitleLine(firstLine);
    const title = normLine.replace(/^📱\s*/, "").trim() || "-";

    const price = block.match(/🏷️\s*Цена:\s*([^\n]+)/)?.[1]?.trim() ?? "-";

    const photo =
      block.match(/Фото товара\s*\((https?:[^\s)]+)\)/)?.[1]?.trim() ?? "-";

    const link =
      block.match(/Ссылка на товар\s*\((https?:[^\s)]+)\)/)?.[1]?.trim() ??
      block
        .match(/https:\/\/www\.kleinanzeigen\.de\/s-anzeige\/[^\s)\n]+/i)?.[0]
        ?.trim() ??
      "-";

    const seller = block.match(/💼\s*Продавец:\s*([^\n]+)/)?.[1]?.trim() ?? "";

    if (!isName(seller)) continue;
    const nick = toNick(seller);
    if (!nick) continue;

    res.push({
      title,
      price,
      photo,
      link,
      personDotName: nick,
    });
  }

  return res;
}

export function nickify(content: string): NickOut {
  const set = new Set<string>();

  const items = parseItems(content);
  if (items.length > 0) {

    for (const it of items) {
      const name =
        typeof it?.item_person_name === "string" ? it.item_person_name : "";
      if (!isName(name)) continue;
      const nick = toNick(name);
      if (nick) set.add(nick);
    }
  } else {

    const adverts = parseTextBlocks(content);
    for (const adv of adverts) set.add(adv.personDotName);
  }

  const nicks = [...set];
  return { nicks, text: nicks.join("\n") };
}

export function buildAdverts(content: string): Adv[] {
  const items = parseItems(content);

  if (items.length > 0) {
    const map = new Map<string, Adv>();
    for (const it of items) {
      const name =
        typeof it?.item_person_name === "string" ? it.item_person_name : "";
      if (!isName(name)) continue;
      const nick = toNick(name);
      if (!nick || map.has(nick)) continue;

      map.set(nick, {
        title: String(it?.item_title ?? "-"),
        price: String(it?.item_price ?? "-"),
        photo: String(it?.item_photo ?? "-"),
        link: String(it?.item_link ?? "-"),
        personDotName: nick,
      });
    }
    return [...map.values()];
  }

  const adverts = parseTextBlocks(content);
  const unique = new Map<string, Adv>();
  for (const adv of adverts)
    if (!unique.has(adv.personDotName)) unique.set(adv.personDotName, adv);
  return [...unique.values()];
}

export function toTxt(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
