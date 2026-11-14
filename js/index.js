import { createCatalogCards } from "./index-cards.js";
import { createReadingSummary } from "./index-reading-summary.js";
import {
  getProgress,
  loadFavorites,
  loadLibraryPage,
  saveFavorites,
  saveLibraryPage,
} from "./index-storage.js";
import {
  escapeHtml,
  isFinishedProgress,
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
  const finishedRow = document.getElementById("finishedRow");
  const finishedToggle = document.getElementById("finishedToggle");
  const finishedCount = document.getElementById("finishedCount");
  const finishedHeading = document.getElementById("finishedHeading");
  const readingStreak = document.getElementById("readingStreak");
  const weeklyGoalSelect = document.getElementById("weeklyGoal");
  const weeklyGoalTrack = document.getElementById("weeklyGoalTrack");
  const weeklyGoalFill = document.getElementById("weeklyGoalFill");
  const weeklyGoalCount = document.getElementById("weeklyGoalCount");
  const pagination = document.getElementById("pagination");
  const pageStatus = document.getElementById("pageStatus");
  const prevPageBtn = document.getElementById("prevPageBtn");
  const nextPageBtn = document.getElementById("nextPageBtn");
  const controlsToggle = document.getElementById("controlsToggle");
  const drawer = document.getElementById("drawer");
  const drawerBackdrop = document.getElementById("drawerBackdrop");
  const drawerCloseBtn = document.getElementById("drawerCloseBtn");

  const SKELETON_COUNT = 10;
  const MIN_LOADING_MS = 300;
  const PAGE_SIZE = 10;

  let allBooks = [];
  let favorites = loadFavorites();
  let favoritesOnly = false;
  let finishedOnly = false;
  let currentPage = loadLibraryPage();
  let lastMatches = [];
  let catalogNo = new Map();

  const readingSummary = createReadingSummary({
    readingStreak,
    weeklyGoalSelect,
    weeklyGoalTrack,
    weeklyGoalFill,
    weeklyGoalCount,
  });

  function countFinishedBooks(books) {
    return books.filter((book) => isFinishedProgress(getProgress(book))).length;
  }

  function updateFinishedCount() {
    finishedCount.textContent = String(countFinishedBooks(allBooks));
  }

  function isFavorite(id) {
    return favorites.has(String(id));
  }

  function updateFavCount() {
    favCount.textContent = allBooks.filter((b) => isFavorite(b.id)).length;
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

    if (favoritesOnly) {
      applyFilter(false);
      return;
    }
    const btn = grid.querySelector(`.fav-btn[data-id="${CSS.escape(key)}"]`);
    if (btn) {
      const active = favorites.has(key);
      btn.classList.toggle("active", active);
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
    isFinishedProgress,
    isNewArrival,
    toggleFavorite,
    createShareButton,
  });

  // ---------- drawer (mobile) ----------
  function openDrawer() {
    drawer.classList.add("open");
    drawerBackdrop.classList.add("visible");
    controlsToggle.setAttribute("aria-expanded", "true");
  }

  function closeDrawer() {
    drawer.classList.remove("open");
    drawerBackdrop.classList.remove("visible");
    controlsToggle.setAttribute("aria-expanded", "false");
  }

  controlsToggle.addEventListener("click", () => {
    drawer.classList.contains("open") ? closeDrawer() : openDrawer();
  });
  drawerBackdrop.addEventListener("click", closeDrawer);
  drawerCloseBtn.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer.classList.contains("open")) closeDrawer();
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
    finishedHeading.hidden = !finishedOnly;
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

    if (finishedOnly) {
      matches = matches
        .filter((book) => isFinishedProgress(getProgress(book)))
        .sort(
          (a, b) =>
            (Number(getProgress(b)?.updatedAt) || 0) -
            (Number(getProgress(a)?.updatedAt) || 0),
        );
    } else if (favoritesOnly) {
      matches = matches
        .filter((b) => isFavorite(b.id))
        .sort((a, b) => {
          const timeA = favorites.get(String(a.id)) || 0;
          const timeB = favorites.get(String(b.id)) || 0;
          return timeB - timeA; // (Change to `timeA - timeB` if oldest favorited first)
        });
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
      if (favoritesOnly && !hasQuery) {
        noResults.textContent =
          "You haven't favorited any books yet — tap the heart on a book to add it.";
      } else if (finishedOnly && !hasQuery) {
        noResults.textContent = "You haven't finished any books yet.";
      } else if (finishedOnly && hasQuery) {
        noResults.innerHTML = `No finished books match "<span>${escapeHtml(searchInput.value.trim())}</span>".`;
      } else if (favoritesOnly && hasQuery) {
        noResults.innerHTML = `None of your favorites match "<span>${escapeHtml(searchInput.value.trim())}</span>". Clear the search to see all favorites.`;
      } else if (hasQuery) {
        noResults.innerHTML = `No books match "<span>${escapeHtml(searchInput.value.trim())}</span>".`;
      } else {
        noResults.textContent = "No books to show.";
      }
      setStatus("0 books shown", false);
      finishedHeading.hidden = !finishedOnly;
      return;
    }

    noResults.hidden = true;
    renderCurrentPage();

    const noun = finishedOnly
      ? "finished book"
      : favoritesOnly
        ? "favorite"
        : "book";
    const scope = hasQuery ? ` matching "${searchInput.value.trim()}"` : "";
    setStatus(
      `Showing ${matches.length} ${noun}${matches.length === 1 ? "" : "s"}${scope}`,
      false,
    );
  }

  searchInput.addEventListener("input", () => applyFilter(true));

  favToggle.addEventListener("click", () => {
    favoritesOnly = !favoritesOnly;
    finishedOnly = false;
    finishedToggle.setAttribute("aria-pressed", "false");
    favToggle.setAttribute("aria-pressed", String(favoritesOnly));
    if (favoritesOnly && searchInput.value.trim()) {
      searchInput.value = "";
    }
    applyFilter(true);
  });

  finishedToggle.addEventListener("click", () => {
    finishedOnly = !finishedOnly;
    favoritesOnly = false;
    finishedToggle.setAttribute("aria-pressed", String(finishedOnly));
    favToggle.setAttribute("aria-pressed", "false");
    if (finishedOnly && searchInput.value.trim()) searchInput.value = "";
    applyFilter(true);
  });

  function refreshFromStorage() {
    readingSummary.refreshFromStorage();
    if (!allBooks.length) return;
    cards.renderContinueReading(allBooks);
    updateFinishedCount();
    cards.updateCompletionStates();

    const before = JSON.stringify([...favorites]);
    favorites = loadFavorites();
    updateFavCount();
    if (JSON.stringify([...favorites]) !== before || finishedOnly) {
      applyFilter(false);
    }
  }

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
      finishedRow.hidden = false;
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
