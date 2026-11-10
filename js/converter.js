/* =========================================================================
   EPUB → TXT Converter — converter.js
   Vanilla JS, no frameworks. Uses JSZip (bundled) + DOMParser.
   Supports section-based editing, checkbox selection, batch deletion,
   individual section preview & editing, and full-text export.
   ========================================================================= */
(function () {
  "use strict";

  /* ---------- State ---------- */
  const state = {
    fileName: "output",
    title: "Untitled",
    author: "",
    sections: [], // [{ id, title, text, wordCount, charCount, lineCount, selected, expanded, deleted, originalIndex }]
    deletedHistory: [], // stack of deleted section arrays for undo
    activeTab: "sections", // "sections" | "preview"
    filterQuery: "",
  };

  /* ---------- DOM refs ---------- */
  const $ = (id) => document.getElementById(id);
  const els = {
    html: document.documentElement,
    themeToggle: $("themeToggle"),
    landingView: $("landingView"),
    dropzone: $("dropzone"),
    fileInput: $("fileInput"),
    loading: $("loading"),
    errorBox: $("errorBox"),
    errorMessage: $("errorMessage"),
    errorDismiss: $("errorDismiss"),
    editor: $("editor"),
    bookTitle: $("book-title"),
    bookAuthor: $("book-author"),
    newFileBtn: $("newFileBtn"),
    // View tabs
    tabSectionsBtn: $("tabSectionsBtn"),
    tabPreviewBtn: $("tabPreviewBtn"),
    sectionsView: $("sectionsView"),
    previewView: $("previewView"),
    tabSectionCount: $("tabSectionCount"),
    // Stats

    tabSectionCount: $("tabSectionCount"),
    charCount: $("charCount"),
    wordCount: $("wordCount"),

    readTime: $("readTime"),
    // Selection toolbar
    selectAllCheckbox: $("selectAllCheckbox"),
    selectionStatus: $("selectionStatus"),
    deleteSelectedBtn: $("deleteSelectedBtn"),
    selectedCount: $("selectedCount"),
    restoreBtn: $("restoreBtn"),
    deletedCount: $("deletedCount"),
    sectionSearchInput: $("sectionSearchInput"),
    expandAllBtn: $("expandAllBtn"),
    collapseAllBtn: $("collapseAllBtn"),
    // Sections list
    sectionsList: $("sectionsList"),
    sectionsEmpty: $("sectionsEmpty"),
    emptyTitle: $("emptyTitle"),
    emptySub: $("emptySub"),
    emptyActionBtn: $("emptyActionBtn"),
    // Full text editor
    textEditor: $("textEditor"),
    // Export buttons
    copyBtn: $("copyBtn"),
    downloadBtn: $("downloadBtn"),
    toast: $("toast"),
  };

  /* ---------- Theme management ---------- */
  const THEME_KEY = "epub-txt-theme";

  function getPreferredTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch (_) {}
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function applyTheme(theme) {
    els.html.setAttribute("data-theme", theme);
    const meta = document.querySelector(
      `meta[name="theme-color"]:not([media])`,
    );
    if (meta) {
      meta.setAttribute("content", theme === "dark" ? "#09090b" : "#ffffff");
    }
  }

  function toggleTheme() {
    const current = els.html.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (_) {}
  }

  applyTheme(getPreferredTheme());

  try {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mql.addEventListener("change", (e) => {
      let saved = null;
      try {
        saved = localStorage.getItem(THEME_KEY);
      } catch (_) {}
      if (saved !== "light" && saved !== "dark") {
        applyTheme(e.matches ? "dark" : "light");
      }
    });
  } catch (_) {}

  els.themeToggle.addEventListener("click", toggleTheme);

  /* ---------- Toast ---------- */
  let toastTimer = 0;
  function showToast(message, isError, undoCallback) {
    const t = els.toast;
    t.innerHTML = "";

    const span = document.createElement("span");
    span.textContent = message;
    t.appendChild(span);

    if (typeof undoCallback === "function") {
      const undoBtn = document.createElement("button");
      undoBtn.type = "button";
      undoBtn.className = "toast-undo-btn";
      undoBtn.textContent = "Undo";
      undoBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        undoCallback();
        hideToast();
      });
      t.appendChild(undoBtn);
    }

    t.classList.toggle("error", Boolean(isError));
    t.hidden = false;
    void t.offsetWidth;
    t.classList.add("show");

    clearTimeout(toastTimer);
    const duration = undoCallback ? 4500 : 2500;
    toastTimer = setTimeout(hideToast, duration);
  }

  function hideToast() {
    const t = els.toast;
    t.classList.remove("show");
    setTimeout(() => {
      t.hidden = true;
    }, 220);
  }

  /* ---------- Helpers ---------- */
  function escapeHtml(str) {
    return String(str || "").replace(
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

  function formatNumber(n) {
    return Number(n || 0).toLocaleString(undefined, { useGrouping: true });
  }

  function calculateStats(text) {
    const t = text || "";
    const chars = t.length;
    const words = (t.match(/\S+/g) || []).length;
    const lines = t ? t.split("\n").length : 0;
    return { chars, words, lines };
  }

  function getPreviewSnippet(text) {
    if (!text || !text.trim()) return "(empty section)";
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const snippet = lines.slice(0, 3).join(" ");
    return snippet.length > 220 ? snippet.slice(0, 220) + "…" : snippet;
  }

  function getCombinedText() {
    const active = state.sections.filter((s) => !s.deleted);
    return active
      .map((s) => s.text.trim())
      .filter(Boolean)
      .join("\n\n");
  }

  /* ---------- Status views ---------- */
  function showLoading() {
    els.loading.hidden = false;
    els.errorBox.hidden = true;
    els.editor.hidden = true;
    els.landingView.hidden = true;
  }
  function showError(message) {
    els.loading.hidden = true;
    els.editor.hidden = true;
    els.landingView.hidden = false;
    els.errorBox.hidden = false;
    els.errorMessage.textContent =
      message || "Please make sure it is a valid EPUB file and try again.";
  }
  function hideError() {
    els.errorBox.hidden = true;
  }
  function showEditor() {
    els.loading.hidden = true;
    els.errorBox.hidden = true;
    els.landingView.hidden = true;
    els.editor.hidden = false;
  }
  function reset() {
    state.sections = [];
    state.deletedHistory = [];
    state.fileName = "output";
    state.title = "Untitled";
    state.author = "";
    state.filterQuery = "";
    state.activeTab = "sections";

    els.textEditor.value = "";
    els.bookTitle.textContent = "Untitled";
    els.bookAuthor.textContent = "";
    els.fileInput.value = "";
    els.sectionSearchInput.value = "";

    switchTab("sections");
    updateOverallStats();

    els.loading.hidden = true;
    els.errorBox.hidden = true;
    els.editor.hidden = true;
    els.landingView.hidden = false;
  }

  /* ---------- EPUB parsing ---------- */
  const BLOCK_TAGS = new Set([
    "address",
    "article",
    "aside",
    "blockquote",
    "details",
    "div",
    "dl",
    "dt",
    "dd",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "li",
    "main",
    "nav",
    "p",
    "pre",
    "section",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "caption",
    "ul",
    "ol",
  ]);
  const SKIP_TAGS = new Set([
    "script",
    "style",
    "head",
    "svg",
    "math",
    "iframe",
    "object",
    "video",
    "audio",
    "noscript",
    "template",
  ]);

  function extractText(node) {
    let out = "";
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.nodeValue;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = (child.tagName || "").toLowerCase();
        if (SKIP_TAGS.has(tag)) continue;
        if (tag === "br") {
          out += "\n";
          continue;
        }
        if (tag === "wbr") continue;
        if (tag === "img") {
          const alt = child.getAttribute("alt");
          if (alt) out += alt;
          continue;
        }
        out += extractText(child);
        if (BLOCK_TAGS.has(tag)) out += "\n";
      }
    }
    return out;
  }

  function normalizeText(text) {
    if (!text) return "";
    text = text.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " ");
    text = text.replace(/\t/g, " ");
    text = text.replace(/[\u200b\u200c\u200d\ufeff]/g, "");
    text = text.replace(/ +\n/g, "\n");
    text = text.replace(/ {2,}/g, " ");
    text = text.replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n");
    text = text.replace(/\n +/g, "\n");
    return text.trim();
  }

  function parseHtmlDocument(html) {
    let doc = new DOMParser().parseFromString(html, "application/xhtml+xml");
    if (doc.getElementsByTagName("parsererror").length > 0) {
      doc = new DOMParser().parseFromString(html, "text/html");
    }
    return doc;
  }

  function resolvePath(base, rel) {
    if (!rel) return "";
    if (rel.startsWith("/")) return rel.slice(1);
    const stack = base ? base.split("/") : [];
    if (stack.length) stack.pop();
    const parts = rel.split("/");
    for (const p of parts) {
      if (p === "." || p === "") continue;
      if (p === "..") stack.pop();
      else stack.push(p);
    }
    return stack.join("/");
  }

  function getElementsByLocalName(parent, localName) {
    const all = parent.getElementsByTagName("*");
    const matches = [];
    for (let i = 0; i < all.length; i++) {
      if (all[i].localName === localName) matches.push(all[i]);
    }
    return matches;
  }

  function extractMetadata(opfDoc) {
    const titleEls = getElementsByLocalName(opfDoc, "title");
    const creatorEls = getElementsByLocalName(opfDoc, "creator");

    const inMeta = (el) =>
      el.parentNode && el.parentNode.localName === "metadata";

    const titles = titleEls
      .filter(inMeta)
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean);
    const creators = creatorEls
      .filter(inMeta)
      .map((el) => {
        const role = el.getAttribute("opf:role") || el.getAttribute("role");
        const text = (el.textContent || "").trim();
        if (role && role !== "aut") return "";
        return text;
      })
      .filter(Boolean);

    const title = titles[0] || "Untitled";
    const author = creators.length > 0 ? creators.join(", ") : "Unknown author";
    return { title, author };
  }

  function extractSpineItems(opfDoc) {
    const manifest = new Map();
    const items = getElementsByLocalName(opfDoc, "item");
    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      if (el.parentNode && el.parentNode.localName !== "manifest") continue;
      const id = el.getAttribute("id");
      if (!id) continue;
      manifest.set(id, {
        id,
        href: el.getAttribute("href") || "",
        mediaType: el.getAttribute("media-type") || "",
        properties: el.getAttribute("properties") || "",
      });
    }

    const spine = getElementsByLocalName(opfDoc, "spine")[0];
    if (!spine) return [];

    const refs = getElementsByLocalName(spine, "itemref");
    const result = [];
    for (let i = 0; i < refs.length; i++) {
      const idref = refs[i].getAttribute("idref");
      if (idref && manifest.has(idref)) {
        const item = manifest.get(idref);
        const linear = refs[i].getAttribute("linear");
        if (linear === "no") continue;
        result.push(item);
      }
    }
    return result;
  }

  function isXhtmlMediaType(type) {
    if (!type) return true;
    const t = type.toLowerCase();
    return (
      t === "application/xhtml+xml" ||
      t === "text/html" ||
      t === "application/xml" ||
      t === "text/xml"
    );
  }

  // Extract Table of Contents mapping: clean href -> title
  async function extractTocMap(zip, opfDoc, opfPath) {
    const tocMap = new Map();
    const basePath = opfPath.includes("/")
      ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1)
      : "";

    const items = getElementsByLocalName(opfDoc, "item");
    let navHref = null;
    let ncxHref = null;

    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      const props = el.getAttribute("properties") || "";
      const media = (el.getAttribute("media-type") || "").toLowerCase();
      const href = el.getAttribute("href") || "";
      if (props.split(/\s+/).includes("nav")) {
        navHref = href;
      }
      if (
        media === "application/x-dtbncx+xml" ||
        el.getAttribute("id") === "ncx"
      ) {
        ncxHref = href;
      }
    }

    // EPUB 3 Nav Document
    if (navHref) {
      try {
        const navPath = resolvePath(basePath, navHref);
        const navFile = zip.file(navPath);
        if (navFile) {
          const navHtml = await navFile.async("text");
          const navDoc = parseHtmlDocument(navHtml);
          const tocNav =
            navDoc.querySelector('nav[epub\\:type="toc"]') ||
            navDoc.querySelector("nav#toc") ||
            navDoc.querySelector("nav");
          if (tocNav) {
            const navBase = navPath.includes("/")
              ? navPath.substring(0, navPath.lastIndexOf("/") + 1)
              : "";
            const links = tocNav.querySelectorAll("a[href]");
            links.forEach((a) => {
              const rawHref = a.getAttribute("href");
              if (!rawHref) return;
              const cleanHref = rawHref.split("#")[0];
              const resolved = resolvePath(navBase, cleanHref);
              const title = (a.textContent || "").trim().replace(/\s+/g, " ");
              if (resolved && title && !tocMap.has(resolved)) {
                tocMap.set(resolved, title);
              }
            });
          }
        }
      } catch (e) {
        console.warn("Could not parse EPUB 3 Nav:", e);
      }
    }

    // EPUB 2 NCX
    if (ncxHref) {
      try {
        const ncxPath = resolvePath(basePath, ncxHref);
        const ncxFile = zip.file(ncxPath);
        if (ncxFile) {
          const ncxXml = await ncxFile.async("text");
          const ncxDoc = new DOMParser().parseFromString(
            ncxXml,
            "application/xml",
          );
          const navPoints = getElementsByLocalName(ncxDoc, "navPoint");
          const ncxBase = ncxPath.includes("/")
            ? ncxPath.substring(0, ncxPath.lastIndexOf("/") + 1)
            : "";
          for (let i = 0; i < navPoints.length; i++) {
            const np = navPoints[i];
            const contentEl = getElementsByLocalName(np, "content")[0];
            const textEl = getElementsByLocalName(np, "text")[0];
            if (contentEl && textEl) {
              const src = contentEl.getAttribute("src") || "";
              const cleanSrc = src.split("#")[0];
              const resolved = resolvePath(ncxBase, cleanSrc);
              const title = (textEl.textContent || "")
                .trim()
                .replace(/\s+/g, " ");
              if (resolved && title && !tocMap.has(resolved)) {
                tocMap.set(resolved, title);
              }
            }
          }
        }
      } catch (e) {
        console.warn("Could not parse EPUB 2 NCX:", e);
      }
    }

    return tocMap;
  }

  // Determine section title from TOC, headings, or filename
  function detectSectionTitle(doc, filePath, tocMap, bookTitle, index) {
    if (tocMap && tocMap.has(filePath)) {
      return tocMap.get(filePath);
    }

    // Check headings inside document
    const headings = doc.querySelectorAll(
      "h1, h2, h3, [role='heading'], .chapter-title, .title, .heading",
    );
    for (let i = 0; i < headings.length; i++) {
      const hText = (headings[i].textContent || "").trim().replace(/\s+/g, " ");
      if (hText && hText.length <= 90) {
        if (
          bookTitle &&
          hText.toLowerCase() === bookTitle.toLowerCase() &&
          headings.length > 1
        ) {
          continue;
        }
        return hText;
      }
    }

    // Document title
    const docTitle = doc.querySelector("title");
    if (docTitle) {
      const t = (docTitle.textContent || "").trim().replace(/\s+/g, " ");
      if (
        t &&
        t.length <= 80 &&
        (!bookTitle || t.toLowerCase() !== bookTitle.toLowerCase())
      ) {
        return t;
      }
    }

    // First line of text
    const body = doc.body || doc.querySelector("body") || doc.documentElement;
    if (body) {
      const rawText = (body.textContent || "").trim();
      const firstLine = rawText
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      if (firstLine && firstLine.length <= 60) {
        if (
          /^(chapter|part|book|section|prologue|epilogue|preface|foreword|introduction|afterword|dedication|copyright)/i.test(
            firstLine,
          ) ||
          firstLine.length <= 35
        ) {
          return firstLine;
        }
      }
    }

    // Cleaned filename
    const filename = (filePath || "").split("/").pop() || "";
    const cleanName = filename
      .replace(/\.(x?html?|xml)$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    if (
      cleanName &&
      cleanName.length <= 35 &&
      !/^(index|content|text)$/i.test(cleanName)
    ) {
      return cleanName
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }

    return `Section ${index + 1}`;
  }

  // Split single-file EPUB into multiple sections if distinct headings exist
  function splitSingleDocIntoSections(doc, baseTitle) {
    const headings = doc.querySelectorAll("h1, h2");
    if (headings.length < 2) return null;

    const body = (
      doc.body ||
      doc.querySelector("body") ||
      doc.documentElement
    ).cloneNode(true);
    const childNodes = Array.from(body.childNodes);
    const sections = [];

    let currentTitle = baseTitle || "Section 1";
    let currentNodes = [];

    const flush = () => {
      if (currentNodes.length === 0) return;
      const container = document.createElement("div");
      currentNodes.forEach((n) => container.appendChild(n));
      const text = normalizeText(extractText(container));
      if (text.trim()) {
        sections.push({
          title: currentTitle,
          text: text,
        });
      }
      currentNodes = [];
    };

    for (const child of childNodes) {
      const tag = (child.tagName || "").toLowerCase();
      if (tag === "h1" || tag === "h2") {
        flush();
        currentTitle =
          (child.textContent || "").trim().replace(/\s+/g, " ") ||
          `Chapter ${sections.length + 1}`;
        currentNodes.push(child);
      } else {
        currentNodes.push(child);
      }
    }
    flush();

    return sections.length >= 2 ? sections : null;
  }

  async function parseEpubFile(file) {
    if (!file) throw new Error("No file provided.");
    if (file.size > 200 * 1024 * 1024) {
      throw new Error("File is too large (max 200 MB).");
    }

    const arrayBuffer = await file.arrayBuffer();
    let zip;
    try {
      zip = await JSZip.loadAsync(arrayBuffer);
    } catch (e) {
      throw new Error("This file is not a valid EPUB (could not unzip).");
    }

    const containerFile = zip.file("META-INF/container.xml");
    if (!containerFile) {
      throw new Error("Missing META-INF/container.xml — not a valid EPUB.");
    }
    const containerXml = await containerFile.async("text");
    const containerDoc = new DOMParser().parseFromString(
      containerXml,
      "application/xml",
    );
    if (containerDoc.getElementsByTagName("parsererror").length > 0) {
      throw new Error("Could not parse container.xml.");
    }

    const rootfileEls = getElementsByLocalName(containerDoc, "rootfile");
    if (rootfileEls.length === 0) {
      throw new Error("No <rootfile> element found in container.xml.");
    }
    const opfPath = rootfileEls[0].getAttribute("full-path");
    if (!opfPath) {
      throw new Error("Missing full-path attribute on <rootfile>.");
    }

    const opfFile = zip.file(opfPath);
    if (!opfFile) {
      throw new Error(`OPF file "${opfPath}" not found in archive.`);
    }
    const opfXml = await opfFile.async("text");
    const opfDoc = new DOMParser().parseFromString(opfXml, "application/xml");
    if (opfDoc.getElementsByTagName("parsererror").length > 0) {
      throw new Error("Could not parse the OPF file.");
    }

    const meta = extractMetadata(opfDoc);
    const spineItems = extractSpineItems(opfDoc);

    if (spineItems.length === 0) {
      throw new Error("EPUB has no readable spine (no content order).");
    }

    const basePath = opfPath.includes("/")
      ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1)
      : "";

    const tocMap = await extractTocMap(zip, opfDoc, opfPath);

    const sections = [];
    let sectionCounter = 0;

    for (let i = 0; i < spineItems.length; i++) {
      const item = spineItems[i];
      if (!isXhtmlMediaType(item.mediaType)) continue;
      const filePath = resolvePath(basePath, item.href);
      const file = zip.file(filePath);
      if (!file) continue;

      const html = await file.async("text");
      const doc = parseHtmlDocument(html);

      // Check if this single document contains multiple chapters
      if (spineItems.length === 1) {
        const subSections = splitSingleDocIntoSections(doc, meta.title);
        if (subSections && subSections.length >= 2) {
          subSections.forEach((sub) => {
            sectionCounter++;
            const stats = calculateStats(sub.text);
            sections.push({
              id: `sec-${sectionCounter}`,
              originalIndex: sectionCounter,
              title: sub.title,
              text: sub.text,
              wordCount: stats.words,
              charCount: stats.chars,
              lineCount: stats.lines,
              selected: false,
              expanded: false,
              deleted: false,
            });
          });
          continue;
        }
      }

      const body = doc.body || doc.querySelector("body") || doc.documentElement;
      if (!body) continue;

      const rawText = extractText(body);
      const normalized = normalizeText(rawText);
      if (!normalized) continue;

      const title = detectSectionTitle(
        doc,
        filePath,
        tocMap,
        meta.title,
        sectionCounter,
      );
      sectionCounter++;
      const stats = calculateStats(normalized);

      sections.push({
        id: `sec-${sectionCounter}`,
        originalIndex: sectionCounter,
        title: title,
        text: normalized,
        wordCount: stats.words,
        charCount: stats.chars,
        lineCount: stats.lines,
        selected: false,
        expanded: false,
        deleted: false,
      });

      if (sectionCounter % 6 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    if (sections.length === 0) {
      throw new Error("No text content found in this EPUB.");
    }

    return {
      title: meta.title,
      author: meta.author,
      sections: sections,
    };
  }

  /* ---------- File handling ---------- */
  function isEpubFile(file) {
    if (!file) return false;
    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();
    return name.endsWith(".epub") || type === "application/epub+zip";
  }

  function sanitizeFilename(name) {
    const base = (name || "").replace(/\.epub$/i, "").trim();
    const cleaned = base
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned || "output";
  }

  let parseAbort = null;
  async function handleFile(file) {
    if (!isEpubFile(file)) {
      showError(`“${file.name}” doesn’t look like an EPUB file.`);
      return;
    }

    parseAbort = { canceled: false };
    const myParse = parseAbort;
    showLoading();

    try {
      const result = await parseEpubFile(file);
      if (myParse.canceled) return;

      state.title = result.title;
      state.author = result.author;
      state.sections = result.sections;
      state.deletedHistory = [];
      state.fileName = sanitizeFilename(file.name);
      state.filterQuery = "";

      els.bookTitle.textContent = result.title;
      els.bookAuthor.textContent = result.author
        ? `by ${result.author}`
        : "Unknown author";
      els.sectionSearchInput.value = "";

      hideError();
      showEditor();
      switchTab("sections");
      renderSections();
    } catch (err) {
      console.error("EPUB parse error:", err);
      if (myParse.canceled) return;
      const msg =
        (err && err.message) || "Something went wrong while parsing this EPUB.";
      showError(msg);
    }
  }

  /* ---------- Stats & Toolbar Updates ---------- */
  let statsTimer = 0;
  function updateOverallStats() {
    clearTimeout(statsTimer);
    statsTimer = setTimeout(() => {
      const active = state.sections.filter((s) => !s.deleted);
      const combined = getCombinedText();
      const stats = calculateStats(combined);
      const readMin = Math.max(1, Math.round(stats.words / 200));

      els.tabSectionCount.textContent = formatNumber(active.length);
      els.charCount.textContent = formatNumber(stats.chars);
      els.wordCount.textContent = formatNumber(stats.words);

      els.readTime.textContent = readMin;
    }, 40);
  }

  function getVisibleSections() {
    const query = state.filterQuery.trim().toLowerCase();
    const active = state.sections.filter((s) => !s.deleted);
    if (!query) return active;
    return active.filter(
      (s) =>
        s.title.toLowerCase().includes(query) ||
        s.text.toLowerCase().includes(query),
    );
  }

  function updateSelectionControls(visibleSections) {
    const visible = visibleSections || getVisibleSections();
    const selected = visible.filter((s) => s.selected);
    const selectedCount = selected.length;
    const totalVisible = visible.length;

    els.selectedCount.textContent = selectedCount;
    els.selectionStatus.textContent = `${selectedCount} selected`;
    els.deleteSelectedBtn.disabled = selectedCount === 0;

    if (totalVisible === 0) {
      els.selectAllCheckbox.checked = false;
      els.selectAllCheckbox.indeterminate = false;
      els.selectAllCheckbox.disabled = true;
    } else if (selectedCount === totalVisible) {
      els.selectAllCheckbox.checked = true;
      els.selectAllCheckbox.indeterminate = false;
      els.selectAllCheckbox.disabled = false;
    } else if (selectedCount > 0) {
      els.selectAllCheckbox.checked = false;
      els.selectAllCheckbox.indeterminate = true;
      els.selectAllCheckbox.disabled = false;
    } else {
      els.selectAllCheckbox.checked = false;
      els.selectAllCheckbox.indeterminate = false;
      els.selectAllCheckbox.disabled = false;
    }

    const totalDeleted = state.sections.filter((s) => s.deleted).length;
    els.restoreBtn.hidden = totalDeleted === 0;
    els.deletedCount.textContent = totalDeleted;
  }

  /* ---------- Section Rendering ---------- */
  function renderSections() {
    const visibleSections = getVisibleSections();
    const activeSections = state.sections.filter((s) => !s.deleted);

    if (visibleSections.length === 0) {
      els.sectionsList.innerHTML = "";
      els.sectionsEmpty.hidden = false;
      if (activeSections.length === 0) {
        els.emptyTitle.textContent = "All sections have been deleted";
        els.emptySub.textContent =
          "You can restore deleted sections or convert another file.";
        els.emptyActionBtn.textContent = "Restore all sections";
        els.emptyActionBtn.hidden = false;
      } else {
        els.emptyTitle.textContent = "No matching sections found";
        els.emptySub.textContent = `No sections match "${escapeHtml(
          state.filterQuery,
        )}".`;
        els.emptyActionBtn.textContent = "Clear search";
        els.emptyActionBtn.hidden = false;
      }
    } else {
      els.sectionsEmpty.hidden = true;
      const fragment = document.createDocumentFragment();

      visibleSections.forEach((s) => {
        const card = document.createElement("div");
        card.className = `section-card ${s.selected ? "is-selected" : ""} ${
          s.expanded ? "is-expanded" : ""
        }`;
        card.setAttribute("data-id", s.id);

        const previewSnippet = getPreviewSnippet(s.text);

        card.innerHTML = `
          <div class="section-card-head">
            <input
              type="checkbox"
              class="section-checkbox"
              data-id="${s.id}"
              ${s.selected ? "checked" : ""}
              aria-label="Select ${escapeHtml(s.title)}"
            />
            <span class="section-index">#${s.originalIndex}</span>
            <div class="section-title-wrap">
              <span class="section-title" title="${escapeHtml(
                s.title,
              )}">${escapeHtml(s.title)}</span>
            </div>
            <div class="section-badges">
              <span class="section-badge" id="sec-badge-${s.id}">${formatNumber(
                s.wordCount,
              )} words</span>
            </div>
            <div class="section-actions">
              <button
                type="button"
                class="icon-button toggle-btn"
                data-action="toggle"
                data-id="${s.id}"
                title="${s.expanded ? "Collapse section" : "Expand & Edit section"}"
                aria-label="${s.expanded ? "Collapse section" : "Expand & Edit section"}"
                aria-expanded="${s.expanded ? "true" : "false"}"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <button
                type="button"
                class="icon-button delete-btn"
                data-action="delete"
                data-id="${s.id}"
                title="Delete section"
                aria-label="Delete ${escapeHtml(s.title)}"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
            </div>
          </div>

          ${
            !s.expanded
              ? `<p class="section-preview">${escapeHtml(previewSnippet)}</p>`
              : `
          <div class="section-body">
            <div class="section-body-meta">
              <label class="section-title-label">
                <span>Title:</span>
                <input
                  type="text"
                  class="section-title-input"
                  data-id="${s.id}"
                  value="${escapeHtml(s.title)}"
                  aria-label="Section title"
                />
              </label>
              <span class="section-body-stats" id="sec-stats-${s.id}">
                ${formatNumber(s.charCount)} chars · ${s.lineCount} lines
              </span>
            </div>
            <textarea
              class="section-textarea"
              data-id="${s.id}"
              spellcheck="false"
              aria-label="Section content"
            >${escapeHtml(s.text)}</textarea>
          </div>`
          }
        `;
        fragment.appendChild(card);
      });

      els.sectionsList.innerHTML = "";
      els.sectionsList.appendChild(fragment);
    }

    updateSelectionControls(visibleSections);
    updateOverallStats();
  }

  /* ---------- Section Deletion & Undo ---------- */
  function deleteSelected() {
    const visible = getVisibleSections();
    const toDelete = visible.filter((s) => s.selected && !s.deleted);
    if (toDelete.length === 0) return;

    toDelete.forEach((s) => {
      s.deleted = true;
      s.selected = false;
    });
    state.deletedHistory.push(toDelete);

    const count = toDelete.length;
    showToast(
      `Deleted ${count} section${count > 1 ? "s" : ""}.`,
      false,
      undoDelete,
    );
    renderSections();
  }

  function deleteSingle(id) {
    const section = state.sections.find((s) => s.id === id);
    if (!section || section.deleted) return;

    section.deleted = true;
    section.selected = false;
    state.deletedHistory.push([section]);

    showToast(`Deleted "${section.title}".`, false, undoDelete);
    renderSections();
  }

  function undoDelete() {
    if (state.deletedHistory.length === 0) return;
    const batch = state.deletedHistory.pop();
    batch.forEach((s) => {
      s.deleted = false;
    });
    showToast(
      `Restored ${batch.length} section${batch.length > 1 ? "s" : ""}.`,
    );
    renderSections();
  }

  function restoreAll() {
    const deleted = state.sections.filter((s) => s.deleted);
    if (deleted.length === 0) return;

    deleted.forEach((s) => {
      s.deleted = false;
    });
    state.deletedHistory = [];
    showToast(`Restored all ${deleted.length} sections.`);
    renderSections();
  }

  /* ---------- Tab Switching ---------- */
  function switchTab(tab) {
    state.activeTab = tab;
    if (tab === "sections") {
      els.tabSectionsBtn.classList.add("is-active");
      els.tabSectionsBtn.setAttribute("aria-selected", "true");
      els.tabPreviewBtn.classList.remove("is-active");
      els.tabPreviewBtn.setAttribute("aria-selected", "false");
      els.sectionsView.hidden = false;
      els.previewView.hidden = true;
    } else {
      els.tabPreviewBtn.classList.add("is-active");
      els.tabPreviewBtn.setAttribute("aria-selected", "true");
      els.tabSectionsBtn.classList.remove("is-active");
      els.tabSectionsBtn.setAttribute("aria-selected", "false");
      els.previewView.hidden = false;
      els.sectionsView.hidden = true;

      // Sync combined text into textarea
      const combined = getCombinedText();
      els.textEditor.value = combined;
    }
  }

  /* ---------- Export (Download / Copy) ---------- */
  function getCurrentExportText() {
    if (state.activeTab === "preview") {
      return els.textEditor.value;
    }
    return getCombinedText();
  }

  function downloadTxt() {
    const text = getCurrentExportText();
    if (!text || !text.trim()) {
      showToast("Nothing to download (all sections deleted or empty)", true);
      return;
    }
    const blob = new Blob(["\ufeff", text], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${state.fileName}.txt`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Downloaded " + a.download);
  }

  async function copyText() {
    const text = getCurrentExportText();
    if (!text || !text.trim()) {
      showToast("Nothing to copy yet", true);
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        showToast("Copied to clipboard");
        return;
      }
    } catch (_) {}

    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      showToast(ok ? "Copied to clipboard" : "Copy failed", !ok);
    } catch (e) {
      showToast("Copy not supported", true);
    }
  }

  /* ---------- Event wiring ---------- */
  // Tabs
  els.tabSectionsBtn.addEventListener("click", () => switchTab("sections"));
  els.tabPreviewBtn.addEventListener("click", () => switchTab("preview"));

  // Batch selection toolbar
  els.selectAllCheckbox.addEventListener("change", (e) => {
    const checked = e.target.checked;
    const visible = getVisibleSections();
    visible.forEach((s) => {
      s.selected = checked;
    });

    const cards = els.sectionsList.querySelectorAll(".section-card");
    cards.forEach((card) => {
      const id = card.getAttribute("data-id");
      const checkbox = card.querySelector(".section-checkbox");
      if (checkbox) checkbox.checked = checked;
      card.classList.toggle("is-selected", checked);
    });

    updateSelectionControls(visible);
  });

  els.deleteSelectedBtn.addEventListener("click", deleteSelected);
  els.restoreBtn.addEventListener("click", restoreAll);

  // Search filter
  els.sectionSearchInput.addEventListener("input", (e) => {
    state.filterQuery = e.target.value;
    renderSections();
  });

  // Expand / collapse all
  els.expandAllBtn.addEventListener("click", () => {
    const visible = getVisibleSections();
    visible.forEach((s) => {
      s.expanded = true;
    });
    renderSections();
  });
  els.collapseAllBtn.addEventListener("click", () => {
    const visible = getVisibleSections();
    visible.forEach((s) => {
      s.expanded = false;
    });
    renderSections();
  });

  // Empty state button
  els.emptyActionBtn.addEventListener("click", () => {
    const active = state.sections.filter((s) => !s.deleted);
    if (active.length === 0) {
      restoreAll();
    } else {
      state.filterQuery = "";
      els.sectionSearchInput.value = "";
      renderSections();
    }
  });

  // Event delegation on sections list
  els.sectionsList.addEventListener("change", (e) => {
    if (e.target.matches(".section-checkbox")) {
      const id = e.target.getAttribute("data-id");
      const section = state.sections.find((s) => s.id === id);
      if (section) {
        section.selected = e.target.checked;
        const card = e.target.closest(".section-card");
        if (card) card.classList.toggle("is-selected", section.selected);
        updateSelectionControls();
      }
    }
  });

  els.sectionsList.addEventListener("click", (e) => {
    const actionBtn = e.target.closest("[data-action]");
    if (!actionBtn) return;
    const action = actionBtn.getAttribute("data-action");
    const id = actionBtn.getAttribute("data-id");
    const section = state.sections.find((s) => s.id === id);
    if (!section) return;

    if (action === "toggle") {
      section.expanded = !section.expanded;
      renderSections();
    } else if (action === "delete") {
      deleteSingle(id);
    }
  });

  els.sectionsList.addEventListener("input", (e) => {
    // Title edit
    if (e.target.matches(".section-title-input")) {
      const id = e.target.getAttribute("data-id");
      const section = state.sections.find((s) => s.id === id);
      if (section) {
        section.title = e.target.value.trim() || "Untitled Section";
        const card = e.target.closest(".section-card");
        const titleSpan = card ? card.querySelector(".section-title") : null;
        if (titleSpan) titleSpan.textContent = section.title;
      }
    }
    // Text edit
    else if (e.target.matches(".section-textarea")) {
      const id = e.target.getAttribute("data-id");
      const section = state.sections.find((s) => s.id === id);
      if (section) {
        section.text = e.target.value;
        const stats = calculateStats(section.text);
        section.wordCount = stats.words;
        section.charCount = stats.chars;
        section.lineCount = stats.lines;

        const badge = $(`sec-badge-${id}`);
        if (badge) badge.textContent = `${formatNumber(stats.words)} words`;

        const statsLabel = $(`sec-stats-${id}`);
        if (statsLabel) {
          statsLabel.textContent = `${formatNumber(
            stats.chars,
          )} chars · ${stats.lines} lines`;
        }

        updateOverallStats();
      }
    }
  });

  // Full text preview editor edit
  els.textEditor.addEventListener("input", (e) => {
    const text = e.target.value;
    const stats = calculateStats(text);
    const readMin = Math.max(1, Math.round(stats.words / 200));
    els.charCount.textContent = formatNumber(stats.chars);
    els.wordCount.textContent = formatNumber(stats.words);

    els.readTime.textContent = readMin;
  });

  // Dropzone interactions
  const dz = els.dropzone;
  let dragCounter = 0;

  dz.addEventListener("click", () => els.fileInput.click());
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      els.fileInput.click();
    }
  });

  dz.addEventListener("dragenter", (e) => {
    if (
      !els.landingView.hidden &&
      (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files"))
    )
      return;
    e.preventDefault();
    dragCounter++;
    dz.classList.add("is-dragging");
  });
  dz.addEventListener("dragover", (e) => {
    if (
      !els.landingView.hidden &&
      (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files"))
    )
      return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  dz.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) dz.classList.remove("is-dragging");
  });
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dragCounter = 0;
    dz.classList.remove("is-dragging");
    const file =
      e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  window.addEventListener("dragover", (e) => {
    if (!els.landingView.hidden && e.dataTransfer) e.preventDefault();
  });
  window.addEventListener("drop", (e) => {
    if (!els.landingView.hidden && e.dataTransfer && e.dataTransfer.files[0]) {
      e.preventDefault();
      handleFile(e.dataTransfer.files[0]);
    }
  });

  els.fileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
    e.target.value = "";
  });

  els.errorDismiss.addEventListener("click", hideError);
  els.newFileBtn.addEventListener("click", reset);
  els.copyBtn.addEventListener("click", copyText);
  els.downloadBtn.addEventListener("click", downloadTxt);

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    const isMod = e.ctrlKey || e.metaKey;
    if (!isMod) return;
    const key = e.key.toLowerCase();
    if (key === "s" && !els.editor.hidden) {
      e.preventDefault();
      downloadTxt();
    } else if (key === "c" && e.shiftKey && !els.editor.hidden) {
      e.preventDefault();
      copyText();
    }
  });

  // Initial state
  reset();
})();
