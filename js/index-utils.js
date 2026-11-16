export { escapeHtml } from "./shared.js";

export function normalizeSearchText(text) {
  const normalized = String(text)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[’‘'ʼ`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return normalized ? normalized.split(/\s+/) : [];
}

export function getAddedAtTimestamp(book) {
  if (typeof book.addedAt !== "string") return null;
  const timestamp = Date.parse(book.addedAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isNewArrival(book, now = Date.now()) {
  const addedAt = getAddedAtTimestamp(book);
  if (addedAt === null) return false;
  const age = now - addedAt;
  return age >= 0 && age < 7 * 24 * 60 * 60 * 1000;
}

export function sortBooksByAddedAt(books) {
  return books
    .map((book, index) => ({
      book,
      index,
      addedAt: getAddedAtTimestamp(book),
    }))
    .sort((a, b) => {
      if (a.addedAt === null) {
        return b.addedAt === null ? a.index - b.index : 1;
      }
      if (b.addedAt === null) return -1;
      return b.addedAt - a.addedAt || a.index - b.index;
    })
    .map(({ book }) => book);
}

// Drops malformed or duplicate entries so one bad record can't break the page.
export function validateBooks(raw) {
  const books = [];
  const problems = [];
  const seen = new Set();

  raw.forEach((entry, i) => {
    const where = `books.json[${i}]`;
    if (!entry || typeof entry !== "object") {
      problems.push(`${where}: not an object`);
      return;
    }
    const id = typeof entry.id === "string" ? entry.id : "";
    if (!/^[\w-]{1,100}$/.test(id)) {
      problems.push(`${where}: missing or invalid id`);
      return;
    }
    if (seen.has(id)) {
      problems.push(`${where}: duplicate id "${id}"`);
      return;
    }
    if (typeof entry.title !== "string" || !entry.title.trim()) {
      problems.push(`${where} (${id}): missing title`);
      return;
    }
    seen.add(id);
    books.push({
      ...entry,
      author:
        typeof entry.author === "string" && entry.author.trim()
          ? entry.author
          : "Unknown author",
      cover: typeof entry.cover === "string" ? entry.cover : "",
    });
  });

  return { books, problems };
}
