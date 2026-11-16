import { escapeHtml, paragraphize, parseBook } from "./reader-content.js";
import { createReaderSettings } from "./reader-settings.js";
import { loadFinishedBooks, saveFinishedBooks } from "./index-storage.js";
import {
  buildChapterSpans,
  loadProgress,
  overallPercent,
  saveProgress,
  scrollFraction,
} from "./reader-progress.js";
import { createReaderSharing, downloadBlob } from "./reader-sharing.js";

function runReader() {
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

  let dirty = false;
  let suppressScrollEvents = false;
  let annotations = { bookmarks: [] };

  const settingsController = createReaderSettings(el, {
    onOpenNotes: () => renderNotes(),
  });

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
        return { bookmarks: [] };
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
      return { bookmarks };
    } catch {
      showShareToast("Bookmarks couldn't be read from this device.");
      return { bookmarks: [] };
    }
  }

  function saveAnnotations(next) {
    try {
      localStorage.setItem(annotationKey(bookId), JSON.stringify(next));
    } catch {
      showShareToast("Bookmarks couldn't be stored on this device.");
      return false;
    }
    annotations = next;
    renderNotes();
    return true;
  }

  function updateNotesButtons() {
    const count = annotations.bookmarks.length;
    el.openNotesBtn.textContent = `Bookmarks (${count})`;
    el.openNotesBtn.style.textAlign = "center";
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
  });

  el.exportNotesBtn.addEventListener("click", () => {
    if (!bookMeta || !annotations.bookmarks.length) return;
    const lines = [
      `${bookMeta.title}${bookMeta.author ? ` by ${bookMeta.author}` : ""}`,
      "Bookmarks",
      "",
      "BOOKMARKS",
      ...annotations.bookmarks.map((item) => {
        const title = chapters[item.chapterIndex]?.title || "Chapter";
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
      showShareToast("Bookmarks exported as a text file.");
    } catch {
      showShareToast("Unable to export bookmarks.");
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

  createReaderSharing({
    bookId,
    getBookMeta: () => bookMeta,
    el,
    showToast: showShareToast,
  });

  // ---------- progress persistence ----------
  let chapterSpans = [];

  function updateProgressUI() {
    const pct = overallPercent(chapterSpans, chapterIndex);
    el.progressFill.style.width = pct + "%";
    el.progressPct.textContent = Math.round(pct) + "%";
  }

  function persistProgress() {
    if (!dirty || !bookId || !chapterSpans.length) return;
    saveProgress(bookId, {
      chapterIndex,
      scrollFraction: scrollFraction(),
      progressPercent: overallPercent(chapterSpans, chapterIndex),
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
    if (annotations.bookmarks.length >= MAX_ANNOTATIONS) {
      showShareToast("You’ve reached the bookmark limit for this book.");
      return;
    }
    const fraction = scrollFraction();
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

  function renderCompletionPanel() {
    const panel = document.getElementById("completionPanel");
    if (!panel) return;
    panel.replaceChildren();

    const heading = document.createElement("h2");
    heading.textContent = finishedBooks.has(String(bookId))
      ? "Book finished"
      : "Reached the end?";
    panel.append(heading);

    if (!finishedBooks.has(String(bookId))) {
      const finishButton = document.createElement("button");
      finishButton.type = "button";
      finishButton.className = "nav-btn completion-btn";
      finishButton.textContent = "Mark as finished";
      finishButton.addEventListener("click", () => {
        const latestFinishedBooks = loadFinishedBooks();
        latestFinishedBooks.add(String(bookId));
        if (!saveFinishedBooks(latestFinishedBooks)) {
          showShareToast("This book couldn't be marked as finished on this device.");
          return;
        }
        finishedBooks = latestFinishedBooks;
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

    const suggestion = nextBook[Math.floor(Math.random() * nextBook.length)];
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
    cover.src = suggestion.cover;
    cover.alt = "";
    cover.loading = "lazy";

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

  function renderError(message) {
    el.surface.innerHTML = `<div class="state-box">${escapeHtml(message)}<br><br>
        <a href="index.html" class="nav-btn">Back to the archive</a></div>`;
  }

  function loadChapter(index, restoreScroll, persist = !restoreScroll) {
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

    const forwardBtn = isLast
      ? `<a class="nav-btn" href="index.html">Archive</a>`
      : `<button class="nav-btn" id="nextBtn">Next</button>`;

    el.surface.innerHTML = `
        <div class="reader-page">
          <div class="chapter-eyebrow">Chapter ${chapterIndex + 1} of ${total}</div>
          <h1 class="chapter-title">${escapeHtml(title)}</h1>
          <div class="chapter-body font-${settingsController.settings.font}">${paragraphize(chapter.text)}</div>
          ${isLast ? '<section class="completion-panel" id="completionPanel" aria-live="polite"></section>' : ""}
          <div class="chapter-nav">
            <button class="nav-btn" id="prevBtn" ${chapterIndex === 0 ? "disabled" : ""}>Prev</button>
            <select class="chapter-select" id="chapterSelect">${options}</select>
            ${forwardBtn}
          </div>
        </div>`;

    if (isLast) renderCompletionPanel();

    settingsController.applySettings();
    document.getElementById("prevBtn").addEventListener("click", () => {
      loadChapter(chapterIndex - 1, false);
    });
    const nextBtn = document.getElementById("nextBtn");
    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        loadChapter(chapterIndex + 1, false);
      });
    }
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
        if (Array.isArray(books)) {
          libraryBooks = books;
          libraryLoaded = true;
          bookMeta =
            books.find((book) => String(book.id) === String(bookId)) || null;
        }
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

      chapterSpans = buildChapterSpans(chapters);

      settingsController.applySettings();

      const saved = loadProgress(bookId);
      const startIndex = Number.isInteger(saved?.chapterIndex)
        ? saved.chapterIndex
        : 0;
      loadChapter(startIndex, true, false);
      const savedProgress =
        saved && typeof saved === "object" && !Array.isArray(saved)
          ? saved
          : {};
      const hasSavedPosition =
        saved?.chapterIndex === chapterIndex &&
        Number.isFinite(saved?.scrollFraction);
      saveProgress(bookId, {
        ...savedProgress,
        chapterIndex,
        scrollFraction: hasSavedPosition ? saved.scrollFraction : 0,
        progressPercent: hasSavedPosition ? saved.progressPercent : 0,
        updatedAt: Date.now(),
      });

      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("pagehide", persistProgress);
      window.addEventListener("storage", (event) => {
        if (event.key === "ending:finished-books") {
          finishedBooks = loadFinishedBooks();
          renderCompletionPanel();
        }
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") persistProgress();
      });

      document.title = `${fallbackTitle} | 3NDING`;
    } catch (err) {
      renderError(`Something went wrong (${err.message}).`);
    }
  }

  init();
}

runReader();
