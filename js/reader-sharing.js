export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createReaderSharing({ bookId, getBookMeta, el, showToast }) {
  async function copyShareLink(url) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        return;
      } catch {
        // Continue to the selection-based fallback when clipboard access is denied.
      }
    }

    const input = document.createElement("textarea");
    input.value = url;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    let copied;
    try {
      input.select();
      copied = document.execCommand("copy");
    } finally {
      input.remove();
    }
    if (!copied) throw new Error("Copying the link is not supported.");
  }

  el.shareBtn.addEventListener("click", async () => {
    const bookMeta = getBookMeta();
    if (!bookMeta || !bookId) return;
    el.shareStatus.textContent = "";
    el.shareStatus.hidden = true;

    const url = new URL("reader.html", location.href);
    url.searchParams.set("id", bookId);
    const shareData = {
      title: bookMeta.title,
      text: `Read "${bookMeta.title}" by ${bookMeta.author} on 3NDING.`,
      url: url.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        showToast("Book shared.");
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }

    try {
      await copyShareLink(url.href);
      showToast("Book link copied to clipboard.");
    } catch {
      showToast("Unable to copy the book link.");
    }
  });
}
