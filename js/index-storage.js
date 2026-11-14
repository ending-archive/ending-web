const FAVORITES_KEY = "ending:favorites";
const LIBRARY_PAGE_KEY = "ending:library-page";
export const READING_DAYS_KEY = "ending:reading-days";
export const WEEKLY_GOAL_KEY = "ending:weekly-goal";
const DEFAULT_WEEKLY_GOAL = 3;

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

function localDateKey(date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function loadReadingDays() {
  try {
    const raw = localStorage.getItem(READING_DAYS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const today = localDateKey(new Date());
    return [...new Set(parsed.filter(isDateKey))]
      .filter((date) => date <= today)
      .sort();
  } catch {
    return [];
  }
}

export function loadWeeklyGoal() {
  try {
    const goal = Number(localStorage.getItem(WEEKLY_GOAL_KEY));
    return Number.isInteger(goal) && goal >= 1 && goal <= 7
      ? goal
      : DEFAULT_WEEKLY_GOAL;
  } catch {
    return DEFAULT_WEEKLY_GOAL;
  }
}

export function saveWeeklyGoal(goal) {
  try {
    localStorage.setItem(WEEKLY_GOAL_KEY, String(goal));
  } catch {}
}
