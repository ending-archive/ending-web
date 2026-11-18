import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------- config: SITE_URL is required ----------
function readSiteUrl() {
  const value = (process.env.SITE_URL || "").trim().replace(/\/+$/, "");
  if (!value) {
    console.error(
      "SITE_URL is required, e.g.\n  SITE_URL=https://your-domain.com npm run build:seo",
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
const xmlEscape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );

// "2026-11-11" (or any parseable date) -> "2026-11-11", else null.
function toLastmod(value) {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
  return [
    "  <url>",
    `    <loc>${xmlEscape(loc)}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : null,
    priority ? `    <priority>${priority}</priority>` : null,
    "  </url>",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------- load books ----------
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

// Same rules as the share-page build, so the sitemap only lists pages that exist.
const seen = new Set();
const books = [];
for (const entry of raw) {
  if (!entry || typeof entry !== "object") continue;
  const id = typeof entry.id === "string" ? entry.id : "";
  if (!/^[\w-]{1,100}$/.test(id) || seen.has(id)) continue;
  if (typeof entry.title !== "string" || !entry.title.trim()) continue;
  seen.add(id);
  books.push(entry);
}

// ---------- sitemap.xml ----------
const bookDates = books.map((b) => toLastmod(b.addedAt)).filter(Boolean);
const newest = bookDates.length ? bookDates.sort().at(-1) : null;

const entries = [
  urlEntry({
    loc: `${SITE_URL}/`,
    lastmod: newest,
    changefreq: "weekly",
    priority: "1.0",
  }),
];

let missingShare = 0;
for (const book of books) {
  const sharePage = path.join(root, "b", book.id, "index.html");
  if (!(await exists(sharePage))) {
    missingShare++;
    console.warn(
      `[warn] ${book.id}: b/${book.id}/index.html not found, run build:share first (skipped)`,
    );
    continue;
  }
  entries.push(
    urlEntry({
      loc: `${SITE_URL}/b/${encodeURIComponent(book.id)}/`,
      lastmod: toLastmod(book.addedAt),
      changefreq: "monthly",
      priority: "0.8",
    }),
  );
}

// Static pages are only listed if the file exists, so we never advertise a 404.
for (const page of ["support.html", "terms.html", "privacy.html"]) {
  if (await exists(path.join(root, page))) {
    entries.push(
      urlEntry({
        loc: `${SITE_URL}/${page}`,
        changefreq: "yearly",
        priority: "0.3",
      }),
    );
  } else {
    console.warn(`[warn] ${page} not found, left out of the sitemap`);
  }
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`;

// ---------- robots.txt ----------
// reader.html?id=... is the same content as the share pages, which are the
// canonical entry points, so crawlers are steered to those instead.
const robots = `User-agent: *
Allow: /
Disallow: /reader.html

Sitemap: ${SITE_URL}/sitemap.xml
`;

await writeFile(path.join(root, "sitemap.xml"), sitemap);
await writeFile(path.join(root, "robots.txt"), robots);

console.log(
  `Wrote sitemap.xml (${entries.length} URLs) and robots.txt (SITE_URL=${SITE_URL})`,
);
if (missingShare) process.exitCode = 1;
