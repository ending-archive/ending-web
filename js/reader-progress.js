const READING_DAYS_KEY = "ending:reading-days";

export function loadProgress(id) {
  try {
    const raw = localStorage.getItem("ending:progress:" + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveProgress(id, data) {
  try {
    localStorage.setItem("ending:progress:" + id, JSON.stringify(data));
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

export function recordReadingDay() {
  const today = localDateKey(new Date());
  let days = [];
  try {
    const raw = localStorage.getItem(READING_DAYS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    days = Array.isArray(parsed)
      ? [...new Set(parsed.filter(isDateKey))].filter((date) => date <= today)
      : [];
  } catch {}
  if (days.includes(today)) return;
  days.push(today);
  try {
    localStorage.setItem(READING_DAYS_KEY, JSON.stringify(days.sort()));
  } catch {}
}

export function scrollFraction() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, window.scrollY / max));
}

export function buildChapterSpans(chapters) {
  const total = chapters.reduce((length, chapter) => length + chapter.text.length, 0) || 1;
  let accumulated = 0;
  return chapters.map((chapter) => {
    const span = { start: accumulated / total, span: chapter.text.length / total };
    accumulated += chapter.text.length;
    return span;
  });
}

export function overallPercent(chapterSpans, chapterIndex, finished) {
  if (finished) return 100;
  const { start, span } = chapterSpans[chapterIndex];
  return Math.min(100, Math.max(0, (start + span * scrollFraction()) * 100));
}
