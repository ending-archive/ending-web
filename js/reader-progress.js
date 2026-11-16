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

// Scroll position as 0..1. Used for bookmarks and scroll restore.
// Returns 0 when the page doesn't scroll.
export function scrollFraction() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, window.scrollY / max));
}

// Reading progress as 0..1. A chapter that fits on one screen is fully
// visible, so it counts as fully read.
export function progressFraction() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (max <= 0) return 1;
  return Math.min(1, Math.max(0, window.scrollY / max));
}

export function buildChapterSpans(chapters) {
  const total =
    chapters.reduce((length, chapter) => length + chapter.text.length, 0) || 1;
  let accumulated = 0;
  return chapters.map((chapter) => {
    const span = {
      start: accumulated / total,
      span: chapter.text.length / total,
    };
    accumulated += chapter.text.length;
    return span;
  });
}

export function overallPercent(chapterSpans, chapterIndex, finished = false) {
  if (finished) return 100;
  const { start, span } = chapterSpans[chapterIndex];
  return Math.min(99, Math.max(0, (start + span * progressFraction()) * 100));
}

export function topbarHeight() {
  return document.querySelector(".topbar")?.getBoundingClientRect().height || 0;
}

// Paragraph index + fractional offset: stable across font/size/width changes.
export function currentAnchor() {
  if (window.scrollY <= 4) return null;
  const top = topbarHeight();
  for (const p of document.querySelectorAll(".chapter-body [data-paragraph]")) {
    const r = p.getBoundingClientRect();
    if (r.bottom > top + 4) {
      return {
        paragraph: Number(p.dataset.paragraph),
        offset: r.height
          ? Math.min(1, Math.max(0, (top - r.top) / r.height))
          : 0,
        excerpt: p.textContent.trim().slice(0, 80),
      };
    }
  }
  return null;
}

export function scrollToAnchor(anchor) {
  if (!anchor || !Number.isInteger(anchor.paragraph)) return false;
  const p = document.querySelector(
    `.chapter-body [data-paragraph="${anchor.paragraph}"]`,
  );
  if (!p) return false;
  const top =
    p.getBoundingClientRect().top +
    window.scrollY -
    topbarHeight() +
    (anchor.offset || 0) * p.offsetHeight;
  window.scrollTo({ top: Math.max(0, top), left: 0, behavior: "instant" });
  return true;
}
