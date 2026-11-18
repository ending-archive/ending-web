// Client behavior for the generated share pages (b/<id>/index.html).
// Keep storage keys and progress rules in sync with js/index-storage.js,
// js/reader-progress.js and js/index-cards.js.

const PROGRESS_PREFIX = "ending:progress:";
const FINISHED_BOOKS_KEY = "ending:finished-books";

function readJson(key, fallback) {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    if (raw === null || raw === "") return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// ---------- cover fallback ----------
function setupCoverFallback() {
  const img = document.querySelector(".share-cover-frame img");
  const title = document.querySelector(".share-title");
  if (!img || !title) return;

  const swap = () => {
    const fallback = document.createElement("div");
    fallback.className = "share-cover-fallback";
    fallback.setAttribute("aria-hidden", "true");
    fallback.textContent = title.textContent;
    img.replaceWith(fallback);
  };

  // Module scripts run after parsing, so the image may already have failed.
  if (img.complete && img.naturalWidth === 0) {
    swap();
  } else {
    img.addEventListener("error", swap, { once: true });
  }
}

// ---------- progress ----------
// Returns { percent, label } for in-progress books, or null.
// Mirrors renderContinueReading() in js/index-cards.js, including the legacy
// format that only has chapterIndex + scrollFraction.
function readProgress(id) {
  const stored = readJson(PROGRESS_PREFIX + id, null);
  if (
    !stored ||
    typeof stored !== "object" ||
    !Number.isInteger(stored.chapterIndex) ||
    !Number.isFinite(Number(stored.updatedAt))
  ) {
    return null;
  }

  const storedPercent = Number(stored.progressPercent);
  const hasStoredPercent =
    stored.progressPercent !== null &&
    stored.progressPercent !== undefined &&
    Number.isFinite(storedPercent) &&
    storedPercent >= 0 &&
    storedPercent <= 100;

  const legacyFraction = Number(stored.scrollFraction);
  const raw = hasStoredPercent ? storedPercent : legacyFraction * 100;
  if (!Number.isFinite(raw)) return null;

  const percent = Math.round(Math.min(99, Math.max(0, raw)));
  const label = hasStoredPercent
    ? `${percent}% read`
    : `Chapter ${stored.chapterIndex + 1}`;
  return { percent, label };
}

function setupProgress() {
  const id = document.body.dataset.bookId;
  const readLink = document.getElementById("readLink");
  const progress = document.getElementById("progress");
  const progressLabel = document.getElementById("progressLabel");
  const progressFill = document.getElementById("progressFill");
  if (!id || !readLink || !progress || !progressLabel || !progressFill) return;

  const finishedBooks = readJson(FINISHED_BOOKS_KEY, []);
  if (Array.isArray(finishedBooks) && finishedBooks.includes(id)) {
    readLink.textContent = "Read again";
    progress.hidden = false;
    progressLabel.textContent = "Finished";
    progressFill.style.width = "100%";
    return;
  }

  const current = readProgress(id);
  if (!current) return;

  readLink.textContent = "Continue reading";
  if (current.percent >= 1) {
    progress.hidden = false;
    progressLabel.textContent = current.label;
    progressFill.style.width = `${current.percent}%`;
  }
}

// Restore the latest state when returning via the back/forward cache.
window.addEventListener("pageshow", (event) => {
  if (event.persisted) setupProgress();
});

setupCoverFallback();
setupProgress();
