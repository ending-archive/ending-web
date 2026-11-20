import { readFile, writeFile, mkdir, rm, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load JSZip for reading EPUBs
await import("../js/jszip.min.js");
const JSZip = globalThis.JSZip;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(root, "b");

// ---------- config: SITE_URL is required (no placeholder domain) ----------
function readSiteUrl() {
  const value = (process.env.SITE_URL || "https://ending-web.pages.dev")
    .trim()
    .replace(/\/+$/, "");
  if (!value) {
    console.error(
      "SITE_URL is required, e.g.\n  SITE_URL=https://your-domain.com npm run build:share",
    );
    process.exit(1);
  }
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) throw new Error("bad protocol");
  } catch {
    console.error(`SITE_URL is not a valid http(s) URL: "${value}"`);
    process.exit(1);
  }
  return value;
}

const SITE_URL = readSiteUrl();

// ---------- helpers ----------
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const isAbsoluteUrl = (url) =>
  /^(https?:)?\/\//i.test(url) || /^data:/i.test(url);

// Absolute URL for og:image / twitter:image.
function absolute(url) {
  if (!url) return "";
  if (/^\/\//.test(url)) return `https:${url}`;
  if (isAbsoluteUrl(url)) return url;
  return `${SITE_URL}/${url.replace(/^\/+/, "")}`;
}

// URL usable from b/<id>/index.html. Local paths are relative to the site root,
// so they need "../../" to resolve correctly from the share page.
function assetHref(url) {
  if (!url) return "";
  if (isAbsoluteUrl(url)) return url;
  return `../../${url.replace(/^\/+/, "")}`;
}

// Decode basic XML entities
const unescapeXml = (s) =>
  String(s || "")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

// Resolve a book's file and make sure it stays inside the project.
function bookFilePath(book) {
  const rel = book.file || `books/${book.id}.epub`;
  const full = path.resolve(root, rel);
  return full.startsWith(root + path.sep) ? full : null;
}

// Keep in sync with validateBooks() in js/index-utils.js so catalog numbers,
// skipped entries and duplicate handling match what the archive page shows.
function validateBooks(raw) {
  const books = [];
  const problems = [];
  const seen = new Set();

  raw.forEach((entry, i) => {
    const where = `books.json[${i}]`;
    if (!entry || typeof entry !== "object") {
      problems.push(`${where}: not an object`);
      return;
    }
    const id = typeof entry.id === "string" ? entry.id : "";
    if (!/^[\w-]{1,100}$/.test(id)) {
      problems.push(`${where}: missing or invalid id`);
      return;
    }
    if (seen.has(id)) {
      problems.push(`${where}: duplicate id "${id}" (skipped)`);
      return;
    }
    if (typeof entry.title !== "string" || !entry.title.trim()) {
      problems.push(`${where} (${id}): missing title`);
      return;
    }
    seen.add(id);
    books.push({
      ...entry,
      author:
        typeof entry.author === "string" && entry.author.trim()
          ? entry.author
          : "Unknown author",
      cover: typeof entry.cover === "string" ? entry.cover : "",
    });
  });

  return { books, problems };
}

// Extract description from EPUB (metadata or first real paragraph)
async function extractEpubDescription(filePath) {
  try {
    const buf = await readFile(filePath);
    const zip = await JSZip.loadAsync(buf);
    const containerFile = zip.file("META-INF/container.xml");
    if (!containerFile) return null;
    const containerXml = await containerFile.async("text");
    const opfMatch = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i);
    if (!opfMatch) return null;
    const opfPath = opfMatch[1];
    const opfFile = zip.file(opfPath);
    if (!opfFile) return null;
    const opfXml = await opfFile.async("text");

    const descMatch = opfXml.match(/<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i);
    if (descMatch && descMatch[1].trim()) {
      const desc = unescapeXml(descMatch[1].replace(/<[^>]+>/g, "").trim().replace(/\s+/g, " "));
      if (desc.length >= 20) {
        return desc.length <= 170 ? desc : desc.slice(0, 170).replace(/\s+\S*$/, "") + "…";
      }
    }

    const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
    const spineMatch = opfXml.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
    if (!spineMatch) return null;
    const itemrefMatches = [...spineMatch[1].matchAll(/<itemref\b[^>]*\bidref\s*=\s*["']([^"']+)["']/gi)];
    for (const ref of itemrefMatches) {
      const idref = ref[1];
      const itemMatch = opfXml.match(new RegExp(`<item\\b[^>]*\\bid\\s*=\\s*["']${idref}["'][^>]*\\bhref\\s*=\\s*["']([^"']+)["']`, "i"))
        || opfXml.match(new RegExp(`<item\\b[^>]*\\bhref\\s*=\\s*["']([^"']+)["'][^>]*\\bid\\s*=\\s*["']${idref}["']`, "i"));
      if (!itemMatch) continue;
      const href = itemMatch[1];
      const fullPath = opfDir ? path.posix.join(opfDir, href) : href;
      const chFile = zip.file(fullPath);
      if (!chFile) continue;
      const html = await chFile.async("text");
      const pMatches = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
      for (const p of pMatches) {
        const text = unescapeXml(p[1].replace(/<[^>]+>/g, "").trim().replace(/\s+/g, " "));
        if (text.length >= 60) {
          return text.length <= 170 ? text : text.slice(0, 170).replace(/\s+\S*$/, "") + "…";
        }
      }
    }
  } catch {}
  return null;
}

// Use "description" from books.json, else extract from EPUB file.
async function describe(book) {
  if (typeof book.description === "string" && book.description.trim()) {
    const text = book.description.trim().replace(/\s+/g, " ");
    if (text.length <= 180) return text;
    return text.slice(0, 181).replace(/\s+\S*$/, "") + "…";
  }
  const file = bookFilePath(book);
  if (file) {
    const extracted = await extractEpubDescription(file);
    if (extracted) return extracted;
  }
  return "Read this story on 3NDING.";
}

// ---------- page template ----------
// All behavior (cover fallback, continue-reading, progress bar) lives in
// js/share.js, so changing it never requires regenerating these pages.
function page(book, description) {
  const id = encodeURIComponent(book.id);
  const url = `${SITE_URL}/b/${id}/`;
  const ogImage = absolute(book.cover);
  const coverSrc = assetHref(book.cover);
  const byline =
    book.author && book.author !== "Unknown author" ? `by ${book.author}` : "";
  const title = `${book.title}${byline ? " " + byline : ""} | 3NDING`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="theme-color" content="#171b21" />
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${esc(url)}" />

  <meta property="og:type" content="book" />
  <meta property="og:site_name" content="3NDING" />
  <meta property="og:title" content="${esc(book.title)}" />
  <meta property="og:description" content="${esc(byline ? byline + " — " + description : description)}" />
  <meta property="og:url" content="${esc(url)}" />
  ${ogImage ? `<meta property="og:image" content="${esc(ogImage)}" />\n  <meta name="twitter:image" content="${esc(ogImage)}" />` : ""}
  <meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}" />

  <link rel="stylesheet" href="../../css/index.css" />
  <link rel="stylesheet" href="../../css/share.css" />
  <link rel="preload" href="../../fonts/fraunces.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="icon" type="image/png" sizes="32x32" href="../../favicon-32x32.png" />
</head>
<body data-book-id="${esc(book.id)}">
  <div class="share-shell">
    <div class="share-top">
      <a class="share-brand" href="../../index.html">3NDING</a>
      <a class="share-back" href="../../index.html">Archive</a>
    </div>

    <main class="share-page">
      <article class="share-card">
        <div class="share-cover">
          <div class="share-cover-frame">
            ${coverSrc ? `<img src="${esc(coverSrc)}" alt="Cover of ${esc(book.title)}" width="300" height="400" />` : `<div class="share-cover-fallback" aria-hidden="true">${esc(book.title)}</div>`}
          </div>
        </div>

        <div class="share-details">
          <p class="share-kicker">No. ${String(book.no).padStart(4, "0")}</p>
          <h1 class="share-title">${esc(book.title)}</h1>
          ${byline ? `<p class="share-author">${esc(byline)}</p>` : ""}
          <p class="share-blurb">${esc(description)}</p>

          <div class="share-progress" id="progress" hidden>
            <span class="share-progress-label" id="progressLabel"></span>
            <span class="share-track"><span class="share-fill" id="progressFill"></span></span>
          </div>

          <a class="share-read" id="readLink" href="../../reader.html?id=${id}">Start reading</a>
        </div>
      </article>
    </main>

  </div>

  <script type="module" src="../../js/share.js"></script>
</body>
</html>
`;
}

// ---------- main ----------
let raw;
try {
  raw = JSON.parse(await readFile(path.join(root, "books.json"), "utf8"));
} catch (err) {
  console.error(`Could not read books.json: ${err.message}`);
  process.exit(1);
}
if (!Array.isArray(raw)) {
  console.error("books.json must be a list of books");
  process.exit(1);
}

const { books, problems } = validateBooks(raw);
problems.forEach((p) => console.warn(`[warn] ${p}`));

await rm(OUT_DIR, { recursive: true, force: true }); // removed books lose their pages

let count = 0;
for (const [i, entry] of books.entries()) {
  // Same fallback as js/index.js: missing/invalid "no" becomes position + 1.
  const book = {
    ...entry,
    no: Number.isInteger(entry.no) && entry.no > 0 ? entry.no : i + 1,
  };

  const file = bookFilePath(book);
  if (!file) {
    console.warn(`[warn] ${book.id}: "file" points outside the project`);
  } else {
    await access(file).catch(() =>
      console.warn(
        `[warn] ${book.id}: book file not found (${path.relative(root, file)})`,
      ),
    );
  }

  const dir = path.join(OUT_DIR, book.id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "index.html"),
    page(book, await describe(book)),
  );
  count++;
}

console.log(`Wrote ${count} share pages to b/ (SITE_URL=${SITE_URL})`);
