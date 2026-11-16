import { shareBook } from "./shared.js";

export function createArchiveSharing(shareStatus) {
  let statusTimer;

  function showStatus(message) {
    shareStatus.textContent = message;
    shareStatus.hidden = false;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      shareStatus.hidden = true;
    }, 3500);
  }

  async function handleShare(book) {
    const result = await shareBook(book);
    if (result.status === "shared") {
      showStatus(`Shared "${book.title}".`);
    } else if (result.status === "copied") {
      showStatus(`Link to "${book.title}" copied.`);
    } else if (result.status === "failed") {
      window.prompt(`Copy the link to "${book.title}":`, result.url);
    }
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
      handleShare(book);
    });
    return button;
  }

  return { createShareButton };
}
