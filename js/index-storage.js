const FAVORITES_KEY = "ending:favorites";
const FINISHED_BOOKS_KEY = "ending:finished-books";
const LIBRARY_PAGE_KEY = "ending:library-page";

export function loadFinishedBooks() {
  try {
    const raw = localStorage.getItem(FINISHED_BOOKS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((id) => typeof id === "string" && id.length > 0),
    );
  } catch {
    return new Set();
  }
}

export function saveFinishedBooks(finishedBooks) {
  try {
    localStorage.setItem(
      FINISHED_BOOKS_KEY,
      JSON.stringify([...finishedBooks]),
    );
    return true;
  } catch {
    return false;
  }
}

export function getProgress(book) {
  try {
    const raw = localStorage.getItem(`ending:progress:${book.id}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return new Map(parsed.map((id, index) => [String(id), index]));
    }
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

export function saveFavorites(favorites) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(Object.fromEntries(favorites)));
  } catch {}
}

export function loadLibraryPage() {
  try {
    const page = Number.parseInt(localStorage.getItem(LIBRARY_PAGE_KEY), 10);
    return Number.isInteger(page) && page > 0 ? page : 1;
  } catch {
    return 1;
  }
}

export function saveLibraryPage(page) {
  try {
    localStorage.setItem(LIBRARY_PAGE_KEY, String(page));
  } catch {}
}
