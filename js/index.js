import { createCatalogCards } from "./index-cards.js";
import {
  getProgress,
  loadFinishedBooks,
  loadFavorites,
  loadLibraryPage,
  saveFavorites,
  saveLibraryPage,
} from "./index-storage.js";
import {
  escapeHtml,
  isNewArrival,
  normalizeSearchText,
  sortBooksByAddedAt,
} from "./index-utils.js";
import { createArchiveSharing } from "./index-sharing.js";

function runArchive() {
  const grid = document.getElementById("grid");
  const continueShelf = document.getElementById("continueShelf");
  const continueGrid = document.getElementById("continueGrid");
  const status = document.getElementById("status");
  const searchRow = document.getElementById("searchRow");
  const searchInput = document.getElementById("searchInput");
  const noResults = document.getElementById("noResults");
  const shareStatus = document.getElementById("shareStatus");
  const favRow = document.getElementById("favRow");
  const favToggle = document.getElementById("favToggle");
  const favCount = document.getElementById("favCount");
  const finishedToggle = document.getElementById("finishedToggle");
  const finishedCount = document.getElementById("finishedCount");
  const pagination = document.getElementById("pagination");
  const pageStatus = document.getElementById("pageStatus");
  const prevPageBtn = document.getElementById("prevPageBtn");
  const nextPageBtn = document.getElementById("nextPageBtn");

  const SKELETON_COUNT = 8;
  const MIN_LOADING_MS = 300;
  const PAGE_SIZE = 8;

  let allBooks = [];
  let favorites = loadFavorites();
  let finishedBooks = loadFinishedBooks();
  let activeFilter = "all";
  let currentPage = loadLibraryPage();
  let lastMatches = [];
  let catalogNo = new Map();

  function isFavorite(id) {
    return favorites.has(String(id));
  }

  function isFinished(id) {
    return finishedBooks.has(String(id));
  }

  function updateFavCount() {
    favCount.textContent = allBooks.filter((b) => isFavorite(b.id)).length;
  }

  function updateFinishedCount() {
    finishedCount.textContent = allBooks.filter((book) =>
      finishedBooks.has(String(book.id)),
    ).length;
  }

  function toggleFavorite(id) {
    const key = String(id);
    if (favorites.has(key)) {
      favorites.delete(key);
    } else {
      favorites.set(key, Date.now());
    }
    saveFavorites(favorites);
    updateFavCount();

    if (activeFilter === "favorites") {
      applyFilter(false);
      return;
    }
    const btn = grid.querySelector(`.fav-btn[data-id="${CSS.escape(key)}"]`);
    if (btn) {
      const active = favorites.has(key);
      btn.classList.toggle("active", active);
      btn.title = active ? "Remove from favorites" : "Add to favorites";
      btn.setAttribute("aria-pressed", String(active));
      btn.setAttribute(
        "aria-label",
        active ? "Remove from favorites" : "Add to favorites",
      );
    }
  }

  const { createShareButton } = createArchiveSharing(shareStatus);
  const cards = createCatalogCards({
    grid,
    continueShelf,
    continueGrid,
    getCatalogNo: () => catalogNo,
    getProgress,
    isFavorite,
    isFinished,
    isNewArrival,
    toggleFavorite,
    createShareButton,
  });

  // ---------- pagination ----------
  function renderPagination(totalItems) {
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    if (totalPages <= 1) {
      pagination.hidden = true;
      return;
    }
    pagination.hidden = false;
    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage === totalPages;
    pageStatus.textContent = `Page ${currentPage} of ${totalPages}`;
  }

  function scrollToGrid() {
    const top = grid.getBoundingClientRect().top + window.scrollY - 90;
    window.scrollTo({ top, behavior: "smooth" });
  }

  prevPageBtn.addEventListener("click", () => {
    currentPage -= 1;
    renderCurrentPage();
    scrollToGrid();
  });

  nextPageBtn.addEventListener("click", () => {
    currentPage += 1;
    renderCurrentPage();
    scrollToGrid();
  });

  function renderCurrentPage() {
    const totalPages = Math.max(1, Math.ceil(lastMatches.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(currentPage, 1), totalPages);
    saveLibraryPage(currentPage);
    const start = (currentPage - 1) * PAGE_SIZE;
    cards.renderBooks(lastMatches.slice(start, start + PAGE_SIZE));
    renderPagination(lastMatches.length);
  }

  function setStatus(text, animated) {
    status.textContent = "";
    if (animated) {
      const d = document.createElement("span");
      d.className = "dot";
      status.append(d, " ");
    }
    status.append(text);
  }

  function applyFilter(resetPage) {
    if (resetPage) {
      currentPage = 1;
      saveLibraryPage(currentPage);
    }
    const queryTokens = normalizeSearchText(searchInput.value);

    let matches = allBooks;

    if (activeFilter === "favorites") {
      matches = matches
        .filter((b) => isFavorite(b.id))
        .sort((a, b) => {
          const timeA = favorites.get(String(a.id)) || 0;
          const timeB = favorites.get(String(b.id)) || 0;
          return timeB - timeA; // (Change to `timeA - timeB` if oldest favorited first)
        });
    } else if (activeFilter === "finished") {
      matches = matches.filter((book) =>
        finishedBooks.has(String(book.id)),
      );
    }

    if (queryTokens.length)
      matches = matches.filter((book) => {
        const searchableTokens = normalizeSearchText(
          `${book.title} ${book.author}`,
        );
        return queryTokens.every((queryToken) =>
          searchableTokens.some((token) => token.includes(queryToken)),
        );
      });

    const hasQuery = queryTokens.length > 0;

    lastMatches = matches;

    if (matches.length === 0) {
      grid.innerHTML = "";
      pagination.hidden = true;
      noResults.hidden = false;
      if (activeFilter === "favorites" && !hasQuery) {
        noResults.textContent = "You haven't favorited any books yet.";
      } else if (activeFilter === "favorites" && hasQuery) {
        noResults.innerHTML = `None of your favorites match "<span>${escapeHtml(searchInput.value.trim())}</span>". Clear the search to see all favorites.`;
      } else if (activeFilter === "finished" && !hasQuery) {
        noResults.textContent = "You haven't marked any books as finished yet.";
      } else if (activeFilter === "finished" && hasQuery) {
        noResults.innerHTML = `No finished books match "<span>${escapeHtml(searchInput.value.trim())}</span>".`;
      } else if (hasQuery) {
        noResults.innerHTML = `No books match "<span>${escapeHtml(searchInput.value.trim())}</span>".`;
      } else {
        noResults.textContent = "No books to show.";
      }
      setStatus("0 books shown", false);
      return;
    }

    noResults.hidden = true;
    renderCurrentPage();

    const noun =
      activeFilter === "favorites"
        ? "favorite"
        : activeFilter === "finished"
          ? "finished book"
          : "book";
    const scope = hasQuery ? ` matching "${searchInput.value.trim()}"` : "";
    setStatus(
      `Showing ${matches.length} ${noun}${matches.length === 1 ? "" : "s"}${scope}`,
      false,
    );
  }

  searchInput.addEventListener("input", () => applyFilter(true));

  favToggle.addEventListener("click", () => {
    activeFilter = activeFilter === "favorites" ? "all" : "favorites";
    favToggle.setAttribute(
      "aria-pressed",
      String(activeFilter === "favorites"),
    );
    finishedToggle.setAttribute(
      "aria-pressed",
      String(activeFilter === "finished"),
    );
    
    applyFilter(true);
  });

  finishedToggle.addEventListener("click", () => {
    activeFilter = activeFilter === "finished" ? "all" : "finished";
    finishedToggle.setAttribute(
      "aria-pressed",
      String(activeFilter === "finished"),
    );
    favToggle.setAttribute(
      "aria-pressed",
      String(activeFilter === "favorites"),
    );
    
    applyFilter(true);
  });

  function refreshFromStorage() {
    if (!allBooks.length) return;

    const before = JSON.stringify([...favorites]);
    const finishedBefore = JSON.stringify([...finishedBooks]);
    favorites = loadFavorites();
    finishedBooks = loadFinishedBooks();
    cards.renderContinueReading(allBooks);
    updateFavCount();
    updateFinishedCount();
    if (
      JSON.stringify([...favorites]) !== before ||
      JSON.stringify([...finishedBooks]) !== finishedBefore
    ) {
      applyFilter(false);
    }
  }

  window.addEventListener("storage", (event) => {
    if (
      event.key === "ending:favorites" ||
      event.key === "ending:finished-books"
    ) {
      refreshFromStorage();
    }
  });

  window.addEventListener("pageshow", (e) => {
    if (e.persisted) refreshFromStorage();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshFromStorage();
  });

  async function loadBooks() {
    cards.renderSkeletons(SKELETON_COUNT);
    setStatus("Cataloging the archive…", true);

    const started = Date.now();
    try {
      const res = await fetch("books.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const books = await res.json();

      const elapsed = Date.now() - started;
      if (elapsed < MIN_LOADING_MS) {
        await new Promise((r) => setTimeout(r, MIN_LOADING_MS - elapsed));
      }

      if (!Array.isArray(books) || books.length === 0) {
        grid.innerHTML = "";
        setStatus("The archive is empty right now.", false);
        return;
      }

      catalogNo = new Map(books.map((b, i) => [String(b.id), i + 1]));

      allBooks = sortBooksByAddedAt(books);
      cards.renderContinueReading(allBooks);
      searchRow.hidden = false;
      favRow.hidden = false;
      updateFavCount();
      updateFinishedCount();
      applyFilter(false);
    } catch (err) {
      grid.innerHTML = `
        <div class="error-box">
          The archive couldn't be reached (${escapeHtml(err.message)}).<br>
          Make sure <code>books.json</code> sits next to this page.
          <div><button id="retry">Try again</button></div>
        </div>`;
      pagination.hidden = true;
      setStatus("Catalog unavailable", false);
      document.getElementById("retry").addEventListener("click", loadBooks);
    }
  }

  loadBooks();
}

runArchive();
