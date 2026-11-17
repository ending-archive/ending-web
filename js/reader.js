import { escapeHtml, paragraphize, parseBook } from "./reader-content.js";
import { createReaderSettings } from "./reader-settings.js";
import { loadFinishedBooks, saveFinishedBooks } from "./index-storage.js";
import {
  buildChapterSpans,
  currentAnchor,
  loadProgress,
  overallPercent,
  saveProgress,
  scrollFraction,
  scrollToAnchor,
} from "./reader-progress.js";
import { createReaderSharing, downloadBlob } from "./reader-sharing.js";

function runReader() {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const params = new URLSearchParams(location.search);
  const bookId = params.get("id");

  const ANNOTATIONS_KEY = "ending:annotations:";
  const MAX_ANNOTATIONS = 100;

  const el = {
    surface: document.getElementById("readerSurface"),
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
    settingsBtn: document.getElementById("settingsBtn"),
    drawerCloseBtn: document.getElementById("drawerCloseBtn"),
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

  let chapters = [];
  let bookMeta = null;
  let libraryBooks = [];
  let libraryLoaded = false;
  let finishedBooks = loadFinishedBooks();
  let chapterIndex = 0;
  let saveTimer = null;
  let loadSeq = 0;
  let suggestedId = null;

  let dirty = false;
  let suppressScrollEvents = false;
  let restorePending = false;
  let annotations = { bookmarks: [] };

  const settingsController = createReaderSettings(el, {
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
  });

  function resolveChapterIndex(key, fallbackIndex) {
    if (typeof key === "string" && key) {
      const exact = chapters.findIndex((chapter) => chapter.key === key);
      if (exact >= 0) return exact;
      const dot = key.lastIndexOf(".");
      if (dot > 0) {
        const slug = key.slice(0, dot);
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
    return ANNOTATIONS_KEY + id;
  }

  function validAnnotationId(value) {
    return typeof value === "string" && /^[\w-]{1,100}$/.test(value);
  }

  function sanitizeBookmark(item) {
    if (
      !item ||
      !validAnnotationId(item.id) ||
      !Number.isInteger(item.chapterIndex) ||
      item.chapterIndex < 0 ||
      !Number.isFinite(item.fraction) ||
      item.fraction < 0 ||
      item.fraction > 1
    ) {
      return null;
    }
    return {
      id: item.id,
      chapterIndex: item.chapterIndex,
      chapterKey:
        typeof item.chapterKey === "string"
          ? item.chapterKey.slice(0, 200)
          : undefined,
      fraction: item.fraction,
      paragraph: Number.isInteger(item.paragraph) ? item.paragraph : null,
      offset:
        Number.isFinite(item.offset) && item.offset >= 0 && item.offset <= 1
          ? item.offset
          : 0,
      excerpt:
        typeof item.excerpt === "string" ? item.excerpt.slice(0, 120) : "",
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : 0,
    };
  }

  function loadAnnotations() {
    try {
      const raw = localStorage.getItem(annotationKey(bookId));
      const saved = raw ? JSON.parse(raw) : {};
      if (!saved || typeof saved !== "object" || Array.isArray(saved))
        return { bookmarks: [] };
      const bookmarks = Array.isArray(saved.bookmarks)
        ? saved.bookmarks
            .map(sanitizeBookmark)
            .filter(Boolean)
            .slice(0, MAX_ANNOTATIONS)
        : [];
      return { bookmarks };
    } catch {
      showToast("Bookmarks couldn't be read from this device.");
      return { bookmarks: [] };
    }
  }

  function saveAnnotations(next) {
    try {
      localStorage.setItem(annotationKey(bookId), JSON.stringify(next));
    } catch {
      showToast("Bookmarks couldn't be stored on this device.");
      return false;
    }
    annotations = next;
    renderNotes();
    return true;
  }

  function updateNotesButtons() {
    const count = annotations.bookmarks.length;
    el.openNotesBtn.textContent = `Bookmarks (${count})`;
    el.exportNotesBtn.disabled = count === 0;
  }

  function renderNotes() {
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
            <button type="button" class="saved-action" data-action="jump-bookmark" data-id="${escapeHtml(item.id)}" ${available ? "" : "disabled"}>Go to</button>
            <button type="button" class="saved-action" data-action="delete-bookmark" data-id="${escapeHtml(item.id)}" aria-label="Remove bookmark">Remove</button>
          </div>
        </article>`;
      })
      .join("");

    el.notesList.innerHTML = `
      <section class="saved-section" aria-labelledby="bookmarksHeading">
        <h3 id="bookmarksHeading">Bookmarks <span>${annotations.bookmarks.length}</span></h3>
        ${bookmarkItems || '<p class="saved-empty">No bookmarks yet.</p>'}
      </section>`;
    updateNotesButtons();
  }

  el.notesList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === "delete-bookmark") {
      saveAnnotations({
        ...annotations,
        bookmarks: annotations.bookmarks.filter((item) => item.id !== id),
      });
      return;
    }
    if (action === "jump-bookmark") {
      const bookmark = annotations.bookmarks.find((item) => item.id === id);
      if (!bookmark) return;
      settingsController.closeNotesDrawer();
      const targetIndex = resolveChapterIndex(
        bookmark.chapterKey,
        bookmark.chapterIndex,
      );
      if (targetIndex < 0) {
        showToast("That chapter is no longer in this book.");
        return;
      }
      loadChapter(targetIndex, false, false);
      setHash(false);
      const seq = loadSeq;
      fontsReady().then(() => {
        if (seq !== loadSeq) return;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (seq !== loadSeq) return;
            const max =
              document.documentElement.scrollHeight - window.innerHeight;
            suppressScrollEvents = true;
            if (
              !(
                Number.isInteger(bookmark.paragraph) && scrollToAnchor(bookmark)
              )
            ) {
              window.scrollTo({
                top: Math.max(0, max) * bookmark.fraction,
                left: 0,
                behavior: "instant",
              });
            }
            requestAnimationFrame(() => {
              suppressScrollEvents = false;
              onScroll();
            });
          }),
        );
      });
    }
  });

  el.exportNotesBtn.addEventListener("click", () => {
    if (!bookMeta || !annotations.bookmarks.length) return;
    const lines = [
      `${bookMeta.title}${bookMeta.author ? ` by ${bookMeta.author}` : ""}`,
      "Bookmarks",
      "",
      "BOOKMARKS",
      ...annotations.bookmarks.map((item) => {
        const resolved = resolveChapterIndex(
          item.chapterKey,
          item.chapterIndex,
        );
        const title = chapters[resolved]?.title || "Chapter";
        return `- ${title} (${Math.round(item.fraction * 100)}% through chapter)`;
      }),
      "",
    ];
    try {
      const safeId = String(bookId).replace(/[^\w-]/g, "-");
      downloadBlob(
        new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }),
        `${safeId}-bookmarks.txt`,
      );
      showToast("Bookmarks exported as a text file.");
    } catch {
      showToast("Unable to export bookmarks.");
    }
  });

  let toastTimer;
  function showToast(message) {
    el.shareStatus.textContent = message;
    el.shareStatus.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.shareStatus.hidden = true;
    }, 3500);
  }

  createReaderSharing({
    bookId,
    getBookMeta: () =>
      bookMeta ?? { id: bookId, title: el.topbarTitle.textContent, author: "" },
    el,
    showToast: showToast,
  });

  // ---------- progress persistence ----------
  let chapterSpans = [];

  function updateProgressUI() {
    if (!chapterSpans.length) return;
    const pct = overallPercent(
      chapterSpans,
      chapterIndex,
      finishedBooks.has(String(bookId)),
    );
    el.progressFill.style.width = pct + "%";
    el.progressPct.textContent = Math.round(pct) + "%";
  }

  function persistProgress(force = false) {
    if (restorePending) return;
    if ((!dirty && !force) || !bookId || !chapterSpans.length) return;
    const anchor = currentAnchor();
    saveProgress(bookId, {
      chapterIndex,
      chapterKey: chapters[chapterIndex]?.key,
      paragraph: anchor ? anchor.paragraph : null,
      offset: anchor ? anchor.offset : 0,
      scrollFraction: scrollFraction(),
      progressPercent: overallPercent(
        chapterSpans,
        chapterIndex,
        finishedBooks.has(String(bookId)),
      ),
      updatedAt: Date.now(),
    });
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
    if (!chapters.length) return;
    if (annotations.bookmarks.length >= MAX_ANNOTATIONS) {
      showToast("You’ve reached the bookmark limit for this book.");
      return;
    }
    const fraction = scrollFraction();
    const anchor = currentAnchor({ allowTop: true });
    const key = chapters[chapterIndex]?.key;
    const existing = annotations.bookmarks.some((item) => {
      const sameChapter = item.chapterKey
        ? item.chapterKey === key
        : item.chapterIndex === chapterIndex;
      if (!sameChapter) return false;
      if (anchor && item.paragraph !== null) {
        return (
          item.paragraph === anchor.paragraph &&
          Math.abs(item.offset - anchor.offset) < 0.25
        );
      }
      return Math.abs(item.fraction - fraction) < 0.012;
    });
    if (existing) {
      showToast("There’s already a bookmark near this spot.");
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
            chapterKey: key,
            fraction,
            paragraph: anchor ? anchor.paragraph : null,
            offset: anchor ? anchor.offset : 0,
            excerpt: anchor ? anchor.excerpt : "",
            createdAt: Date.now(),
          },
        ],
      })
    ) {
      showToast("Bookmark saved.");
    }
  }
  el.bookmarkBtn.addEventListener("click", addBookmark);

  function renderCompletionPanel() {
    const panel = document.getElementById("completionPanel");
    if (!panel) return;
    panel.replaceChildren();

    const heading = document.createElement("h2");
    heading.textContent = finishedBooks.has(String(bookId))
      ? "Book finished"
      : "Reached the end?";
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
          showToast("This change couldn't be saved on this device.");
          return;
        }
        finishedBooks = latest;
        updateProgressUI();
        persistProgress(true);
        renderCompletionPanel();
      });
      panel.append(undoButton);
    }

    if (!finishedBooks.has(String(bookId))) {
      const finishButton = document.createElement("button");
      finishButton.type = "button";
      finishButton.className = "nav-btn completion-btn";
      finishButton.textContent = "Mark as finished";
      finishButton.addEventListener("click", () => {
        const latestFinishedBooks = loadFinishedBooks();
        latestFinishedBooks.add(String(bookId));
        if (!saveFinishedBooks(latestFinishedBooks)) {
          showToast("This book couldn't be marked as finished on this device.");
          return;
        }
        finishedBooks = latestFinishedBooks;
        updateProgressUI();
        persistProgress(true);
        renderCompletionPanel();
      });
      panel.append(finishButton);
      return;
    }

    const nextBook = libraryBooks.filter(
      (book) => !finishedBooks.has(String(book.id)),
    );
    const message = document.createElement("p");
    if (!libraryLoaded) {
      message.textContent =
        "The library couldn't be loaded for a next-read suggestion. Visit the archive to choose another book.";
      panel.append(message);
      return;
    }
    if (nextBook.length === 0) {
      message.textContent = "You've finished every book in the library.";
      panel.append(message);
      return;
    }

    let suggestion = nextBook.find((book) => book.id === suggestedId);
    if (!suggestion) {
      suggestion = nextBook[Math.floor(Math.random() * nextBook.length)];
      suggestedId = suggestion.id;
    }
    message.textContent = "Your next read";
    message.className = "completion-kicker";
    const link = document.createElement("a");
    link.className = "completion-suggestion";
    link.href = `reader.html?id=${encodeURIComponent(suggestion.id)}`;
    link.setAttribute(
      "aria-label",
      `Read ${suggestion.title} by ${suggestion.author}`,
    );

    const cover = document.createElement("img");
    cover.className = "suggestion-cover";
    cover.alt = "";
    cover.loading = "lazy";
    if (suggestion.cover) {
      cover.src = suggestion.cover;
      cover.addEventListener("error", () => (cover.hidden = true), {
        once: true,
      });
    } else {
      cover.hidden = true;
    }

    const details = document.createElement("span");
    details.className = "suggestion-details";
    const title = document.createElement("span");
    title.className = "suggestion-title";
    title.textContent = suggestion.title;
    const author = document.createElement("span");
    author.className = "suggestion-author";
    author.textContent = `by ${suggestion.author}`;

    const action = document.createElement("span");
    action.className = "suggestion-action";
    action.textContent = "Start reading";
    const arrow = document.createElement("span");
    arrow.className = "suggestion-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";

    details.append(title, author, action);
    link.append(cover, details, arrow);
    panel.append(message, link);
  }

  // ---------- rendering ----------
  function renderState(message) {
    el.surface.innerHTML = `<div class="state-box"><span class="dot"></span> ${message}</div>`;
  }

  function renderError(message, retry = false) {
    el.surface.innerHTML = `<div class="state-box">${escapeHtml(message)}<br><br>
        ${retry ? '<button type="button" class="nav-btn" id="retryBtn">Try again</button> ' : ""}
        <a href="index.html" class="nav-btn">Back to the archive</a></div>`;
    document
      .getElementById("retryBtn")
      ?.addEventListener("click", () => location.reload());
  }

  // ---------- chapter history (#chapter-N) so Back steps through chapters ----------
  function chapterHash() {
    return chapters.length > 1 ? `#chapter-${chapterIndex + 1}` : "";
  }

  function setHash(push) {
    const hash = chapterHash();
    if (!hash || location.hash === hash) return;
    try {
      history[push ? "pushState" : "replaceState"](null, "", hash);
    } catch {}
  }

  function hashChapterIndex() {
    const match = location.hash.match(/^#chapter-(\d+)$/);
    if (!match) return -1;
    const index = Number(match[1]) - 1;
    return index >= 0 && index < chapters.length ? index : -1;
  }

  function goToChapter(index) {
    loadChapter(index, false);
    setHash(true);
  }

  window.addEventListener("popstate", () => {
    if (!chapters.length) return;
    const index = hashChapterIndex();
    if (index >= 0 && index !== chapterIndex) loadChapter(index, false);
  });

  function loadChapter(index, restoreScroll, persist = !restoreScroll) {
    const thisLoad = ++loadSeq;
    restorePending = false;
    chapterIndex = Math.min(Math.max(index, 0), chapters.length - 1);
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

    const eyebrow = total > 1 ? `${chapterIndex + 1} / ${total}` : "";
    const forwardBtn = isLast
      ? `<a class="nav-btn" href="index.html">Archive</a>`
      : `<button class="nav-btn" id="nextBtn">Next</button>`;

    el.surface.innerHTML = `
        <div class="reader-page">
          ${eyebrow ? `<div class="chapter-eyebrow">${eyebrow}</div>` : ""}
          <h1 class="chapter-title">${escapeHtml(title)}</h1>
          <div class="chapter-body font-${settingsController.settings.font}">${paragraphize(chapter.text)}</div>
          ${isLast ? '<section class="completion-panel" id="completionPanel" aria-live="polite"></section>' : ""}
          <div class="chapter-nav">
            <button class="nav-btn" id="prevBtn" ${chapterIndex === 0 ? "disabled" : ""}>Prev</button>
            <select class="chapter-select" id="chapterSelect" aria-label="Chapter">${options}</select>
            ${forwardBtn}
          </div>
        </div>`;

    if (isLast) renderCompletionPanel();

    settingsController.applySettings();
    document.getElementById("prevBtn").addEventListener("click", () => {
      goToChapter(chapterIndex - 1);
    });
    const nextBtn = document.getElementById("nextBtn");
    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        goToChapter(chapterIndex + 1);
      });
    }
    document.getElementById("chapterSelect").addEventListener("change", (e) => {
      goToChapter(parseInt(e.target.value, 10));
    });

    const jumpTo = (top, anchor) => {
      suppressScrollEvents = true;
      if (!(anchor && scrollToAnchor(anchor))) {
        window.scrollTo({ top, left: 0, behavior: "instant" });
      }
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          suppressScrollEvents = false;
          if (thisLoad === loadSeq) restorePending = false;
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
        restorePending = true;
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

    updateProgressUI();
    fontsReady().then(() => {
      if (thisLoad === loadSeq) updateProgressUI();
    });
    if (persist) {
      dirty = true;
      persistProgress();
    }
  }

  function onKeydown(event) {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return;
    if (event.target.closest?.("input, textarea, select, [contenteditable]"))
      return;
    if (!chapters.length || settingsController.isAnyDrawerOpen()) return;

    if (event.key === "ArrowLeft" && chapterIndex > 0) {
      goToChapter(chapterIndex - 1);
    } else if (
      event.key === "ArrowRight" &&
      chapterIndex < chapters.length - 1
    ) {
      goToChapter(chapterIndex + 1);
    } else if (event.key === "b" || event.key === "B") {
      addBookmark();
    }
  }

  async function init() {
    if (!bookId) {
      renderError("No book was specified.");
      return;
    }
    if (!/^[\w-]{1,100}$/.test(bookId)) {
      renderError("That book link isn't valid.");
      return;
    }

    try {
      const booksRes = await fetch("books.json", { cache: "no-cache" }).catch(
        () => null,
      );
      if (booksRes && booksRes.ok) {
        const books = await booksRes.json();
        if (Array.isArray(books)) {
          libraryBooks = books.filter(
            (book) => book && typeof book.id === "string",
          );
          libraryLoaded = true;
          bookMeta =
            libraryBooks.find((book) => String(book.id) === String(bookId)) ||
            null;
        }
      }
      const fallbackTitle = bookMeta ? bookMeta.title : `Book ${bookId}`;
      el.topbarTitle.textContent = fallbackTitle;

      if (libraryLoaded && !bookMeta) {
        renderError("This book isn't in the archive.");
        return;
      }

      renderState("Opening the book…");

      const filePath =
        bookMeta && bookMeta.file ? bookMeta.file : `books/${bookId}.txt`;

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

      if (!raw.trim()) {
        renderError(`"${fallbackTitle}" is empty.`);
        return;
      }

      chapters = parseBook(raw, fallbackTitle);
      annotations = loadAnnotations();
      renderNotes();
      el.bookmarkBtn.disabled = false;

      chapterSpans = buildChapterSpans(chapters);

      settingsController.applySettings();

      const saved = loadProgress(bookId);
      const resolvedStart = saved
        ? resolveChapterIndex(saved.chapterKey, saved.chapterIndex)
        : -1;
      const fromHash = hashChapterIndex();
      const useHash = fromHash >= 0 && fromHash !== resolvedStart;
      const startIndex = useHash
        ? fromHash
        : resolvedStart >= 0
          ? resolvedStart
          : 0;
      const restore = !useHash;
      loadChapter(startIndex, restore, !saved || useHash);
      setHash(false);
      if (saved && !saved.chapterKey && Number.isFinite(saved.updatedAt)) {
        saveProgress(bookId, {
          ...saved,
          chapterIndex,
          chapterKey: chapters[chapterIndex]?.key,
        });
      }

      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", updateProgressUI);
      window.addEventListener("pagehide", () => persistProgress());
      window.addEventListener("storage", (event) => {
        if (event.key === "ending:finished-books") {
          finishedBooks = loadFinishedBooks();
          updateProgressUI();
          persistProgress(true);
          renderCompletionPanel();
        }
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") persistProgress();
      });
      document.addEventListener("keydown", onKeydown);

      document.title = `${fallbackTitle} | 3NDING`;
    } catch (err) {
      renderError(`Something went wrong (${err.message}).`);
    }
  }

  init();
}

runReader();
