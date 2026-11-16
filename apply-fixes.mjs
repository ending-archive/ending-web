#!/usr/bin/env node
// Applies fixes 1.1-1.12 to the 3NDING repo.
// Usage (from repo root):  node apply-fixes.mjs [--dry-run]
// All-or-nothing: if any anchor is missing/ambiguous or any result fails a
// syntax check, NOTHING is written. Commit first so `git diff` shows the result.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dry = process.argv.includes("--dry-run");
const self = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
const spec = self.slice(self.lastIndexOf("\n__SPEC__\n") + 10);

// ---- parse spec ----
const edits = [];
let file = null, cur = null, part = null;
for (const line of spec.split("\n")) {
  if (cur) {
    if (line === ">>>") { edits.push(cur); cur = null; continue; }
    if (line === "---" && cur.kind === "BETWEEN" && part === "a") { part = "b"; continue; }
    if (line === "===") { part = "to"; continue; }
    cur[part].push(line);
    continue;
  }
  if (line.startsWith("@@ ")) { file = line.slice(3).trim(); continue; }
  const m = line.match(/^<<<(FIND\*?|BETWEEN|APPEND)(?: (.*))?$/);
  if (m) { cur = { file, kind: m[1], label: m[2] || "", a: [], b: [], to: [] }; part = "a"; }
}

// ---- matching helpers (whitespace-insensitive) ----
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const flex = (s) => s.trim().split(/\s+/).map(esc).join("\\s*");

function apply(text, e) {
  if (e.kind === "APPEND") {
    const marker = e.a.join("\n").trim();
    if (text.includes(marker)) throw new Error("already applied");
    return text.replace(/\s*$/, "\n") + "\n" + e.to.join("\n") + "\n";
  }
  const src = e.kind === "BETWEEN"
    ? flex(e.a.join("\n")) + "[\\s\\S]*?" + flex(e.b.join("\n"))
    : flex(e.a.join("\n"));
  const re = new RegExp(src, "g");
  const n = (text.match(re) || []).length;
  if (n === 0) throw new Error("anchor not found");
  if (n > 1 && e.kind !== "FIND*") throw new Error(`anchor is ambiguous (${n} matches)`);
  const to = e.to.join("\n");
  return text.replace(re, () => to);
}

// ---- run ----
const files = [...new Set(edits.map((e) => e.file))];
const out = new Map();
const errors = [];
for (const f of files) {
  if (!fs.existsSync(f)) { errors.push(`${f}: file not found (run from the repo root)`); continue; }
  const raw = fs.readFileSync(f, "utf8");
  const crlf = raw.includes("\r\n");
  let text = raw.replace(/\r\n/g, "\n");
  for (const e of edits.filter((x) => x.file === f)) {
    try { text = apply(text, e); }
    catch (err) { errors.push(`${f} [${e.label}]: ${err.message}`); }
  }
  out.set(f, crlf ? text.replace(/\n/g, "\r\n") : text);
}
if (errors.length) {
  console.error("Nothing written. Problems:\n - " + errors.join("\n - "));
  process.exit(1);
}

// syntax check every JS result as an ES module
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fix-"));
for (const [f, text] of out) {
  if (!f.endsWith(".js")) continue;
  const t = path.join(tmp, path.basename(f, ".js") + ".mjs");
  fs.writeFileSync(t, text);
  try { execFileSync(process.execPath, ["--check", t], { stdio: "pipe" }); }
  catch (err) {
    console.error(`Syntax error in patched ${f}; nothing written.\n` + err.stderr);
    process.exit(1);
  }
}

for (const [f, text] of out) {
  if (!dry) fs.writeFileSync(f, text);
  console.log(`${dry ? "[dry-run] would patch" : "patched"} ${f}`);
}
console.log(dry ? "Dry run OK." : "Done. Review with `git diff`.");

/*
__SPEC__
@@ js/reader-content.js
<<<FIND 1.3 rename raw parser
export function parseBook(raw, fallbackTitle) {
===
function parseBookRaw(raw, fallbackTitle) {
>>>
<<<FIND 1.4 keep short preamble for explicit headings
if (preamble.length > 300) {
===
if (preamble && (explicit.length > 0 || preamble.length > 300)) {
>>>
<<<APPEND 1.3 stable chapter keys
export function chapterKey(
===
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

// "slug.hash" - survives re-ordering and most edits; index is only a fallback.
export function chapterKey(title, text) {
  const slug = String(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "chapter"}.${hashString(String(text).slice(0, 200))}`;
}

export function parseBook(raw, fallbackTitle) {
  const seen = new Map();
  return parseBookRaw(raw, fallbackTitle).map((chapter) => {
    const base = chapterKey(chapter.title, chapter.text);
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return { ...chapter, key: count > 1 ? `${base}-${count}` : base };
  });
}
>>>
@@ js/reader-progress.js
<<<APPEND 1.2 paragraph anchors
export function currentAnchor(
===
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
>>>
@@ js/reader-settings.js
<<<FIND 1.2 settings hooks: signature
export function createReaderSettings(el, { onOpenNotes } = {}) {
===
export function createReaderSettings(
  el,
  { onOpenNotes, onBeforeChange, onAfterChange } = {},
) {
>>>
<<<BETWEEN 1.2 settings hooks: updateSetting
function updateSetting(key, value) {
---
applySettings();
  }
===
function updateSetting(key, value) {
    const token = onBeforeChange?.();
    settings[key] = value;
    saveSettings();
    applySettings();
    onAfterChange?.(token);
  }
>>>
<<<BETWEEN 1.2 settings hooks: reset
el.resetBtn.addEventListener("click", () => {
---
applySettings();
  });
===
el.resetBtn.addEventListener("click", () => {
    const token = onBeforeChange?.();
    settings = { ...DEFAULT_SETTINGS };
    saveSettings();
    applySettings();
    onAfterChange?.(token);
  });
>>>
@@ reader.html
<<<FIND 1.12 apply size/alignment before first paint
document.body.className = "theme-" + s.theme;
===
document.body.className = "theme-" + s.theme;
        const root = document.documentElement.style;
        const size = Number(s.size);
        if (Number.isFinite(size))
          root.setProperty(
            "--font-size",
            Math.min(26, Math.max(14, size)) + "px",
          );
        if (s.align === "justify") root.setProperty("--text-align", "justify");
>>>
@@ css/reader.css
<<<APPEND 1.2 bookmark excerpt style
.saved-item-excerpt {
===
.saved-item-excerpt {
  margin-top: 0.35rem;
  color: var(--text-light);
  font-size: 0.78rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
>>>
@@ js/index-cards.js
<<<FIND 1.5 ignore <1% progress on Continue shelf
if (!Number.isFinite(percent)) return;
===
if (!Number.isFinite(percent)) return;
      if (percent < 1) return;
>>>
@@ js/index.js
<<<FIND 1.9 keep tooltip in sync
btn.classList.toggle("active", active);
===
btn.classList.toggle("active", active);
      btn.title = active ? "Remove from favorites" : "Add to favorites";
>>>
<<<FIND* 1.10 stop clearing the search box when toggling filters
if (activeFilter !== "all" && searchInput.value.trim()) {
  searchInput.value = "";
}
===
>>>
@@ js/reader.js
<<<FIND 1.2 imports (currentAnchor)
buildChapterSpans,
===
buildChapterSpans,
  currentAnchor,
>>>
<<<FIND 1.2 imports (scrollToAnchor)
scrollFraction,
} from "./reader-progress.js";
===
scrollFraction,
  scrollToAnchor,
} from "./reader-progress.js";
>>>
<<<FIND 1.1 manual scroll restoration
function runReader() {
===
function runReader() {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
>>>
<<<FIND 1.1 load sequence counter
let saveTimer = null;
===
let saveTimer = null;
  let loadSeq = 0;
>>>
<<<FIND 1.2 settings hooks keep reading position
onOpenNotes: () => renderNotes(),
===
onOpenNotes: () => renderNotes(),
    onBeforeChange: () => (chapters.length ? currentAnchor() : null),
    onAfterChange: (anchor) => {
      if (!anchor) return;
      suppressScrollEvents = true;
      scrollToAnchor(anchor);
      fontsReady().then(() => {
        scrollToAnchor(anchor);
        requestAnimationFrame(() => {
          suppressScrollEvents = false;
          dirty = true;
          updateProgressUI();
          persistProgress();
        });
      });
    },
>>>
<<<FIND 1.2/1.3 helpers
function annotationKey(id) {
===
function resolveChapterIndex(key, fallbackIndex) {
    if (typeof key === "string" && key) {
      const exact = chapters.findIndex((chapter) => chapter.key === key);
      if (exact >= 0) return exact;
      const slug = key.slice(0, key.lastIndexOf("."));
      if (slug) {
        const bySlug = chapters.findIndex((chapter) =>
          chapter.key.startsWith(slug + "."),
        );
        if (bySlug >= 0) return bySlug;
      }
    }
    return Number.isInteger(fallbackIndex) &&
      fallbackIndex >= 0 &&
      fallbackIndex < chapters.length
      ? fallbackIndex
      : -1;
  }

  // Resolves once the fonts used for the text are actually loaded.
  function fontsReady() {
    const family = { serif: "Literata", sans: "Work Sans", mono: "Space Mono" }[
      settingsController.settings.font
    ];
    return Promise.all([
      document.fonts.load(`1em "${family}"`),
      document.fonts.load(`600 1em "Fraunces"`),
      document.fonts.ready,
    ]).catch(() => {});
  }

  function annotationKey(id) {
>>>
<<<FIND 1.3 keep bookmarks whose chapter index is out of range
item.chapterIndex < chapters.length &&
===
>>>
<<<BETWEEN 1.2/1.3 bookmark list shows excerpt + unavailable state
const bookmarkItems = annotations.bookmarks
---
.join("");
===
const bookmarkItems = annotations.bookmarks
      .map((item) => {
        const index = resolveChapterIndex(item.chapterKey, item.chapterIndex);
        const available = index >= 0;
        const title = available
          ? chapters[index].title || `Chapter ${index + 1}`
          : "Chapter unavailable";
        const excerpt = item.excerpt
          ? `<div class="saved-item-excerpt">“${escapeHtml(item.excerpt)}…”</div>`
          : "";
        return `<article class="saved-item">
          <div class="saved-item-label">${escapeHtml(title)} · ${Math.round(item.fraction * 100)}%</div>
          ${excerpt}
          <div class="saved-item-actions">
            <button type="button" class="saved-action" data-action="jump-bookmark" data-id="${item.id}" ${available ? "" : "disabled"}>Go to</button>
            <button type="button" class="saved-action" data-action="delete-bookmark" data-id="${item.id}" aria-label="Remove bookmark">Remove</button>
          </div>
        </article>`;
      })
      .join("");
>>>
<<<FIND 1.3 export uses resolved chapter
const title = chapters[item.chapterIndex]?.title || "Chapter";
===
const resolved = resolveChapterIndex(item.chapterKey, item.chapterIndex);
        const title = chapters[resolved]?.title || "Chapter";
>>>
<<<FIND 1.3 bookmark jump resolves chapter
loadChapter(bookmark.chapterIndex, false, false);
===
const targetIndex = resolveChapterIndex(
        bookmark.chapterKey,
        bookmark.chapterIndex,
      );
      if (targetIndex < 0) {
        showShareToast("That chapter is no longer in this book.");
        return;
      }
      loadChapter(targetIndex, false, false);
>>>
<<<FIND 1.2 bookmark jump waits for real font load
document.fonts.ready.then(() => {
        requestAnimationFrame(() =>
===
fontsReady().then(() => {
        requestAnimationFrame(() =>
>>>
<<<FIND 1.2 bookmark jump prefers paragraph anchor
window.scrollTo({
              top: Math.max(0, max) * bookmark.fraction,
              left: 0,
              behavior: "instant",
            });
===
if (!(Number.isInteger(bookmark.paragraph) && scrollToAnchor(bookmark))) {
              window.scrollTo({
                top: Math.max(0, max) * bookmark.fraction,
                left: 0,
                behavior: "instant",
              });
            }
>>>
<<<FIND 1.2/1.3 progress stores anchor + chapter key
saveProgress(bookId, {
      chapterIndex,
      scrollFraction: scrollFraction(),
===
const anchor = currentAnchor();
    saveProgress(bookId, {
      chapterIndex,
      chapterKey: chapters[chapterIndex]?.key,
      paragraph: anchor ? anchor.paragraph : null,
      offset: anchor ? anchor.offset : 0,
      scrollFraction: scrollFraction(),
>>>
<<<FIND 1.2 bookmark captures anchor
const fraction = scrollFraction();
===
const fraction = scrollFraction();
    const anchor = currentAnchor();
>>>
<<<FIND 1.2/1.3 bookmark stores anchor, key, excerpt
id: makeAnnotationId(),
            chapterIndex,
            fraction,
===
id: makeAnnotationId(),
            chapterIndex,
            chapterKey: chapters[chapterIndex]?.key,
            fraction,
            paragraph: anchor ? anchor.paragraph : null,
            offset: anchor ? anchor.offset : 0,
            excerpt: anchor ? anchor.excerpt : "",
>>>
<<<FIND 1.6 undo finished
panel.append(heading);
===
panel.append(heading);

    if (finishedBooks.has(String(bookId))) {
      const undoButton = document.createElement("button");
      undoButton.type = "button";
      undoButton.className = "nav-btn completion-btn";
      undoButton.textContent = "Mark as unfinished";
      undoButton.addEventListener("click", () => {
        const latest = loadFinishedBooks();
        latest.delete(String(bookId));
        if (!saveFinishedBooks(latest)) {
          showShareToast("This change couldn't be saved on this device.");
          return;
        }
        finishedBooks = latest;
        renderCompletionPanel();
      });
      panel.append(undoButton);
    }
>>>
<<<BETWEEN 1.8 error screen with optional retry
function renderError(message) {
---
Back to the archive</a></div>`;
  }
===
function renderError(message, retry = false) {
    el.surface.innerHTML = `<div class="state-box">${escapeHtml(message)}<br><br>
        ${retry ? '<button type="button" class="nav-btn" id="retryBtn">Try again</button> ' : ""}
        <a href="index.html" class="nav-btn">Back to the archive</a></div>`;
    document
      .getElementById("retryBtn")
      ?.addEventListener("click", () => location.reload());
  }
>>>
<<<FIND 1.11 neutral eyebrow (compute)
const forwardBtn = isLast
===
const eyebrow = total > 1 ? `${chapterIndex + 1} / ${total}` : "";
    const forwardBtn = isLast
>>>
<<<FIND 1.11 neutral eyebrow (render)
<div class="chapter-eyebrow">Chapter ${chapterIndex + 1} of ${total}</div>
===
${eyebrow ? `<div class="chapter-eyebrow">${eyebrow}</div>` : ""}
>>>
<<<FIND 1.1 load token
chapterIndex = Math.min(Math.max(index, 0), chapters.length - 1);
===
const thisLoad = ++loadSeq;
    chapterIndex = Math.min(Math.max(index, 0), chapters.length - 1);
>>>
<<<BETWEEN 1.1/1.2 restore with anchor, refresh progress UI
const jumpTo = (top) => {
---
jumpTo(0);
    }
===
const jumpTo = (top, anchor) => {
      suppressScrollEvents = true;
      if (!(anchor && scrollToAnchor(anchor))) {
        window.scrollTo({ top, left: 0, behavior: "instant" });
      }
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          suppressScrollEvents = false;
          updateProgressUI();
        });
      });
    };

    if (restoreScroll) {
      const saved = loadProgress(bookId);
      const savedIndex = saved
        ? resolveChapterIndex(saved.chapterKey, saved.chapterIndex)
        : -1;
      if (saved && savedIndex === chapterIndex) {
        fontsReady().then(() => {
          if (thisLoad !== loadSeq) return;
          const max =
            document.documentElement.scrollHeight - window.innerHeight;
          jumpTo(
            Math.max(0, max) * (saved.scrollFraction || 0),
            Number.isInteger(saved.paragraph) ? saved : null,
          );
        });
      }
    } else {
      jumpTo(0);
    }
>>>
<<<FIND 1.7 validate id
renderError("No book was specified.");
      return;
    }
===
renderError("No book was specified.");
      return;
    }
    if (!/^[\w-]{1,100}$/.test(bookId)) {
      renderError("That book link isn't valid.");
      return;
    }
>>>
<<<FIND 1.7 unknown id when catalog loaded
renderState("Opening the book…");
===
if (libraryLoaded && !bookMeta) {
        renderError("This book isn't in the archive.");
        return;
      }

      renderState("Opening the book…");
>>>
<<<BETWEEN 1.8 distinguish 404 from other failures
let raw;
---
couldn't be found.`,
        );
        return;
      }
===
let raw;
      try {
        const res = await fetch(filePath);
        if (res.status === 404) {
          renderError(`"${fallbackTitle}" isn't on the archive yet.`);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        raw = await res.text();
      } catch (err) {
        renderError(
          `"${fallbackTitle}" couldn't be loaded. Check your connection and try again.`,
          true,
        );
        return;
      }
>>>
<<<BETWEEN 1.3 resolve saved chapter on startup
const startIndex =
---
: 0;
===
const resolvedStart = saved
        ? resolveChapterIndex(saved.chapterKey, saved.chapterIndex)
        : -1;
      const startIndex = resolvedStart >= 0 ? resolvedStart : 0;
>>>
<<<BETWEEN 1.5 don't write progress just for opening a book
const savedProgress =
---
updatedAt: Date.now(),
      });
===
// Migrate legacy records only; never bump updatedAt just for opening.
      if (saved && !saved.chapterKey && Number.isFinite(saved.updatedAt)) {
        saveProgress(bookId, {
          ...saved,
          chapterIndex,
          chapterKey: chapters[chapterIndex]?.key,
        });
      }
>>>
*/
