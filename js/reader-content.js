export function escapeHtml(str) {
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

const EXPLICIT_RE = /^-{3}\s*([^\s-].*?)\s*-{3}$/;

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
const BARE_NUM_RE = new RegExp(`^(?:\\d{1,4}|${ROMAN.toUpperCase()})\\.?$`);
const CJK_RE = /^第\s*[0-9一二三四五六七八九十百零〇]+\s*[章話话節节回幕部]/;

function isImplicitHeading(line) {
  if (!line || line.length > 80) return false;
  return (
    KEYWORD_RE.test(line) ||
    SPECIAL_RE.test(line) ||
    BARE_NUM_RE.test(line) ||
    CJK_RE.test(line)
  );
}

export function parseBook(raw, fallbackTitle) {
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

  const headings = explicit.length ? explicit : implicit;
  if (!headings.length) return wholeBook;

  const result = [];
  const preamble = lines.slice(0, headings[0].index).join("\n").trim();
  if (preamble.length > 300) {
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
  const average = lines.reduce((length, line) => length + line.length, 0) / lines.length;
  if (average < 50)
    return `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
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
        /^<p>/,
        `<p data-paragraph="${paragraphIndex}">`,
      );
      paragraphIndex += 1;
      return html;
    })
    .join("");
}
