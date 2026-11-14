import { escapeHtml, paragraphize, parseBook } from "./reader-content.js";
import { createReaderSettings } from "./reader-settings.js";
import {
  buildChapterSpans,
  loadProgress,
  overallPercent,
  recordReadingDay,
  saveProgress,
  scrollFraction,
} from "./reader-progress.js";
import { createReaderSharing, downloadBlob } from "./reader-sharing.js";

function runReader() {
  const params = new URLSearchParams(location.search);
  const bookId = params.get("id");

  const ANNOTATIONS_KEY = "ending:annotations:";
  const MAX_ANNOTATIONS = 100;
  const MAX_HIGHLIGHT_LENGTH = 1200;

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
    highlightSelectionBtn: document.getElementById("highlightSelectionBtn"),
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
  let catalogBooks = [];
  let chapterIndex = 0;
  let saveTimer = null;

  let dirty = false;
  let finished = false;
  let suppressScrollEvents = false;
  let annotations = { bookmarks: [], highlights: [] };

  const settingsController = createReaderSettings(el, {
    onEscape: () => hideHighlightAction(),
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
    if (action === "jump-highlight") {
      const highlight = annotations.highlights.find((item) => item.id === id);
      if (!highlight) return;
      settingsController.closeNotesDrawer();
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

  const { shareQuoteImage } = createReaderSharing({
    bookId,
    getBookMeta: () => bookMeta,
    el,
    showToast: showShareToast,
  });

  // ---------- progress persistence ----------
  let chapterSpans = [];

  function updateProgressUI() {
    const pct = overallPercent(chapterSpans, chapterIndex, finished);
    el.progressFill.style.width = pct + "%";
    el.progressPct.textContent = Math.round(pct) + "%";
  }

  function persistProgress() {
    if (!dirty || !bookId || !chapterSpans.length) return;
    const prev = loadProgress(bookId);
    saveProgress(bookId, {
      chapterIndex,
      scrollFraction: finished ? 1 : scrollFraction(),
      progressPercent: overallPercent(chapterSpans, chapterIndex, finished),
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
    settingsController.applySettings();

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
      .addEventListener("click", settingsController.openNotesDrawer);

    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
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
          <div class="chapter-body font-${settingsController.settings.font}">${paragraphize(chapter.text)}</div>
          <div class="chapter-nav">
            <button class="nav-btn" id="prevBtn" ${chapterIndex === 0 ? "disabled" : ""}>Prev</button>
            <select class="chapter-select" id="chapterSelect">${options}</select>
            ${forwardBtn}
          </div>
        </div>`;

    settingsController.applySettings();
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

      chapterSpans = buildChapterSpans(chapters);

      settingsController.applySettings();

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

  init();
}

runReader();
