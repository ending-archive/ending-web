(function () {
  const params = new URLSearchParams(location.search);
  const bookId = params.get("id");

  const SETTINGS_KEY = "ending:settings";
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
  let chapters = []; // [{ title, text }]
  let bookMeta = null;
  let chapterIndex = 0;
  let saveTimer = null;

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

  // =====================================================================
  //  CHAPTER DETECTION
  // =====================================================================
  //
  //  1. EXPLICIT:   --- Chapter Title ---
  //     If a book contains at least one of these, ONLY these are used.
  //     (Own markup always wins, so nothing in the prose can
  //     accidentally split a chapter.)
  //
  //  2. IMPLICIT (only when there are no explicit headings). A line counts
  //     as a heading when it is short (<= 80 chars), has a blank line
  //     before and after it, and matches one of:
  //       - keyword + number:  Chapter 1 / CHAPTER IV / Chapter One /
  //                            Chapter 3: Title / Part Two / Book 2 /
  //                            Kabanata 1 / Capítulo 4 / ...
  //       - special sections:  Prologue, Epilogue, Preface, Foreword,
  //                            Introduction, Afterword, Interlude
  //       - bare numerals:     "12", "12.", "IV", "IV."
  //       - CJK:               第1章 / 第十二話
  //
  //  3. If nothing matches, the whole file is one chapter.
  // ---------------------------------------------------------------------

  const EXPLICIT_RE = /^-{3}\s*(\S.*?)\s*-{3}$/;

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
  const BARE_NUM_RE = new RegExp(
    `^(?:\\d{1,4}|${ROMAN.toUpperCase()})\\.?$`,
    "i",
  );
  const CJK_RE = /^第\s*[0-9一二三四五六七八九十百零〇]+\s*[章話话節节回幕部]/;

  function isImplicitHeading(line) {
    if (!line || line.length > 80) return false;
    return (
      KEYWORD_RE.test(line) ||
      SPECIAL_RE.test(line) ||
      BARE_NUM_RE.test(line) ||
      CJK_RE.test(line) ||
      /\w/.test(line)
    );
  }

  function parseBook(raw, fallbackTitle) {
    const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const lines = text.split("\n");

    // Pass 1: find headings
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

    if (!headings.length) {
      return [{ title: fallbackTitle, text: text.trim() }];
    }

    // Pass 2: slice the text between headings
    const result = [];
    const preamble = lines.slice(0, headings[0].index).join("\n").trim();
    // Keep text before the first heading only if it's real content
    // (a bare title/subtitle block is skipped).
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

    return result;
  }

  // ---------- paragraph rendering ----------
  function blockToHtml(block) {
    const ls = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (ls.length === 1) return `<p>${escapeHtml(ls[0])}</p>`;
    const avg = ls.reduce((n, l) => n + l.length, 0) / ls.length;
    // short lines => poetry / verse: keep the line breaks
    if (avg < 50) return `<p>${ls.map(escapeHtml).join("<br>")}</p>`;
    // long lines => hard-wrapped prose: re-flow
    return `<p>${escapeHtml(ls.join(" "))}</p>`;
  }

  function paragraphize(text) {
    const blocks = text
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean);

    // No blank lines at all, but long lines => one paragraph per line
    if (blocks.length === 1) {
      const ls = blocks[0]
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (ls.length > 1 && ls.some((l) => l.length > 100)) {
        return ls.map((l) => `<p>${escapeHtml(l)}</p>`).join("");
      }
    }
    return blocks.map(blockToHtml).join("");
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
    document.body.classList = "theme-" + settings.theme;
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
  el.settingsBtn.addEventListener("click", () => {
    el.drawer.classList.contains("open") ? closeDrawer() : openDrawer();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.drawer.classList.contains("open"))
      closeDrawer();
  });
  el.backdrop.addEventListener("click", closeDrawer);
  el.drawerCloseBtn.addEventListener("click", closeDrawer);

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

  function scrollFraction() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (max <= 0) return 1;
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
    const { start, span } = chapterSpans[chapterIndex];
    return Math.min(100, Math.max(0, (start + span * scrollFraction()) * 100));
  }

  function updateProgressUI() {
    const pct = overallPercent();
    el.progressFill.style.width = pct + "%";
    el.progressPct.textContent = Math.round(pct) + "%";
  }

  function persistProgress() {
    saveProgress(bookId, {
      chapterIndex,
      scrollFraction: scrollFraction(),
      updatedAt: Date.now(),
    });
  }

  function onScroll() {
    updateProgressUI();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistProgress, 250);
  }

  // ---------- rendering ----------
  function renderState(message) {
    el.surface.innerHTML = `<div class="state-box"><span class="dot"></span> ${message}</div>`;
  }

  function renderError(message) {
    el.surface.innerHTML = `<div class="state-box">${escapeHtml(message)}<br><br>
        <a href="index.html" class="nav-btn">Back to the archive</a></div>`;
  }

  function loadChapter(index, restoreScroll) {
    chapterIndex = Math.min(Math.max(index, 0), chapters.length - 1);
    const chapter = chapters[chapterIndex];
    const total = chapters.length;
    const title = chapter.title || "Chapter " + (chapterIndex + 1);

    const options = chapters
      .map(
        (c, i) =>
          `<option value="${i}" ${i === chapterIndex ? "selected" : ""}>${escapeHtml(c.title || "Chapter " + (i + 1))}</option>`,
      )
      .join("");

    el.surface.innerHTML = `
        <div class="reader-page">
          <div class="chapter-eyebrow">Page ${chapterIndex + 1} of ${total}</div>
          <h1 class="chapter-title">${escapeHtml(title)}</h1>
          <div class="chapter-body font-${settings.font}">${paragraphize(chapter.text)}</div>
          <div class="chapter-nav">
            <button class="nav-btn" id="prevBtn" ${chapterIndex === 0 ? "disabled" : ""}>Prev</button>
            <select class="chapter-select" id="chapterSelect">${options}</select>
            <button class="nav-btn" id="nextBtn" ${chapterIndex === total - 1 ? "disabled" : ""}>Next</button>
          </div>
        </div>`;

    applySettings();

    document.getElementById("prevBtn").addEventListener("click", () => {
      loadChapter(chapterIndex - 1, false);
    });
    document.getElementById("nextBtn").addEventListener("click", () => {
      loadChapter(chapterIndex + 1, false);
    });
    document.getElementById("chapterSelect").addEventListener("change", (e) => {
      loadChapter(parseInt(e.target.value, 10), false);
    });

    const jumpTo = (top) =>
      window.scrollTo({ top, left: 0, behavior: "instant" });

    // in loadChapter:
    if (restoreScroll) {
      const saved = loadProgress(bookId);
      if (saved && saved.chapterIndex === chapterIndex) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        jumpTo(max * (saved.scrollFraction || 0));
      }
    } else {
      jumpTo(0);
    }

    updateProgressUI();
    persistProgress();
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
        bookMeta = books.find((b) => String(b.id) === String(bookId)) || null;
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

      buildSpans();

      applySettings();

      const saved = loadProgress(bookId);
      const startIndex = Number.isInteger(saved?.chapterIndex)
        ? saved.chapterIndex
        : 0;
      loadChapter(startIndex, true);

      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("beforeunload", persistProgress);
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
