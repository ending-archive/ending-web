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

export function overallPercent(chapterSpans, chapterIndex) {
  const { start, span } = chapterSpans[chapterIndex];
  return Math.min(100, Math.max(0, (start + span * scrollFraction()) * 100));
}
