export function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[ch],
  );
}

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

export function isFinishedProgress(progress) {
  return (
    progress?.finished === true ||
    (Number.isFinite(Number(progress?.progressPercent)) &&
      Number(progress.progressPercent) >= 99)
  );
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
