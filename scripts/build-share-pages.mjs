import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_URL = (process.env.SITE_URL || "https://example.com").replace(
  /\/+$/,
  "",
);
const OUT_DIR = path.join(root, "b");

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

function absolute(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${SITE_URL}/${url.replace(/^\/+/, "")}`;
}

// Use "description" from books.json, else the first real paragraph of the text.
async function describe(book) {
  if (typeof book.description === "string" && book.description.trim()) {
    const text = book.description.trim().replace(/\s+/g, " ");
    if (text.length <= 180) return text;
    return text.slice(0, 181).replace(/\s+\S*$/, "") + "…";
  }
  try {
    const raw = await readFile(
      path.join(root, book.file || `books/${book.id}.txt`),
      "utf8",
    );
    const blocks = raw.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
    for (const block of blocks) {
      const text = block
        .split("\n")
        .map((l) => l.trim())
        .filter(
          (l) =>
            l &&
            !/^-{3}/.test(l) &&
            !/^(chapter|part|book|section)\b.{0,20}$/i.test(l),
        )
        .join(" ");
      if (text.length >= 60) {
        if (text.length <= 170) return text;
        return text.slice(0, 170).replace(/\s+\S*$/, "") + "…";
      }
    }
  } catch {}
  return "Read this story on 3NDING.";
}

function page(book, description) {
  const id = encodeURIComponent(book.id);
  const url = `${SITE_URL}/b/${id}/`;
  const image = absolute(book.cover);
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
  ${image ? `<meta property="og:image" content="${esc(image)}" />` : ""}
  <meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />

  <link rel="stylesheet" href="../../css/index.css" />
  <link rel="stylesheet" href="../../css/share.css" />
  <link rel="preload" href="../../fonts/fraunces.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="icon" type="image/png" sizes="32x32" href="../../favicon-32x32.png" />
</head>
<body>
  <div class="share-shell">
    <div class="share-top">
      <a class="share-brand" href="../../index.html">3NDING</a>
      <a class="share-back" href="../../index.html">Archive</a>
    </div>

    <main class="share-page">
      <article class="share-card">
        <div class="share-cover">
          <div class="share-cover-frame">
            ${book.cover ? `<img src="${esc(book.cover)}" alt="Cover of ${esc(book.title)}" width="300" height="400" />` : `<div class="share-cover-fallback" aria-hidden="true">${esc(book.title)}</div>`}
          </div>
        </div>

        <div class="share-details">
          <p class="share-kicker">No. ${String(book.no || 0).padStart(4, "0")}</p>
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

  <script>
    // Cover fallback: swap a failed image for a styled title block.
    const img = document.querySelector(".share-cover-frame img");
    if (img) {
      img.addEventListener("error", () => {
        const f = document.createElement("div");
        f.className = "share-cover-fallback";
        f.setAttribute("aria-hidden", "true");
        f.textContent = document.querySelector(".share-title").textContent;
        img.replaceWith(f);
      }, { once: true });
    }

    // Show "Continue reading" and a progress bar if this device has progress.
    try {
      const p = JSON.parse(localStorage.getItem("ending:progress:" + ${JSON.stringify(book.id)}) || "null");
      if (p && Number.isFinite(p.updatedAt)) {
        document.getElementById("readLink").textContent = "Continue reading";
        const pct = Math.round(Math.min(99, Math.max(0, Number(p.progressPercent) || 0)));
        if (pct >= 1) {
          document.getElementById("progress").hidden = false;
          document.getElementById("progressLabel").textContent = pct + "% read";
          document.getElementById("progressFill").style.width = pct + "%";
        }
      }
    } catch {}
  </script>
</body>
</html>
`;
}

const books = JSON.parse(await readFile(path.join(root, "books.json"), "utf8"));
await rm(OUT_DIR, { recursive: true, force: true }); // removed books lose their pages
let count = 0;
for (const book of books) {
  if (!book || !/^[\w-]{1,100}$/.test(book.id || "") || !book.title) continue;
  const dir = path.join(OUT_DIR, book.id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "index.html"),
    page(book, await describe(book)),
  );
  count++;
}
console.log(`Wrote ${count} share pages to b/`);
