export function createArchiveSharing(shareStatus) {
  function showStatus(message) {
    shareStatus.textContent = message;
    shareStatus.hidden = false;
    clearTimeout(showStatus.timer);
    showStatus.timer = setTimeout(() => {
      shareStatus.hidden = true;
    }, 3500);
  }

  async function copyBookLink(url) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        return true;
      } catch {
        // Try the legacy copy method if clipboard access is denied.
      }
    }

    const input = document.createElement("textarea");
    input.value = url;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    let copied = false;
    try {
      input.select();
      copied = document.execCommand("copy");
    } finally {
      input.remove();
    }
    return copied;
  }

  async function shareBook(book) {
    const url = new URL("reader.html", location.href);
    url.searchParams.set("id", book.id);
    const shareData = {
      title: book.title,
      text: `Read "${book.title}" by ${book.author} on 3NDING.`,
      url: url.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        showStatus(`Shared "${book.title}".`);
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }

    try {
      if (await copyBookLink(url.href)) {
        showStatus(`Link to "${book.title}" copied.`);
        return;
      }
    } catch {
      // Offer manual copying if both browser sharing and clipboard access fail.
    }

    window.prompt(`Copy the link to "${book.title}":`, url.href);
  }

  function createShareButton(book) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "share-btn";
    button.setAttribute("aria-label", `Share ${book.title}`);
    button.title = `Share ${book.title}`;
    button.innerHTML = `
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="m8.7 10.6 6.6-4.2M8.7 13.4l6.6 4.2" />
      </svg>`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      shareBook(book);
    });
    return button;
  }

  return { createShareButton };
}
