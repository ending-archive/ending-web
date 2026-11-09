/* =========================================================================
   EPUB → TXT Converter — app.js
   Vanilla JS, no frameworks. Uses JSZip (bundled) + DOMParser.
   ========================================================================= */
(function () {
  "use strict";

  /* ---------- State ---------- */
  const state = {
    text: "",
    fileName: "output",
  };

  /* ---------- DOM refs ---------- */
  const $ = (id) => document.getElementById(id);
  const els = {
    html: document.documentElement,
    themeToggle: $("themeToggle"),
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
    textEditor: $("textEditor"),
    charCount: $("charCount"),
    wordCount: $("wordCount"),
    lineCount: $("lineCount"),
    readTime: $("readTime"),
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
    // Update non-media theme-color meta (for browser chrome)
    const meta = document.querySelector(
      `meta[name="theme-color"]:not([media])`
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

  // Apply preferred theme ASAP (before paint) — already done via inline script
  // in <head>; here we just hook the toggle.
  applyTheme(getPreferredTheme());

  // React to system theme changes if user hasn't overridden
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
  function showToast(message, isError) {
    const t = els.toast;
    t.textContent = message;
    t.classList.toggle("error", Boolean(isError));
    t.hidden = false;
    // Force reflow so the transition runs
    void t.offsetWidth;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => {
        t.hidden = true;
      }, 220);
    }, 2200);
  }

  /* ---------- Status views ---------- */
  function showLoading() {
    els.loading.hidden = false;
    els.errorBox.hidden = true;
    els.editor.hidden = true;
    els.dropzone.hidden = true;
  }
  function showError(message) {
    els.loading.hidden = true;
    els.editor.hidden = true;
    els.dropzone.hidden = false;
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
    els.dropzone.hidden = true;
    els.editor.hidden = false;
  }
  function reset() {
    state.text = "";
    state.fileName = "output";
    els.textEditor.value = "";
    els.bookTitle.textContent = "Untitled";
    els.bookAuthor.textContent = "";
    els.fileInput.value = "";
    updateStats("");
    els.loading.hidden = true;
    els.errorBox.hidden = true;
    els.editor.hidden = true;
    els.dropzone.hidden = false;
  }

  /* ---------- EPUB parsing ---------- */

  // Tags that should produce a newline boundary when extracting text.
  const BLOCK_TAGS = new Set([
    "address", "article", "aside", "blockquote", "details", "div", "dl",
    "dt", "dd", "fieldset", "figcaption", "figure", "footer", "form",
    "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main",
    "nav", "p", "pre", "section", "table", "thead", "tbody", "tfoot",
    "tr", "caption", "ul", "ol",
  ]);
  // Tags whose content we skip entirely.
  const SKIP_TAGS = new Set([
    "script", "style", "head", "svg", "math", "iframe", "object",
    "video", "audio", "noscript", "template",
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
    // Convert non-breaking and exotic spaces to regular space
    text = text.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " ");
    // Tabs to spaces
    text = text.replace(/\t/g, " ");
    // Zero-width characters — strip
    text = text.replace(/[\u200b\u200c\u200d\ufeff]/g, "");
    // Trim trailing spaces on each line
    text = text.replace(/ +\n/g, "\n");
    // Collapse runs of spaces (but preserve newlines)
    text = text.replace(/ {2,}/g, " ");
    // Collapse 3+ newlines (with optional spaces) into 2
    text = text.replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n");
    // Strip leading spaces at line starts (after first column)
    text = text.replace(/\n +/g, "\n");
    return text.trim() + "\n";
  }

  function extractTextFromXhtml(html) {
    let doc = new DOMParser().parseFromString(html, "application/xhtml+xml");
    if (doc.getElementsByTagName("parsererror").length > 0) {
      // Fall back to HTML parsing (more lenient)
      doc = new DOMParser().parseFromString(html, "text/html");
    }
    const body =
      doc.body ||
      doc.querySelector("body") ||
      doc.documentElement;
    if (!body) return "";
    return extractText(body);
  }

  // Resolve relative paths inside the EPUB zip
  function resolvePath(base, rel) {
    if (!rel) return "";
    // Absolute path inside zip
    if (rel.startsWith("/")) return rel.slice(1);
    const stack = base ? base.split("/") : [];
    if (stack.length) stack.pop(); // remove trailing file/dir name
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
    // EPUB 2: <dc:title>, <dc:creator>; EPUB 3 same.
    const titleEls = getElementsByLocalName(opfDoc, "title");
    const creatorEls = getElementsByLocalName(opfDoc, "creator");

    // Filter to those inside <metadata> for safety
    const inMeta = (el) =>
      el.parentNode && el.parentNode.localName === "metadata";

    const titles = titleEls
      .filter(inMeta)
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean);
    const creators = creatorEls
      .filter(inMeta)
      .map((el) => {
        // EPUB 3 may have role via refines; we just use the text
        const role = el.getAttribute("opf:role") || el.getAttribute("role");
        const text = (el.textContent || "").trim();
        // Skip translators/editors if role is set and not "aut"
        if (role && role !== "aut") return "";
        return text;
      })
      .filter(Boolean);

    const title = titles[0] || "Untitled";
    const author =
      creators.length > 0 ? creators.join(", ") : "Unknown author";
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
        href: el.getAttribute("href") || "",
        mediaType: el.getAttribute("media-type") || "",
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
        // Skip nonlinear items (auxiliary content) by default
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

    // Find OPF via container.xml
    const containerFile = zip.file("META-INF/container.xml");
    if (!containerFile) {
      throw new Error("Missing META-INF/container.xml — not a valid EPUB.");
    }
    const containerXml = await containerFile.async("text");
    const containerDoc = new DOMParser().parseFromString(
      containerXml,
      "application/xml"
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

    const chunks = [];
    for (const item of spineItems) {
      if (!isXhtmlMediaType(item.mediaType)) continue;
      const filePath = resolvePath(basePath, item.href);
      const file = zip.file(filePath);
      if (!file) continue;
      const html = await file.async("text");
      const text = extractTextFromXhtml(html);
      if (text && text.trim()) {
        chunks.push(text);
      }
      // Yield to UI thread between files for big books
      if (chunks.length % 5 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    const fullText = normalizeText(chunks.join("\n\n"));
    if (!fullText.trim()) {
      throw new Error("No text content found in this EPUB.");
    }

    return {
      title: meta.title,
      author: meta.author,
      text: fullText,
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
      state.text = result.text;
      state.fileName = sanitizeFilename(file.name);
      els.bookTitle.textContent = result.title;
      els.bookAuthor.textContent = `by ${result.author}`;
      els.textEditor.value = result.text;
      updateStats(result.text);
      hideError();
      showEditor();
      // Move focus to the editor for immediate editing
      els.textEditor.focus();
      els.textEditor.setSelectionRange(0, 0);
    } catch (err) {
      console.error("EPUB parse error:", err);
      if (myParse.canceled) return;
      const msg =
        (err && err.message) ||
        "Something went wrong while parsing this EPUB.";
      showError(msg);
    }
  }

  /* ---------- Stats ---------- */
  let statsTimer = 0;
  function updateStats(text) {
    // Debounce for very large texts
    clearTimeout(statsTimer);
    statsTimer = setTimeout(() => {
      const chars = text.length;
      const words = (text.match(/\S+/g) || []).length;
      const lines = text ? text.split("\n").length : 0;
      const readMin = Math.max(1, Math.round(words / 200));
      els.charCount.textContent = formatNumber(chars);
      els.wordCount.textContent = formatNumber(words);
      els.lineCount.textContent = formatNumber(lines);
      els.readTime.textContent = readMin;
    }, 60);
  }
  function formatNumber(n) {
    return n.toLocaleString(undefined, { useGrouping: true });
  }

  /* ---------- Download / Copy ---------- */
  function downloadTxt() {
    const text = els.textEditor.value;
    if (!text) {
      showToast("Nothing to download yet", true);
      return;
    }
    // Prepend UTF-8 BOM for better Windows Notepad compatibility
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
    const text = els.textEditor.value;
    if (!text) {
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
    // Fallback for non-secure contexts
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
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files"))
      return;
    e.preventDefault();
    dragCounter++;
    dz.classList.add("is-dragging");
  });
  dz.addEventListener("dragover", (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files"))
      return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
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
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // Allow dropping anywhere on the page when the dropzone is visible
  window.addEventListener("dragover", (e) => {
    if (!els.dropzone.hidden && e.dataTransfer) e.preventDefault();
  });
  window.addEventListener("drop", (e) => {
    if (!els.dropzone.hidden && e.dataTransfer && e.dataTransfer.files[0]) {
      e.preventDefault();
      handleFile(e.dataTransfer.files[0]);
    }
  });

  els.fileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
    // Reset value so the same file can be picked again
    e.target.value = "";
  });

  els.errorDismiss.addEventListener("click", hideError);
  els.newFileBtn.addEventListener("click", reset);
  els.copyBtn.addEventListener("click", copyText);
  els.downloadBtn.addEventListener("click", downloadTxt);

  els.textEditor.addEventListener("input", (e) => {
    updateStats(e.target.value);
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    const isMod = e.ctrlKey || e.metaKey;
    if (!isMod) return;
    const key = e.key.toLowerCase();
    // Ctrl/Cmd+S → download
    if (key === "s" && !els.editor.hidden) {
      e.preventDefault();
      downloadTxt();
    }
    // Ctrl/Cmd+Shift+C → copy
    else if (key === "c" && e.shiftKey && !els.editor.hidden) {
      e.preventDefault();
      copyText();
    }
  });

  // Initial state
  reset();
})();
