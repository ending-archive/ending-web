import { escapeHtml } from "./index-utils.js";

export function createCatalogCards({
  grid,
  continueShelf,
  continueGrid,
  getCatalogNo,
  getProgress,
  isFavorite,
  isFinishedProgress,
  isNewArrival,
  toggleFavorite,
  createShareButton,
}) {
  function renderSkeletons(count) {
    grid.innerHTML = "";
    for (let i = 0; i < count; i++) {
      const card = document.createElement("div");
      card.className = "card skeleton";
      card.innerHTML = `
        <div class="cover-wrap"></div>
        <div class="card-body">
          <div class="line"></div>
          <div class="line short"></div>
        </div>
      `;
      grid.appendChild(card);
    }
  }

  function renderBooks(books) {
    grid.innerHTML = "";
    books.forEach((book, index) => {
      const title = escapeHtml(book.title);
      const author = escapeHtml(book.author);
      const cover = escapeHtml(book.cover);
      const id = String(book.id);
      const active = isFavorite(id);
      const completed = isFinishedProgress(getProgress(book));
      const card = document.createElement("article");
      card.dataset.id = id;
      const catalogNo = getCatalogNo().get(id) || 0;
      card.className = "card";
      card.style.animationDelay = `${Math.min(index * 40, 400)}ms`;
      const cardLink = document.createElement("a");
      cardLink.href = `reader.html?id=${encodeURIComponent(book.id)}`;
      cardLink.setAttribute(
        "aria-label",
        `${book.title} by ${book.author}${completed ? ", Finished; read again?" : ""}`,
      );
      card.title = `${book.title} by ${book.author}${completed ? ", Finished; read again?" : ""}`;
      cardLink.className = "card-link";
      cardLink.innerHTML = `
        <div class="cover-wrap">
          <img src="${cover}" alt="Cover of ${title}" loading="lazy">
          ${completed ? '<span class="card-state">Finished</span>' : ""}
        </div>
        <div class="card-body">
          <p class="card-title">${title}</p>
          <p class="card-author">${author}</p>
        </div>
        <div class="slip">
          <span>No. ${String(catalogNo).padStart(4, "0")}</span>
          ${isNewArrival(book) ? '<span class="arrival-badge">New</span>' : ""}
        </div>
      `;
      const favoriteButton = document.createElement("button");
      favoriteButton.type = "button";
      favoriteButton.className = `fav-btn${active ? " active" : ""}`;
      favoriteButton.dataset.id = id;
      favoriteButton.innerHTML = `
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
        </svg>`;
      favoriteButton.setAttribute("aria-pressed", String(active));
      favoriteButton.setAttribute(
        "aria-label",
        active ? "Remove from favorites" : "Add to favorites",
      );
      favoriteButton.title = active
        ? "Remove from favorites"
        : "Add to favorites";
      favoriteButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleFavorite(id);
      });

      card.append(cardLink, favoriteButton, createShareButton(book));
      grid.appendChild(card);
    });
  }

  function renderContinueReading(books) {
    const reading = [];
    books.forEach((book) => {
      const progress = getProgress(book);
      if (!progress) return;
      if (
        !Number.isInteger(progress.chapterIndex) ||
        !Number.isFinite(progress.updatedAt)
      ) {
        return;
      }

      if (isFinishedProgress(progress)) return;

      const storedPercent = Number(progress.progressPercent);
      const legacyFraction = Number(progress.scrollFraction);
      const hasStoredPercent =
        Number.isFinite(storedPercent) &&
        storedPercent >= 0 &&
        storedPercent <= 100;
      const percent = hasStoredPercent
        ? storedPercent
        : Math.min(100, Math.max(0, legacyFraction * 100));
      if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) return;

      reading.push({
        book,
        chapterIndex: progress.chapterIndex,
        updatedAt: progress.updatedAt,
        percent,
        hasStoredPercent,
      });
    });

    reading.sort((a, b) => b.updatedAt - a.updatedAt);
    const recent = reading.slice(0, 3);
    continueGrid.replaceChildren();
    continueShelf.hidden = recent.length === 0;

    recent.forEach(({ book, chapterIndex, percent, hasStoredPercent }) => {
      const card = document.createElement("article");
      card.className = "continue-card";
      const link = document.createElement("a");
      link.className = "continue-card-link";
      link.href = `reader.html?id=${encodeURIComponent(book.id)}`;
      link.setAttribute(
        "aria-label",
        hasStoredPercent
          ? `Continue reading ${book.title} by ${book.author}, ${Math.round(percent)} percent`
          : `Continue reading ${book.title} by ${book.author}, chapter ${chapterIndex + 1}, ${Math.round(percent)} percent through the chapter`,
      );

      const cover = document.createElement("img");
      cover.className = "continue-cover";
      cover.src = book.cover;
      cover.alt = "";
      cover.loading = "lazy";

      const details = document.createElement("span");
      details.className = "continue-details";

      const title = document.createElement("span");
      title.className = "continue-title";
      title.textContent = book.title;

      const author = document.createElement("span");
      author.className = "continue-author";
      author.textContent = book.author;

      const progressLabel = document.createElement("span");
      progressLabel.className = "continue-progress-label";
      progressLabel.textContent = hasStoredPercent
        ? `${Math.round(percent)}% read`
        : `Chapter ${chapterIndex + 1}`;

      const track = document.createElement("span");
      track.className = "continue-track";
      track.setAttribute("role", "progressbar");
      track.setAttribute(
        "aria-label",
        hasStoredPercent
          ? `${book.title} reading progress`
          : `${book.title} chapter ${chapterIndex + 1} progress`,
      );
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", "100");
      track.setAttribute("aria-valuenow", String(Math.round(percent)));

      const fill = document.createElement("span");
      fill.className = "continue-fill";
      fill.style.width = `${percent}%`;
      track.append(fill);
      details.append(title, author, progressLabel, track);
      link.append(cover, details);
      card.append(link, createShareButton(book));
      continueGrid.append(card);
    });
  }

  function updateCompletionStates() {
    grid.querySelectorAll(".card").forEach((card) => {
      const cover = card.querySelector(".cover-wrap");
      const finished = isFinishedProgress(getProgress({ id: card.dataset.id }));
      const link = card.querySelector(".card-link");
      let state = cover.querySelector(".card-state");

      if (finished && !state) {
        state = document.createElement("span");
        state.className = "card-state";
        state.textContent = "Finished";
        cover.append(state);
      } else if (!finished) {
        state?.remove();
      }

      const title = card.querySelector(".card-title").textContent;
      const author = card.querySelector(".card-author").textContent;
      link.setAttribute(
        "aria-label",
        `${title} by ${author}${finished ? ", Finished; read again?" : ""}`,
      );
      link.title = `${title} by ${author}${finished ? ", Finished; read again?" : ""}`;
    });
  }

  return {
    renderSkeletons,
    renderBooks,
    renderContinueReading,
    updateCompletionStates,
  };
}
