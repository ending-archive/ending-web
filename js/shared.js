const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// Returns true when the text was copied.
export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the selection-based fallback.
    }
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  let copied = false;
  try {
    input.select();
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    input.remove();
  }
  return copied;
}

export function bookUrl(id) {
  const url = new URL("reader.html", location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("id", id);
  return url.href;
}

// Resolves to { status: "shared" | "copied" | "cancelled" | "failed", url }.
export async function shareBook(book) {
  const url = bookUrl(book.id);
  const shareData = {
    title: book.title,
    text: `Read "${book.title}" by ${book.author} on 3NDING.`,
    url,
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return { status: "shared", url };
    } catch (error) {
      if (error.name === "AbortError") return { status: "cancelled", url };
    }
  }

  if (await copyText(url)) return { status: "copied", url };
  return { status: "failed", url };
}
