import { shareBook } from "./shared.js";

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createReaderSharing({ bookId, getBookMeta, el, showToast }) {
  el.shareBtn.addEventListener("click", async () => {
    const bookMeta = getBookMeta();
    if (!bookMeta || !bookId) return;

    const result = await shareBook({ ...bookMeta, id: bookId });
    if (result.status === "shared") showToast("Book shared.");
    else if (result.status === "copied")
      showToast("Book link copied to clipboard.");
    else if (result.status === "failed")
      showToast("Unable to copy the book link.");
  });
}
