(function () {
  const params = new URLSearchParams(location.search);
  const bookId = params.get("id");

  const SETTINGS_KEY = "ending:settings";
  const READING_DAYS_KEY = "ending:reading-days";
  const ANNOTATIONS_KEY = "ending:annotations:";
  const MAX_ANNOTATIONS = 100;
  const MAX_HIGHLIGHT_LENGTH = 1200;
  const DEFAULT_SETTINGS = {
    font: "serif",
    size: 17,
    align: "left",
    theme: "paper",
  };
  const SIZE_MIN = 14,
    SIZE_MAX = 26,
    SIZE_STEP = 1;

  const el = {
    surface: document.getElementById("readerSurface"),
    stateBox: document.getElementById("stateBox"),
    topbarTitle: document.getElementById("topbarTitle"),
    progressFill: document.getElementById("progressFill"),
    progressPct: document.getElementById("progressPct"),
    shareBtn: document.getElementById("shareBtn"),
    bookmarkBtn: document.getElementById("bookmarkBtn"),
    shareStatus: document.getElementById("shareStatus"),
    notesDrawer: document.getElementById("notesDrawer"),
    notesCloseBtn: document.getElementById("notesCloseBtn"),
    notesList: document.getElementById("notesList"),
    exportNotesBtn: document.getElementById("exportNotesBtn"),
    openNotesBtn: document.getElementById("openNotesBtn"),
    highlightSelectionBtn: document.getElementById("highlightSelectionBtn"),
    settingsBtn: document.getElementById("settingsBtn"),
    drawerCloseBtn: document.getElementById("drawerCloseBtn"),
    backLink: document.getElementById("backLink"),
    drawer: document.getElementById("drawer"),
    backdrop: document.getElementById("drawerBackdrop"),
    fontRow: document.getElementById("fontRow"),
    alignRow: document.getElementById("alignRow"),
    themeRow: document.getElementById("themeRow"),
    sizeValue: document.getElementById("sizeValue"),
    sizeUp: document.getElementById("sizeUp"),
    sizeDown: document.getElementById("sizeDown"),
    resetBtn: document.getElementById("resetBtn"),
  };

  let settings = loadSettings();
  let chapters = [];
  let bookMeta = null;
  let catalogBooks = [];
  let chapterIndex = 0;
  let saveTimer = null;

  let dirty = false;
  let finished = false;
  let suppressScrollEvents = false;
  let annotations = { bookmarks: [], highlights: [] };

  function escapeHtml(str) {
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

  const EXPLICIT_RE = /^-{3}\s*([^\s-].*?)\s*-{3}$/;

  const WORD_NUM =
    "(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|hundred";
  const ROMAN =
    "(?=[ivxlcdm])m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})";
  const NUM = `(?:\\d+|${WORD_NUM}|${ROMAN})`;
  const KEYWORDS =
    "chapter|chap|part|book|section|volume|vol|act|kabanata|cap[ií]tulo|chapitre|kapitel|capitolo";

  const KEYWORD_RE = new RegExp(
    `^(?:${KEYWORDS})\\.?\\s+${NUM}\\b\\s*(?:[.:\\-\\u2013\\u2014)]\\s*.*)?$`,
    "i",
  );
  const SPECIAL_RE =
    /^(?:prologue|epilogue|preface|foreword|introduction|afterword|interlude|author'?s note)\b.{0,60}$/i;
  const BARE_NUM_RE = new RegExp(`^(?:\\d{1,4}|${ROMAN.toUpperCase()})\\.?$`);
  const CJK_RE = /^第\s*[0-9一二三四五六七八九十百零〇]+\s*[章話话節节回幕部]/;

  function isImplicitHeading(line) {
    if (!line || line.length > 80) return false;
    return (
      KEYWORD_RE.test(line) ||
      SPECIAL_RE.test(line) ||
      BARE_NUM_RE.test(line) ||
      CJK_RE.test(line)
    );
  }

  function parseBook(raw, fallbackTitle) {
    const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const lines = text.split("\n");
    const wholeBook = [{ title: fallbackTitle, text: text.trim() }];

    const explicit = [];
    const implicit = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const m = line.match(EXPLICIT_RE);
      if (m) {
        explicit.push({ index: i, title: m[1].trim() });
        continue;
      }

      const prevBlank = i === 0 || lines[i - 1].trim() === "";
      const nextBlank = i === lines.length - 1 || lines[i + 1].trim() === "";
      if (prevBlank && nextBlank && isImplicitHeading(line)) {
        implicit.push({ index: i, title: line });
      }
    }

    const headings = explicit.length ? explicit : implicit;

    if (!headings.length) return wholeBook;

    const result = [];
    const preamble = lines.slice(0, headings[0].index).join("\n").trim();
    if (preamble.length > 300) {
      result.push({ title: "Beginning", text: preamble });
    }

    headings.forEach((h, i) => {
      const end =
        i + 1 < headings.length ? headings[i + 1].index : lines.length;
      const body = lines
        .slice(h.index + 1, end)
        .join("\n")
        .trim();
      result.push({ title: h.title, text: body });
    });

    const nonEmpty = result.filter((c) => c.text);
    return nonEmpty.length ? nonEmpty : wholeBook;
  }

  // ---------- paragraph rendering ----------
  function blockToHtml(block) {
    const ls = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (ls.length === 1) return `<p>${escapeHtml(ls[0])}</p>`;
    const avg = ls.reduce((n, l) => n + l.length, 0) / ls.length;
    if (avg < 50) return `<p>${ls.map(escapeHtml).join("<br>")}</p>`;
    return `<p>${escapeHtml(ls.join(" "))}</p>`;
  }

  function paragraphize(text) {
    const blocks = text
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean);

    let paragraphIndex = 0;
    if (blocks.length === 1) {
      const ls = blocks[0]
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (ls.length > 1 && ls.some((l) => l.length > 100)) {
        return ls
          .map(
            (line) =>
              `<p data-paragraph="${paragraphIndex++}">${escapeHtml(line)}</p>`,
          )
          .join("");
      }
    }
    return blocks
      .map((block) => {
        const html = blockToHtml(block).replace(
          /^<p>/,
          `<p data-paragraph="${paragraphIndex}">`,
        );
        paragraphIndex += 1;
        return html;
      })
      .join("");
  }

  // ---------- settings persistence ----------
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      const out = { ...DEFAULT_SETTINGS };
      if (["serif", "sans", "mono"].includes(s.font)) out.font = s.font;
      if (["left", "justify"].includes(s.align)) out.align = s.align;
      if (["paper", "sepia", "dark"].includes(s.theme)) out.theme = s.theme;
      const n = Number(s.size);
      if (Number.isFinite(n))
        out.size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, n));
      return out;
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {}
  }

  function applySettings() {
    document.body.className = "theme-" + settings.theme;
    document.documentElement.style.setProperty(
      "--font-size",
      settings.size + "px",
    );
    document.documentElement.style.setProperty("--text-align", settings.align);

    const body = document.querySelector(".chapter-body");
    if (body) {
      body.classList.remove("font-serif", "font-sans", "font-mono");
      body.classList.add("font-" + settings.font);
    }

    [el.fontRow, el.alignRow, el.themeRow].forEach((row) => {
      row.querySelectorAll(".opt-btn").forEach((btn) => {
        btn.classList.toggle(
          "active",
          btn.dataset.value === settings[row.dataset.key],
        );
      });
    });
    el.sizeValue.textContent = settings.size;
  }

  function updateSetting(key, value) {
    settings[key] = value;
    saveSettings();
    applySettings();
  }

  el.fontRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".opt-btn");
    if (!btn) return;
    updateSetting("font", btn.dataset.value);
  });
  el.alignRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".opt-btn");
    if (!btn) return;
    updateSetting("align", btn.dataset.value);
  });
  el.themeRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".opt-btn");
    if (!btn) return;
    updateSetting("theme", btn.dataset.value);
  });
  el.sizeUp.addEventListener("click", () => {
    updateSetting("size", Math.min(SIZE_MAX, settings.size + SIZE_STEP));
  });
  el.sizeDown.addEventListener("click", () => {
    updateSetting("size", Math.max(SIZE_MIN, settings.size - SIZE_STEP));
  });
  el.resetBtn.addEventListener("click", () => {
    settings = { ...DEFAULT_SETTINGS };
    saveSettings();
    applySettings();
  });

  function openDrawer() {
    el.drawer.classList.add("open");
    el.backdrop.classList.add("visible");
    el.settingsBtn.classList.add("open");
    el.settingsBtn.setAttribute("aria-expanded", "true");
  }

  function closeDrawer() {
    el.drawer.classList.remove("open");
    el.backdrop.classList.remove("visible");
    el.settingsBtn.classList.remove("open");
    el.settingsBtn.setAttribute("aria-expanded", "false");
  }
  function openNotesDrawer() {
    closeDrawer();
    renderNotes();
    el.notesDrawer.classList.add("open");
    el.notesDrawer.setAttribute("aria-hidden", "false");
    el.backdrop.classList.add("visible");
  }
  function closeNotesDrawer() {
    el.notesDrawer.classList.remove("open");
    el.notesDrawer.setAttribute("aria-hidden", "true");
    if (!el.drawer.classList.contains("open"))
      el.backdrop.classList.remove("visible");
  }
  el.settingsBtn.addEventListener("click", () => {
    closeNotesDrawer();
    el.drawer.classList.contains("open") ? closeDrawer() : openDrawer();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeDrawer();
      closeNotesDrawer();
      hideHighlightAction();
    }
  });
  el.backdrop.addEventListener("click", () => {
    closeDrawer();
    closeNotesDrawer();
  });
  el.drawerCloseBtn.addEventListener("click", closeDrawer);
  el.notesCloseBtn.addEventListener("click", closeNotesDrawer);
  el.openNotesBtn.addEventListener("click", openNotesDrawer);

  function annotationKey(id) {
    return ANNOTATIONS_KEY + id;
  }

  function validAnnotationId(value) {
    return typeof value === "string" && /^[\w-]{1,100}$/.test(value);
  }

  function loadAnnotations() {
    try {
      const raw = localStorage.getItem(annotationKey(bookId));
      const saved = raw ? JSON.parse(raw) : {};
      if (!saved || typeof saved !== "object" || Array.isArray(saved))
        return { bookmarks: [], highlights: [] };
      const bookmarks = Array.isArray(saved.bookmarks)
        ? saved.bookmarks
            .filter(
              (item) =>
                item &&
                validAnnotationId(item.id) &&
                Number.isInteger(item.chapterIndex) &&
                item.chapterIndex >= 0 &&
                item.chapterIndex < chapters.length &&
                Number.isFinite(item.fraction) &&
                item.fraction >= 0 &&
                item.fraction <= 1,
            )
            .slice(0, MAX_ANNOTATIONS)
        : [];
      const highlights = Array.isArray(saved.highlights)
        ? saved.highlights
            .filter(
              (item) =>
                item &&
                validAnnotationId(item.id) &&
                Number.isInteger(item.chapterIndex) &&
                item.chapterIndex >= 0 &&
                item.chapterIndex < chapters.length &&
                Number.isInteger(item.paragraphIndex) &&
                item.paragraphIndex >= 0 &&
                Number.isInteger(item.start) &&
                item.start >= 0 &&
                Number.isInteger(item.end) &&
                item.end > item.start &&
                item.end - item.start <= MAX_HIGHLIGHT_LENGTH &&
                typeof item.text === "string" &&
                item.text.length > 0 &&
                item.text.length <= MAX_HIGHLIGHT_LENGTH,
            )
            .slice(0, MAX_ANNOTATIONS)
        : [];
      highlights.sort(
        (a, b) =>
          a.chapterIndex - b.chapterIndex ||
          a.paragraphIndex - b.paragraphIndex ||
          a.start - b.start,
      );
      const nonOverlappingHighlights = [];
      highlights.forEach((item) => {
        const overlaps = nonOverlappingHighlights.some(
          (existing) =>
            existing.chapterIndex === item.chapterIndex &&
            existing.paragraphIndex === item.paragraphIndex &&
            item.start < existing.end &&
            item.end > existing.start,
        );
        if (!overlaps) nonOverlappingHighlights.push(item);
      });
      return { bookmarks, highlights: nonOverlappingHighlights };
    } catch {
      showShareToast("Saved passages couldn't be read from this device.");
      return { bookmarks: [], highlights: [] };
    }
  }

  function saveAnnotations(next) {
    try {
      localStorage.setItem(annotationKey(bookId), JSON.stringify(next));
    } catch {
      showShareToast("Saved passages couldn't be stored on this device.");
      return false;
    }
    annotations = next;
    renderNotes();
    updateNotesButtons();
    return true;
  }

  function updateNotesButtons() {
    const count = annotations.bookmarks.length + annotations.highlights.length;
    el.openNotesBtn.textContent = `Passages (${count})`;
    el.openNotesBtn.style.textAlign = "center";
    el.surface.querySelectorAll("[data-open-notes]").forEach((button) => {
      button.textContent = `Passages (${count})`;
    });
    el.exportNotesBtn.disabled = count === 0;
  }

  function renderNotes() {
    const bookmarkItems = annotations.bookmarks
      .map((item) => {
        const title = chapters[item.chapterIndex]?.title || "Chapter";
        return `<article class="saved-item">
          <div class="saved-item-label">${escapeHtml(title)} · ${Math.round(item.fraction * 100)}%</div>
          <div class="saved-item-actions">
            <button type="button" class="saved-action" data-action="jump-bookmark" data-id="${item.id}">Go to</button>
            <button type="button" class="saved-action" data-action="delete-bookmark" data-id="${item.id}" aria-label="Remove bookmark">Remove</button>
          </div>
        </article>`;
      })
      .join("");
    const highlightItems = annotations.highlights
      .map((item) => {
        const title = chapters[item.chapterIndex]?.title || "Chapter";
        return `<article class="saved-item">
          <blockquote class="saved-quote">${escapeHtml(item.text)}</blockquote>
          <div class="saved-item-label">${escapeHtml(title)}</div>
          <div class="saved-item-actions">
            <button type="button" class="saved-action" data-action="jump-highlight" data-id="${item.id}">Go to</button>
            <button type="button" class="saved-action" data-action="share-highlight" data-id="${item.id}">Quote image</button>
            <button type="button" class="saved-action" data-action="delete-highlight" data-id="${item.id}" aria-label="Remove highlight">Remove</button>
          </div>
        </article>`;
      })
      .join("");

    el.notesList.innerHTML = `
      <section class="saved-section" aria-labelledby="bookmarksHeading">
        <h3 id="bookmarksHeading">Bookmarks <span>${annotations.bookmarks.length}</span></h3>
        ${bookmarkItems || '<p class="saved-empty">No bookmarks yet.</p>'}
      </section>
      <section class="saved-section" aria-labelledby="highlightsHeading">
        <h3 id="highlightsHeading">Highlights <span>${annotations.highlights.length}</span></h3>
        ${highlightItems || '<p class="saved-empty">Select a passage while reading to highlight it.</p>'}
      </section>`;
    updateNotesButtons();
  }

  function rebuildParagraphHighlights(pIndex) {
    const p = el.surface.querySelector(
      `.chapter-body [data-paragraph="${pIndex}"]`,
    );
    if (!p) return;
    p.querySelectorAll("mark.text-highlight").forEach((m) =>
      m.replaceWith(...m.childNodes),
    );
    p.normalize();
    annotations.highlights
      .filter(
        (h) => h.chapterIndex === chapterIndex && h.paragraphIndex === pIndex,
      )
      .sort((a, b) => b.start - a.start)
      .forEach((h) => {
        const r = createTextRange(p, h.start, h.end);
        if (r) wrapHighlight(r);
      });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  el.notesList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === "delete-bookmark" || action === "delete-highlight") {
      const key = action === "delete-bookmark" ? "bookmarks" : "highlights";
      const removed = annotations[key].find((i) => i.id === id);
      saveAnnotations({
        ...annotations,
        [key]: annotations[key].filter((i) => i.id !== id),
      });
      if (key === "highlights" && removed?.chapterIndex === chapterIndex)
        rebuildParagraphHighlights(removed.paragraphIndex);
      return;
    }
    if (action === "jump-bookmark") {
      const bookmark = annotations.bookmarks.find((item) => item.id === id);
      if (!bookmark) return;
      closeNotesDrawer();
      loadChapter(bookmark.chapterIndex, false, false);
      document.fonts.ready.then(() => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const max =
              document.documentElement.scrollHeight - window.innerHeight;
            suppressScrollEvents = true;
            window.scrollTo({
              top: Math.max(0, max) * bookmark.fraction,
              left: 0,
              behavior: "instant",
            });
            requestAnimationFrame(() => {
              suppressScrollEvents = false;
              onScroll();
            });
          }),
        );
      });
      return;
    }
    if (action === "jump-highlight") {
      const highlight = annotations.highlights.find((item) => item.id === id);
      if (!highlight) return;
      closeNotesDrawer();
      if (chapterIndex !== highlight.chapterIndex)
        loadChapter(highlight.chapterIndex, false, false);
      requestAnimationFrame(() => {
        const paragraph = el.surface.querySelector(
          `[data-paragraph="${highlight.paragraphIndex}"]`,
        );
        if (paragraph) {
          paragraph.scrollIntoView({ block: "center", behavior: "instant" });
          suppressScrollEvents = false;
          onScroll();
        }
      });
      return;
    }
    if (action === "share-highlight") {
      const highlight = annotations.highlights.find((item) => item.id === id);
      if (!highlight) return;
      button.disabled = true;
      try {
        await shareQuoteImage(
          highlight.text,
          `${bookId}-highlight.png`,
          `A line from ${bookMeta?.title || "this book"}`,
        );
      } finally {
        button.disabled = false;
      }
    }
  });

  el.exportNotesBtn.addEventListener("click", () => {
    if (
      !bookMeta ||
      (!annotations.bookmarks.length && !annotations.highlights.length)
    )
      return;
    const lines = [
      `${bookMeta.title}${bookMeta.author ? ` by ${bookMeta.author}` : ""}`,
      "Saved passages",
      "",
      "BOOKMARKS",
      ...annotations.bookmarks.map((item) => {
        const title = chapters[item.chapterIndex]?.title || "Chapter";
        return `- ${title} (${Math.round(item.fraction * 100)}% through chapter)`;
      }),
      "",
      "HIGHLIGHTS",
      ...annotations.highlights.map((item) => {
        const title = chapters[item.chapterIndex]?.title || "Chapter";
        return `- ${title}\n  “${item.text.replace(/\s+/g, " ").trim()}”`;
      }),
      "",
    ];
    try {
      const safeId = String(bookId).replace(/[^\w-]/g, "-");
      downloadBlob(
        new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }),
        `${safeId}-saved-passages.txt`,
      );
      showShareToast("Saved passages exported as a text file.");
    } catch {
      showShareToast("Unable to export saved passages.");
    }
  });

  let shareToastTimer;
  function showShareToast(message) {
    el.shareStatus.textContent = message;
    el.shareStatus.hidden = false;
    clearTimeout(shareToastTimer);
    shareToastTimer = setTimeout(() => {
      el.shareStatus.hidden = true;
    }, 3500);
  }

  async function copyShareLink(url) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        return;
      } catch {
        // Continue to the selection-based fallback when clipboard access is denied.
      }
    }

    const input = document.createElement("textarea");
    input.value = url;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    let copied;
    try {
      input.select();
      copied = document.execCommand("copy");
    } finally {
      input.remove();
    }
    if (!copied) throw new Error("Copying the link is not supported.");
  }

  el.shareBtn.addEventListener("click", async () => {
    if (!bookMeta || !bookId) return;
    el.shareStatus.textContent = "";
    el.shareStatus.hidden = true;

    const url = new URL("reader.html", location.href);
    url.searchParams.set("id", bookId);
    const shareData = {
      title: bookMeta.title,
      text: `Read "${bookMeta.title}" by ${bookMeta.author} on 3NDING.`,
      url: url.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        showShareToast("Book shared.");
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }

    try {
      await copyShareLink(url.href);
      showShareToast("Book link copied to clipboard.");
    } catch {
      showShareToast("Unable to copy the book link.");
    }
  });

  // ---------- progress persistence ----------
  function progressKey(id) {
    return "ending:progress:" + id;
  }

  function loadProgress(id) {
    try {
      const raw = localStorage.getItem(progressKey(id));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveProgress(id, data) {
    try {
      localStorage.setItem(progressKey(id), JSON.stringify(data));
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

  function recordReadingDay() {
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

  function scrollFraction() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (max <= 0) return 0;
    return Math.min(1, Math.max(0, window.scrollY / max));
  }

  let chapterSpans = [];
  function buildSpans() {
    const total = chapters.reduce((n, c) => n + c.text.length, 0) || 1;
    let acc = 0;
    chapterSpans = chapters.map((c) => {
      const s = { start: acc / total, span: c.text.length / total };
      acc += c.text.length;
      return s;
    });
  }

  function overallPercent() {
    if (finished) return 100;
    const { start, span } = chapterSpans[chapterIndex];
    return Math.min(100, Math.max(0, (start + span * scrollFraction()) * 100));
  }

  function updateProgressUI() {
    const pct = overallPercent();
    el.progressFill.style.width = pct + "%";
    el.progressPct.textContent = Math.round(pct) + "%";
  }

  function persistProgress() {
    if (!dirty || !bookId || !chapterSpans.length) return;
    const prev = loadProgress(bookId);
    saveProgress(bookId, {
      chapterIndex,
      scrollFraction: finished ? 1 : scrollFraction(),
      progressPercent: finished ? 100 : overallPercent(),
      finished: finished || prev?.finished === true,
      updatedAt: Date.now(),
    });
    recordReadingDay();
  }

  let ticking = false;
  function onScroll() {
    if (suppressScrollEvents) return;
    dirty = true;
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        updateProgressUI();
      });
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistProgress, 250);
  }

  function makeAnnotationId() {
    return globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function addBookmark() {
    if (annotations.bookmarks.length >= MAX_ANNOTATIONS) {
      showShareToast("You’ve reached the bookmark limit for this book.");
      return;
    }
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const fraction =
      max <= 0 ? 0 : Math.min(1, Math.max(0, window.scrollY / max));
    const existing = annotations.bookmarks.some(
      (item) =>
        item.chapterIndex === chapterIndex &&
        Math.abs(item.fraction - fraction) < 0.012,
    );
    if (existing) {
      showShareToast("There’s already a bookmark near this spot.");
      return;
    }
    if (
      saveAnnotations({
        ...annotations,
        bookmarks: [
          ...annotations.bookmarks,
          {
            id: makeAnnotationId(),
            chapterIndex,
            fraction,
            createdAt: Date.now(),
          },
        ],
      })
    ) {
      showShareToast("Bookmark saved.");
    }
  }
  el.bookmarkBtn.addEventListener("click", addBookmark);

  function hideHighlightAction() {
    el.highlightSelectionBtn.hidden = true;
  }

  function updateHighlightAction() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      hideHighlightAction();
      return;
    }
    const range = selection.getRangeAt(0);
    const startElement =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement;
    const endElement =
      range.endContainer.nodeType === Node.ELEMENT_NODE
        ? range.endContainer
        : range.endContainer.parentElement;
    const startParagraph = startElement?.closest(
      ".chapter-body [data-paragraph]",
    );
    const endParagraph = endElement?.closest(".chapter-body [data-paragraph]");
    const text = selection.toString().trim();
    if (
      !startParagraph ||
      startParagraph !== endParagraph ||
      !text ||
      text.length > MAX_HIGHLIGHT_LENGTH ||
      !el.surface.contains(startParagraph)
    ) {
      hideHighlightAction();
      return;
    }
    const fragment = range.cloneContents();
    if (fragment.querySelector?.("br, .text-highlight")) {
      hideHighlightAction();
      return;
    }
    const rect = range.getBoundingClientRect();
    const button = el.highlightSelectionBtn;
    button.hidden = false;
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - button.offsetWidth / 2),
      window.innerWidth - button.offsetWidth - 8,
    );
    button.style.left = `${left}px`;
    button.style.top = `${Math.max(8, rect.top - button.offsetHeight - 10)}px`;
  }

  let selectionTimer;
  document.addEventListener("selectionchange", () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(updateHighlightAction, 40);
  });
  window.addEventListener("scroll", hideHighlightAction, { passive: true });
  window.addEventListener("resize", hideHighlightAction);
  function preserveHighlightSelection(event) {
    event.preventDefault();
  }
  el.highlightSelectionBtn.addEventListener(
    "pointerdown",
    preserveHighlightSelection,
  );
  el.highlightSelectionBtn.addEventListener(
    "mousedown",
    preserveHighlightSelection,
  );
  el.highlightSelectionBtn.addEventListener("click", () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const startElement =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement;
    const paragraph = startElement?.closest(".chapter-body [data-paragraph]");
    if (!paragraph || !el.surface.contains(paragraph)) return;
    const startPrefix = document.createRange();
    startPrefix.selectNodeContents(paragraph);
    startPrefix.setEnd(range.startContainer, range.startOffset);
    const start = startPrefix.toString().length;
    const endPrefix = document.createRange();
    endPrefix.selectNodeContents(paragraph);
    endPrefix.setEnd(range.endContainer, range.endOffset);
    const end = endPrefix.toString().length;
    const text = range.toString();
    const paragraphIndex = Number(paragraph.dataset.paragraph);
    const overlaps = annotations.highlights.some(
      (item) =>
        item.chapterIndex === chapterIndex &&
        item.paragraphIndex === paragraphIndex &&
        start < item.end &&
        end > item.start,
    );
    if (overlaps) {
      hideHighlightAction();
      selection.removeAllRanges();
      showShareToast("That passage overlaps an existing highlight.");
      return;
    }
    if (
      end <= start ||
      end - start !== text.length ||
      paragraph.textContent.slice(start, end) !== text
    ) {
      hideHighlightAction();
      showShareToast("That selection can’t be highlighted accurately.");
      return;
    }
    if (
      annotations.highlights.length >= MAX_ANNOTATIONS ||
      !text.trim() ||
      text.length > MAX_HIGHLIGHT_LENGTH
    ) {
      hideHighlightAction();
      showShareToast(
        annotations.highlights.length >= MAX_ANNOTATIONS
          ? "You’ve reached the highlight limit for this book."
          : "Select a shorter passage to highlight.",
      );
      return;
    }
    const highlight = {
      id: makeAnnotationId(),
      chapterIndex,
      paragraphIndex,
      start,
      end,
      text,
      createdAt: Date.now(),
    };
    const highlightRange = createTextRange(paragraph, start, end);
    if (!highlightRange) {
      showShareToast("That selection can’t be highlighted accurately.");
      return;
    }
    if (
      !saveAnnotations({
        ...annotations,
        highlights: [...annotations.highlights, highlight],
      })
    )
      return;
    wrapHighlight(highlightRange);
    hideHighlightAction();
    selection.removeAllRanges();
    showShareToast("Passage highlighted.");
  });

  function createTextRange(paragraph, start, end) {
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    let offset = 0;
    while ((node = walker.nextNode())) {
      nodes.push({
        node,
        start: offset,
        end: offset + node.textContent.length,
      });
      offset += node.textContent.length;
    }
    if (start < 0 || end <= start || end > offset) return null;
    const startNode = nodes.find((item) => start < item.end);
    const endNode = nodes.find((item) => end > item.start && end <= item.end);
    if (!startNode || !endNode) return null;
    const range = document.createRange();
    range.setStart(startNode.node, start - startNode.start);
    range.setEnd(endNode.node, end - endNode.start);
    return range;
  }

  function wrapHighlight(range) {
    const mark = document.createElement("mark");
    mark.className = "text-highlight";
    mark.append(range.extractContents());
    range.insertNode(mark);
  }

  function applyChapterHighlights() {
    const body = el.surface.querySelector(".chapter-body");
    if (!body) return;
    const paragraphHighlights = annotations.highlights
      .filter((item) => item.chapterIndex === chapterIndex)
      .sort((a, b) => b.start - a.start);
    paragraphHighlights.forEach((item) => {
      const paragraph = body.querySelector(
        `[data-paragraph="${item.paragraphIndex}"]`,
      );
      if (!paragraph) return;
      const range = createTextRange(paragraph, item.start, item.end);
      if (
        !range ||
        range.toString().replace(/\s+/g, " ").trim() !==
          item.text.replace(/\s+/g, " ").trim()
      )
        return;
      wrapHighlight(range);
    });
  }

  // ---------- rendering ----------
  function renderState(message) {
    el.surface.innerHTML = `<div class="state-box"><span class="dot"></span> ${message}</div>`;
  }

  function renderError(message) {
    el.surface.innerHTML = `<div class="state-box">${escapeHtml(message)}<br><br>
        <a href="index.html" class="nav-btn">Back to the archive</a></div>`;
  }

  function finishBook() {
    finished = true;
    dirty = true;
    clearTimeout(saveTimer);
    persistProgress();
    updateProgressUI();
    renderEnd();
  }

  function reactionKey(id) {
    return "ending:reaction:" + id;
  }

  function loadReaction() {
    try {
      const reaction = localStorage.getItem(reactionKey(bookId));
      return ["moved", "hopeful", "unsettled", "thoughtful"].includes(reaction)
        ? reaction
        : "";
    } catch {
      return "";
    }
  }

  function endingQuote() {
    const lastChapter = chapters[chapters.length - 1];
    const paragraphs = lastChapter
      ? lastChapter.text
          .split(/\n\s*\n/)
          .map((part) => part.trim())
          .filter(Boolean)
      : [];
    const text = (paragraphs[paragraphs.length - 1] || "").replace(/\s+/g, " ");
    if (text.length <= 190) return text;
    const clipped = text.slice(0, 187);
    const lastSpace = clipped.lastIndexOf(" ");
    return clipped.slice(0, lastSpace > 120 ? lastSpace : 187).trimEnd() + "…";
  }

  function isFinishedBook(book) {
    const progress = loadProgress(book.id);
    return (
      progress?.finished === true ||
      (Number.isFinite(Number(progress?.progressPercent)) &&
        Number(progress.progressPercent) >= 99)
    );
  }

  function nextReadBook() {
    const currentIndex = catalogBooks.findIndex(
      (book) => String(book.id) === String(bookId),
    );
    if (currentIndex < 0 || catalogBooks.length < 2) return null;
    for (let offset = 1; offset < catalogBooks.length; offset++) {
      const book = catalogBooks[(currentIndex + offset) % catalogBooks.length];
      if (!isFinishedBook(book)) return book;
    }
    return null;
  }

  function renderEnd() {
    const bookTitle = bookMeta ? bookMeta.title : "";
    const bookAuthor = bookMeta ? bookMeta.author : "";
    const quote = endingQuote();
    const nextBook = nextReadBook();
    const selectedReaction = loadReaction();
    const nextHref = nextBook
      ? `reader.html?id=${encodeURIComponent(nextBook.id)}`
      : "index.html";
    el.surface.innerHTML = `
        <main class="ending-page">
          <div class="chapter-eyebrow">The end</div>
          <h1 class="ending-title">How did it end for you?</h1>
          <p class="ending-bookline">${escapeHtml(bookTitle)}${bookAuthor ? ` <span>by ${escapeHtml(bookAuthor)}</span>` : ""}</p>

          <section class="reaction-section" aria-labelledby="reactionHeading">
            <h2 class="ending-section-title" id="reactionHeading">Leave a feeling with this story</h2>
            <div class="reaction-options" role="group" aria-label="Your reaction to this book">
              <button type="button" class="reaction-btn" data-reaction="moved" aria-pressed="${selectedReaction === "moved"}"><span aria-hidden="true">♡</span> Moved</button>
              <button type="button" class="reaction-btn" data-reaction="hopeful" aria-pressed="${selectedReaction === "hopeful"}"><span aria-hidden="true">✦</span> Hopeful</button>
              <button type="button" class="reaction-btn" data-reaction="unsettled" aria-pressed="${selectedReaction === "unsettled"}"><span aria-hidden="true">◌</span> Unsettled</button>
              <button type="button" class="reaction-btn" data-reaction="thoughtful" aria-pressed="${selectedReaction === "thoughtful"}"><span aria-hidden="true">…</span> Thoughtful</button>
            </div>
          </section>

          <div class="ending-cards">
            <section class="ending-card next-read" aria-labelledby="nextReadHeading">
              <div class="chapter-eyebrow">Keep wandering</div>
              <h2 class="ending-section-title" id="nextReadHeading">Next read</h2>
              ${
                nextBook
                  ? `<a class="next-read-link" href="${nextHref}">
                      <img class="next-read-cover" src="${escapeHtml(nextBook.cover || "")}" alt="" loading="lazy" />
                      <span class="next-read-copy">
                        <span class="next-read-title">${escapeHtml(nextBook.title)}</span>
                        <span class="next-read-author">${escapeHtml(nextBook.author || "")}</span>
                        <span class="next-read-action">Open this story <span aria-hidden="true">→</span></span>
                      </span>
                    </a>`
                  : `<a class="next-read-fallback" href="index.html">Find another story in the archive <span aria-hidden="true">→</span></a>`
              }
            </section>

            <section class="ending-card quote-section" aria-labelledby="quoteHeading">
              <div class="chapter-eyebrow">A line to take with you</div>
              <h2 class="ending-section-title" id="quoteHeading">Keep this moment</h2>
              <div class="quote-card" id="quoteCard">
                <span class="quote-mark" aria-hidden="true">“</span>
                <blockquote>${escapeHtml(quote)}</blockquote>
                <div class="quote-attribution">${escapeHtml(bookTitle)}${bookAuthor ? ` · ${escapeHtml(bookAuthor)}` : ""}</div>
                <div class="quote-wordmark">3NDING</div>
              </div>
              <button type="button" class="quote-share-btn" id="shareQuoteBtn">Share as image <span aria-hidden="true">↗</span></button>
            </section>
          </div>

          <div class="ending-actions">
            <button type="button" class="nav-btn" data-open-notes>Passages (${annotations.bookmarks.length + annotations.highlights.length})</button>
            <a href="index.html" class="nav-btn">Archive</a>
          </div>
        </main>`;
    applySettings();

    const cover = el.surface.querySelector(".next-read-cover");
    if (cover) {
      cover.addEventListener("error", () => cover.remove());
    }

    el.surface.querySelectorAll(".reaction-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const reaction = button.dataset.reaction;
        try {
          localStorage.setItem(reactionKey(bookId), reaction);
          el.surface.querySelectorAll(".reaction-btn").forEach((item) => {
            item.setAttribute("aria-pressed", String(item === button));
          });
        } catch {
          showShareToast("Your reaction couldn't be saved on this device.");
        }
      });
    });

    document.getElementById("shareQuoteBtn").addEventListener("click", () => {
      shareQuoteImage(
        quote,
        `${bookId}-ending.png`,
        `A line from ${bookTitle}`,
      );
    });
    el.surface
      .querySelector("[data-open-notes]")
      .addEventListener("click", openNotesDrawer);

    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }

  async function shareQuoteImage(quote, filename, title) {
    try {
      const blob = await createQuoteCard(quote);
      const file =
        typeof File !== "undefined"
          ? new File([blob], filename, { type: "image/png" })
          : null;
      if (file && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title,
            text: bookMeta?.author
              ? `${bookMeta.title} — ${bookMeta.author}`
              : bookMeta?.title || "",
          });
          showShareToast("Quote image shared.");
          return;
        } catch (error) {
          if (error.name === "AbortError") return;
        }
      }

      downloadBlob(blob, filename);
      showShareToast("Quote image downloaded.");
    } catch {
      showShareToast("Unable to create the quote image.");
    }
  }

  async function createQuoteCard(quote) {
    await Promise.all([
      document.fonts.load("54px Literata"),
      document.fonts.load("24px 'Space Mono'"),
      document.fonts.load("30px 'Work Sans'"),
    ]);
    await document.fonts.ready;
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");

    context.font = "54px Literata, Georgia, serif";
    const lines = [];
    let line = "";
    const maxWidth = 976;
    const words = `“${String(quote).replace(/\s+/g, " ").trim()}”`.split(/\s+/);
    words.forEach((word) => {
      let candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth) {
        line = candidate;
        return;
      }
      if (line) lines.push(line);
      line = "";
      for (const character of word) {
        candidate = line + character;
        if (line && context.measureText(candidate).width > maxWidth) {
          lines.push(line);
          line = character;
        } else {
          line = candidate;
        }
      }
    });
    if (line) lines.push(line);
    const lineHeight = 82;
    const quoteHeight = lines.length * lineHeight;
    canvas.height = Math.max(1500, 360 + quoteHeight + 360);
    context.fillStyle = "#171b21";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#d4ac57";
    context.fillRect(112, 112, 72, 4);
    context.fillStyle = "#d4ac57";
    context.font = "24px 'Space Mono', monospace";
    context.fillText("3NDING  /  A LINE TO KEEP", 112, 170);

    context.fillStyle = "#f2e9d3";
    context.font = "54px Literata, Georgia, serif";
    context.textAlign = "center";
    let y = Math.max(360, (canvas.height - quoteHeight) / 2);
    lines.forEach((quoteLine) => {
      context.fillText(quoteLine, canvas.width / 2, y, maxWidth);
      y += lineHeight;
    });

    context.fillStyle = "#b8923f";
    context.textAlign = "left";
    const footerY = canvas.height - 260;
    context.fillRect(112, footerY, 976, 1);
    context.fillStyle = "#ece4d1";
    context.font = "30px 'Work Sans', sans-serif";
    context.fillText(bookMeta?.title || "", 112, footerY + 70, 976);
    context.fillStyle = "#9aa2ad";
    context.font = "24px 'Work Sans', sans-serif";
    context.fillText(bookMeta?.author || "", 112, footerY + 115, 976);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The quote card image could not be encoded."));
      }, "image/png");
    });
  }

  function loadChapter(index, restoreScroll, persist = !restoreScroll) {
    chapterIndex = Math.min(Math.max(index, 0), chapters.length - 1);
    finished = false;
    const chapter = chapters[chapterIndex];
    const total = chapters.length;
    const isLast = chapterIndex === total - 1;
    const title = chapter.title || "Chapter " + (chapterIndex + 1);

    const options = chapters
      .map(
        (c, i) =>
          `<option value="${i}" ${i === chapterIndex ? "selected" : ""}>${escapeHtml(c.title || "Chapter " + (i + 1))}</option>`,
      )
      .join("");

    const forwardBtn = isLast
      ? `<button class="nav-btn" id="finishBtn">Finish</button>`
      : `<button class="nav-btn" id="nextBtn">Next</button>`;

    el.surface.innerHTML = `
        <div class="reader-page">
          <div class="chapter-eyebrow">Chapter ${chapterIndex + 1} of ${total}</div>
          <h1 class="chapter-title">${escapeHtml(title)}</h1>
          <div class="chapter-body font-${settings.font}">${paragraphize(chapter.text)}</div>
          <div class="chapter-nav">
            <button class="nav-btn" id="prevBtn" ${chapterIndex === 0 ? "disabled" : ""}>Prev</button>
            <select class="chapter-select" id="chapterSelect">${options}</select>
            ${forwardBtn}
          </div>
        </div>`;

    applySettings();
    applyChapterHighlights();
    document.getElementById("prevBtn").addEventListener("click", () => {
      loadChapter(chapterIndex - 1, false);
    });
    const nextBtn = document.getElementById("nextBtn");
    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        loadChapter(chapterIndex + 1, false);
      });
    }
    const finishBtn = document.getElementById("finishBtn");
    if (finishBtn) finishBtn.addEventListener("click", finishBook);
    document.getElementById("chapterSelect").addEventListener("change", (e) => {
      loadChapter(parseInt(e.target.value, 10), false);
    });

    const jumpTo = (top) => {
      suppressScrollEvents = true;
      window.scrollTo({ top, left: 0, behavior: "instant" });
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          suppressScrollEvents = false;
        });
      });
    };

    if (restoreScroll) {
      const saved = loadProgress(bookId);
      if (saved && saved.chapterIndex === chapterIndex) {
        document.fonts.ready.then(() => {
          const max =
            document.documentElement.scrollHeight - window.innerHeight;
          jumpTo(Math.max(0, max) * (saved.scrollFraction || 0));
        });
      }
    } else {
      jumpTo(0);
    }

    updateProgressUI();
    if (persist) {
      dirty = true;
      persistProgress();
    }
  }

  async function init() {
    if (!bookId) {
      renderError("No book was specified.");
      return;
    }

    try {
      const booksRes = await fetch("books.json", { cache: "no-store" }).catch(
        () => null,
      );
      if (booksRes && booksRes.ok) {
        const books = await booksRes.json();
        catalogBooks = books
          .map((book, index) => {
            const addedAt =
              typeof book.addedAt === "string" ? Date.parse(book.addedAt) : NaN;
            return { book, index, addedAt };
          })
          .sort((a, b) => {
            if (!Number.isFinite(a.addedAt)) {
              return Number.isFinite(b.addedAt) ? 1 : a.index - b.index;
            }
            if (!Number.isFinite(b.addedAt)) return -1;
            return b.addedAt - a.addedAt || a.index - b.index;
          })
          .map(({ book }) => book);
        bookMeta =
          catalogBooks.find((b) => String(b.id) === String(bookId)) || null;
      }
      const fallbackTitle = bookMeta ? bookMeta.title : `Book ${bookId}`;
      el.topbarTitle.textContent = fallbackTitle;

      renderState("Opening the book…");

      const filePath =
        bookMeta && bookMeta.file ? bookMeta.file : `books/${bookId}.txt`;

      let raw;
      try {
        const res = await fetch(filePath);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        raw = await res.text();
      } catch (err) {
        renderError(
          `"${fallbackTitle}" isn't on the archive yet — ${filePath} couldn't be found.`,
        );
        return;
      }

      if (!raw.trim()) {
        renderError(`"${fallbackTitle}" is empty.`);
        return;
      }

      chapters = parseBook(raw, fallbackTitle);
      annotations = loadAnnotations();
      renderNotes();
      el.bookmarkBtn.disabled = false;

      buildSpans();

      applySettings();

      const saved = loadProgress(bookId);
      const wasFinished =
        saved?.finished === true || (saved?.progressPercent ?? 0) >= 99;
      const startIndex =
        !wasFinished && Number.isInteger(saved?.chapterIndex)
          ? saved.chapterIndex
          : 0;
      loadChapter(startIndex, !wasFinished, false);

      setTimeout(() => {
        if (document.visibilityState === "visible") recordReadingDay();
      }, 5000);

      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("pagehide", persistProgress);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") persistProgress();
      });

      document.title = `${fallbackTitle} | 3NDING`;
    } catch (err) {
      renderError(`Something went wrong (${err.message}).`);
    }
  }

  applySettings();
  init();
})();
