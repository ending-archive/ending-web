import { escapeHtml } from "./shared.js";

export { escapeHtml };

const EXPLICIT_RE = /^-{3}\s*(?=[^-]*[\p{L}\p{N}])([^\s-].*?)\s*-{3}$/u;

const WORD_NUM =
  "(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|hundred";
const ROMAN =
  "(?=[ivxlcdm])m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})";
const NUM = `(?:\\d+|${WORD_NUM}|${ROMAN})`;
const KEYWORDS =
  "chapter|chap|part|book|section|volume|vol|act|kabanata|cap[ií]tulo|chapitre|kapitel|capitolo";

const KEYWORD_RE = new RegExp(
  `^(?:${KEYWORDS})\\.?\\s+${NUM}\\b(?:\\s*[.:\\-\\u2013\\u2014)]\\s*.*|\\s+[^.!?]{1,60})?$`,
  "i",
);
const SPECIAL_RE =
  /^(?:prologue|epilogue|preface|foreword|introduction|afterword|interlude|author'?s note)(?:\s*[:.\u2013\u2014-]\s*.{1,60})?$/i;
const BARE_NUM_RE = new RegExp(
  `^(?:\\d{1,3}|(?![LCDM]\\.?$)${ROMAN.toUpperCase()})\\.?$`,
);
const CJK_RE = /^第\s*[0-9一二三四五六七八九十百零〇]+\s*[章話话節节回幕部]/;

const WORD_NUM_RE = new RegExp(`^(?:${WORD_NUM})$`, "i");

function numberTokenIsPlausible(line) {
  const match = line.match(/^[^\s.]+\.?\s+([^\s.:\-\u2013\u2014)]+)/);
  if (!match) return true;
  const token = match[1];
  if (/^\d+$/.test(token) || WORD_NUM_RE.test(token)) return true;
  return token === token.toUpperCase();
}

function isImplicitHeading(line) {
  if (!line || line.length > 80) return false;
  return (
    (KEYWORD_RE.test(line) && numberTokenIsPlausible(line)) ||
    SPECIAL_RE.test(line) ||
    BARE_NUM_RE.test(line) ||
    CJK_RE.test(line)
  );
}

export function parseBookRaw(raw, fallbackTitle) {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const wholeBook = [{ title: fallbackTitle, text: text.trim() }];

  const explicit = [];
  const implicit = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const match = line.match(EXPLICIT_RE);
    if (match) {
      explicit.push({ index: i, title: match[1].trim() });
      continue;
    }

    const prevBlank = i === 0 || lines[i - 1].trim() === "";
    const nextBlank = i === lines.length - 1 || lines[i + 1].trim() === "";
    if (prevBlank && nextBlank && isImplicitHeading(line)) {
      implicit.push({ index: i, title: line });
    }
  }

  const headings = explicit.length
    ? explicit
    : implicit.length >= 2
      ? implicit
      : [];
  if (!headings.length) return wholeBook;

  const result = [];
  const preamble = lines.slice(0, headings[0].index).join("\n").trim();
  if (preamble && (explicit.length > 0 || preamble.length > 300)) {
    result.push({ title: "Beginning", text: preamble });
  }

  headings.forEach((heading, index) => {
    const end =
      index + 1 < headings.length ? headings[index + 1].index : lines.length;
    const body = lines
      .slice(heading.index + 1, end)
      .join("\n")
      .trim();
    result.push({ title: heading.title, text: body });
  });

  const nonEmpty = result.filter((chapter) => chapter.text);
  return nonEmpty.length ? nonEmpty : wholeBook;
}

function blockToHtml(block) {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 1) return `<p>${escapeHtml(lines[0])}</p>`;
  const average =
    lines.reduce((length, line) => length + line.length, 0) / lines.length;
  if (average < 50)
    return `<p class="verse">${lines.map(escapeHtml).join("<br>")}</p>`;
  return `<p>${escapeHtml(lines.join(" "))}</p>`;
}

export function paragraphize(text) {
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  let paragraphIndex = 0;
  if (blocks.length === 1) {
    const lines = blocks[0]
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 1 && lines.some((line) => line.length > 100)) {
      return lines
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
        /^<p/,
        `<p data-paragraph="${paragraphIndex}"`,
      );
      paragraphIndex += 1;
      return html;
    })
    .join("");
}

function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

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

/* ---------- EPUB Parser ---------- */

async function getJSZip() {
  if (typeof window !== "undefined" && window.JSZip) return window.JSZip;
  if (typeof globalThis !== "undefined" && globalThis.JSZip) return globalThis.JSZip;
  try {
    const targetUrl = new URL("./jszip.min.js", import.meta.url).href;
    await import(targetUrl);
    return (
      (typeof window !== "undefined" && window.JSZip) ||
      (typeof globalThis !== "undefined" && globalThis.JSZip) ||
      null
    );
  } catch (e) {
    throw new Error("JSZip could not be loaded: " + e.message);
  }
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

function unescapeXml(s) {
  return String(s || "")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function normalizeText(text) {
  if (!text) return "";
  return text
    .replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " ")
    .replace(/\t/g, " ")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/ +\n/g, "\n")
    .replace(/ {2,}/g, " ")
    .replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n")
    .replace(/\n +/g, "\n")
    .trim();
}

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "details", "div", "dl", "dt", "dd",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4",
  "h5", "h6", "header", "hr", "li", "main", "nav", "p", "pre", "section", "table",
  "thead", "tbody", "tfoot", "tr", "caption", "ul", "ol"
]);

const SKIP_TAGS = new Set([
  "script", "style", "head", "svg", "math", "iframe", "object", "video", "audio",
  "noscript", "template"
]);

function extractTextFromDomNode(node) {
  let out = "";
  const children = node.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.nodeType === 3 /* Node.TEXT_NODE */) {
      out += child.nodeValue;
    } else if (child.nodeType === 1 /* Node.ELEMENT_NODE */) {
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
      out += extractTextFromDomNode(child);
      if (BLOCK_TAGS.has(tag)) out += "\n\n";
    }
  }
  return out;
}

function extractTextFromHtmlFallback(html) {
  let clean = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<head\b[\s\S]*?<\/head>/gi, "");

  clean = clean.replace(/<br\s*\/?>/gi, "\n");
  clean = clean.replace(/<\/(?:p|div|h[1-6]|li|blockquote|section|article|header|footer)>/gi, "\n\n");
  clean = clean.replace(/<[^>]+>/g, "");
  return normalizeText(unescapeXml(clean));
}

function extractTextFromDocument(doc, html) {
  if (doc && doc.body) {
    const raw = extractTextFromDomNode(doc.body);
    return normalizeText(raw);
  }
  return extractTextFromHtmlFallback(html);
}

function parseXmlOrHtml(content, mimeType = "application/xhtml+xml") {
  if (typeof DOMParser !== "undefined") {
    let doc = new DOMParser().parseFromString(content, mimeType);
    if (doc.getElementsByTagName("parsererror").length > 0 && mimeType !== "text/html") {
      doc = new DOMParser().parseFromString(content, "text/html");
    }
    return doc;
  }
  return null;
}

function detectTitleFromDoc(doc, html, fallback) {
  if (doc) {
    const headings = doc.querySelectorAll("h1, h2, h3, [role='heading'], .chapter-title, .title");
    for (let i = 0; i < headings.length; i++) {
      const t = (headings[i].textContent || "").trim().replace(/\s+/g, " ");
      if (t && t.length <= 80) return t;
    }
    const docTitle = doc.querySelector("title");
    if (docTitle) {
      const t = (docTitle.textContent || "").trim().replace(/\s+/g, " ");
      if (t && t.length <= 80 && t !== "Table of Contents") return t;
    }
  } else {
    const hMatch = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
    if (hMatch) {
      const t = unescapeXml(hMatch[1].replace(/<[^>]+>/g, "").trim().replace(/\s+/g, " "));
      if (t && t.length <= 80) return t;
    }
    const tMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (tMatch) {
      const t = unescapeXml(tMatch[1].replace(/<[^>]+>/g, "").trim().replace(/\s+/g, " "));
      if (t && t.length <= 80 && t !== "Table of Contents") return t;
    }
  }
  return fallback;
}

export async function parseEpub(input, fallbackTitle = "Untitled") {
  const JSZip = await getJSZip();
  if (!JSZip) throw new Error("JSZip is not available.");

  let zip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch (err) {
    throw new Error("Could not unzip EPUB: " + err.message);
  }

  // 1. container.xml
  const containerFile = zip.file("META-INF/container.xml") || zip.file("meta-inf/container.xml");
  if (!containerFile) {
    throw new Error("Missing META-INF/container.xml — not a valid EPUB.");
  }
  const containerXml = await containerFile.async("text");
  let opfPath = "";
  const containerDoc = parseXmlOrHtml(containerXml, "application/xml");
  if (containerDoc) {
    const rf = containerDoc.querySelector("rootfile");
    if (rf) opfPath = rf.getAttribute("full-path") || "";
  }
  if (!opfPath) {
    const match = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i);
    if (match) opfPath = match[1];
  }
  if (!opfPath) {
    throw new Error("No rootfile full-path found in container.xml.");
  }

  // 2. OPF
  const opfFile = zip.file(opfPath);
  if (!opfFile) {
    throw new Error(`OPF file "${opfPath}" not found in archive.`);
  }
  const opfXml = await opfFile.async("text");
  const basePath = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const opfDoc = parseXmlOrHtml(opfXml, "application/xml");

  // Manifest
  const manifest = new Map();
  if (opfDoc) {
    const items = opfDoc.querySelectorAll("manifest > item, item");
    items.forEach((el) => {
      const id = el.getAttribute("id");
      const href = el.getAttribute("href");
      const media = el.getAttribute("media-type") || "";
      const props = el.getAttribute("properties") || "";
      if (id && href) manifest.set(id, { id, href, media, props });
    });
  } else {
    for (const m of opfXml.matchAll(/<item\b([^>]+?)\/?>/gi)) {
      const attrs = m[1];
      const id = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
      const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
      const media = attrs.match(/\bmedia-type\s*=\s*["']([^"']+)["']/i)?.[1] || "";
      const props = attrs.match(/\bproperties\s*=\s*["']([^"']+)["']/i)?.[1] || "";
      if (id && href) manifest.set(id, { id, href, media, props });
    }
  }

  // Spine
  const spineItems = [];
  if (opfDoc) {
    const refs = opfDoc.querySelectorAll("spine > itemref, itemref");
    refs.forEach((el) => {
      const idref = el.getAttribute("idref");
      const linear = el.getAttribute("linear");
      if (idref && linear !== "no" && manifest.has(idref)) {
        spineItems.push(manifest.get(idref));
      }
    });
  } else {
    const spineMatch = opfXml.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
    if (spineMatch) {
      for (const ref of spineMatch[1].matchAll(/<itemref\b([^>]+?)\/?>/gi)) {
        const idref = ref[1].match(/\bidref\s*=\s*["']([^"']+)["']/i)?.[1];
        const linear = ref[1].match(/\blinear\s*=\s*["']([^"']+)["']/i)?.[1];
        if (idref && linear !== "no" && manifest.has(idref)) {
          spineItems.push(manifest.get(idref));
        }
      }
    }
  }

  if (spineItems.length === 0) {
    throw new Error("EPUB has no readable spine items.");
  }

  // TOC
  const tocMap = new Map();
  // Try EPUB 3 Nav
  const navItem = [...manifest.values()].find((it) => it.props.split(/\s+/).includes("nav"));
  if (navItem) {
    try {
      const navPath = resolvePath(basePath, navItem.href);
      const navFile = zip.file(navPath);
      if (navFile) {
        const navHtml = await navFile.async("text");
        const navBase = navPath.includes("/") ? navPath.slice(0, navPath.lastIndexOf("/") + 1) : "";
        const navDoc = parseXmlOrHtml(navHtml, "application/xhtml+xml");
        if (navDoc) {
          const links = navDoc.querySelectorAll("nav a[href], a[href]");
          links.forEach((a) => {
            const rawHref = a.getAttribute("href") || "";
            const cleanHref = rawHref.split("#")[0];
            const resolved = resolvePath(navBase, cleanHref);
            const title = (a.textContent || "").trim().replace(/\s+/g, " ");
            if (resolved && title && !tocMap.has(resolved)) tocMap.set(resolved, title);
          });
        } else {
          for (const a of navHtml.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
            const rawHref = a[1].split("#")[0];
            const resHref = resolvePath(navBase, rawHref);
            const title = unescapeXml(a[2].replace(/<[^>]+>/g, "").trim().replace(/\s+/g, " "));
            if (resHref && title && !tocMap.has(resHref)) tocMap.set(resHref, title);
          }
        }
      }
    } catch {}
  }

  // Try EPUB 2 NCX
  const ncxItem = manifest.get("ncx") || [...manifest.values()].find((it) => it.media === "application/x-dtbncx+xml");
  if (ncxItem) {
    try {
      const ncxPath = resolvePath(basePath, ncxItem.href);
      const ncxFile = zip.file(ncxPath);
      if (ncxFile) {
        const ncxXml = await ncxFile.async("text");
        const ncxBase = ncxPath.includes("/") ? ncxPath.slice(0, ncxPath.lastIndexOf("/") + 1) : "";
        const ncxDoc = parseXmlOrHtml(ncxXml, "application/xml");
        if (ncxDoc) {
          const navPoints = ncxDoc.querySelectorAll("navPoint");
          navPoints.forEach((np) => {
            const contentEl = np.querySelector("content");
            const textEl = np.querySelector("text");
            if (contentEl && textEl) {
              const src = contentEl.getAttribute("src") || "";
              const cleanSrc = src.split("#")[0];
              const resolved = resolvePath(ncxBase, cleanSrc);
              const title = (textEl.textContent || "").trim().replace(/\s+/g, " ");
              if (resolved && title && !tocMap.has(resolved)) tocMap.set(resolved, title);
            }
          });
        } else {
          for (const np of ncxXml.matchAll(/<navPoint\b[\s\S]*?<\/navPoint>/gi)) {
            const contentMatch = np[0].match(/<content\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
            const textMatch = np[0].match(/<text\b[^>]*>([\s\S]*?)<\/text>/i);
            if (contentMatch && textMatch) {
              const rawHref = contentMatch[1].split("#")[0];
              const resHref = resolvePath(ncxBase, rawHref);
              const title = unescapeXml(textMatch[1].trim().replace(/\s+/g, " "));
              if (resHref && title && !tocMap.has(resHref)) tocMap.set(resHref, title);
            }
          }
        }
      }
    } catch {}
  }

  // Chapters
  const rawChapters = [];
  for (let idx = 0; idx < spineItems.length; idx++) {
    const item = spineItems[idx];
    const chPath = resolvePath(basePath, item.href);
    const chFile = zip.file(chPath);
    if (!chFile) continue;

    const html = await chFile.async("text");
    const doc = parseXmlOrHtml(html, "application/xhtml+xml");
    const text = extractTextFromDocument(doc, html);

    // Skip pages with almost no text (like blank separator or pure cover image pages)
    if (!text || text.length < 15) continue;

    const fallback = `Chapter ${rawChapters.length + 1}`;
    const title = tocMap.get(chPath) || detectTitleFromDoc(doc, html, fallback);
    rawChapters.push({ title, text });
  }

  const finalChapters = rawChapters.length > 0 ? rawChapters : [{ title: fallbackTitle, text: "" }];

  // Assign stable keys
  const seen = new Map();
  return finalChapters.map((chapter) => {
    const base = chapterKey(chapter.title, chapter.text);
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return { ...chapter, key: count > 1 ? `${base}-${count}` : base };
  });
}
