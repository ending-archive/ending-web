(function () {
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
  const favToggleIcon = document.getElementById("favToggleIcon");
  const favCount = document.getElementById("favCount");
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
  const NEW_BADGE_DAYS = 7;
  const FAVORITES_KEY = "ending:favorites";
  const LIBRARY_PAGE_KEY = "ending:library-page";

  let allBooks = [];
  let favorites = loadFavorites();
  let favoritesOnly = false;
  let currentPage = loadLibraryPage();
  let lastMatches = [];

  // Escape any string before it goes into innerHTML, so titles/authors
  // from books.json can never be interpreted as markup.
  function escapeHtml(str) {
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

  function getAddedAtTimestamp(book) {
    if (typeof book.addedAt !== "string") return null;
    const timestamp = Date.parse(book.addedAt);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function isNewArrival(book) {
    const addedAt = getAddedAtTimestamp(book);
    if (addedAt === null) return false;
    const age = Date.now() - addedAt;
    return age >= 0 && age < NEW_BADGE_DAYS * 24 * 60 * 60 * 1000;
  }

  // ---------- favorites persistence ----------
  function loadFavorites() {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      if (!raw) return new Map();
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        return new Map(parsed.map((id, index) => [String(id), index]));
      }
      return new Map(Object.entries(parsed));
    } catch {
      return new Map();
    }
  }

  function saveFavorites() {
    try {
      const obj = Object.fromEntries(favorites);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(obj));
    } catch {}
  }

  function loadLibraryPage() {
    try {
      const page = Number.parseInt(localStorage.getItem(LIBRARY_PAGE_KEY), 10);
      return Number.isInteger(page) && page > 0 ? page : 1;
    } catch {
      return 1;
    }
  }

  function saveLibraryPage() {
    try {
      localStorage.setItem(LIBRARY_PAGE_KEY, String(currentPage));
    } catch {}
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
      // Store the current timestamp when favorited
      favorites.set(key, Date.now());
    }
    saveFavorites();
    updateFavCount();

    if (favoritesOnly) {
      // The favorites-only list membership just changed, so recompute it.
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
      btn.textContent = active ? "\u2665" : "\u2661";
    }
  }

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

  function renderSkeletons(n) {
    grid.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const el = document.createElement("div");
      el.className = "card skeleton";
      el.innerHTML = `
        <div class="cover-wrap"></div>
        <div class="card-body">
          <div class="line"></div>
          <div class="line short"></div>
        </div>
      `;
      grid.appendChild(el);
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
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      shareBook(book);
    });
    return button;
  }

  function renderBooks(books) {
    grid.innerHTML = "";
    books.forEach((book, i) => {
      const title = escapeHtml(book.title);
      const author = escapeHtml(book.author);
      const cover = escapeHtml(book.cover);
      const id = String(book.id);
      const active = isFavorite(id);
      const card = document.createElement("article");
      const catalogNo = allBooks.indexOf(book) + 1;
      card.className = "card";
      card.style.animationDelay = `${Math.min(i * 40, 400)}ms`;
      const cardLink = document.createElement("a");
      cardLink.href = `reader.html?id=${encodeURIComponent(book.id)}`;
      cardLink.setAttribute("aria-label", `${book.title} by ${book.author}`);
      cardLink.className = "card-link";
      cardLink.innerHTML = `
        <div class="cover-wrap">
          <img src="${cover}" alt="Cover of ${title}" loading="lazy">
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
      favoriteButton.setAttribute("aria-pressed", String(active));
      favoriteButton.setAttribute(
        "aria-label",
        active ? "Remove from favorites" : "Add to favorites",
      );
      favoriteButton.textContent = active ? "\u2665" : "\u2661";
      favoriteButton.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(id);
      });

      card.append(cardLink, favoriteButton, createShareButton(book));
      grid.appendChild(card);
    });
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

  function showShareStatus(message) {
    shareStatus.textContent = message;
    shareStatus.hidden = false;
    clearTimeout(showShareStatus.timer);
    showShareStatus.timer = setTimeout(() => {
      shareStatus.hidden = true;
    }, 3500);
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
        showShareStatus(`Shared "${book.title}".`);
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }

    try {
      if (await copyBookLink(url.href)) {
        showShareStatus(`Link to "${book.title}" copied.`);
        return;
      }
    } catch {
      // Offer manual copying if both browser sharing and clipboard access fail.
    }

    window.prompt(`Copy the link to "${book.title}":`, url.href);
  }

  function renderContinueReading(books) {
    const reading = [];
    books.forEach((book) => {
      try {
        const raw = localStorage.getItem(`ending:progress:${book.id}`);
        if (!raw) return;
        const progress = JSON.parse(raw);
        if (
          !Number.isInteger(progress.chapterIndex) ||
          !Number.isFinite(progress.updatedAt)
        ) {
          return;
        }

        const storedPercent = Number(progress.progressPercent);
        const legacyFraction = Number(progress.scrollFraction);
        const hasStoredPercent =
          Number.isFinite(storedPercent) &&
          storedPercent >= 0 &&
          storedPercent <= 100;
        const percent = hasStoredPercent
          ? storedPercent
          : Math.min(100, Math.max(0, legacyFraction * 100));
        if (!Number.isFinite(percent) || percent >= 100) return;

        reading.push({
          book,
          chapterIndex: progress.chapterIndex,
          updatedAt: progress.updatedAt,
          percent,
          hasStoredPercent,
        });
      } catch {
        // Ignore malformed or inaccessible progress entries.
      }
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
    saveLibraryPage();
    const start = (currentPage - 1) * PAGE_SIZE;
    renderBooks(lastMatches.slice(start, start + PAGE_SIZE));
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
      saveLibraryPage();
    }
    const q = searchInput.value.trim().toLowerCase();

    let matches = allBooks;

    if (favoritesOnly) {
      matches = matches
        .filter((b) => isFavorite(b.id))
        .sort((a, b) => {
          const timeA = favorites.get(String(a.id)) || 0;
          const timeB = favorites.get(String(b.id)) || 0;
          return timeB - timeA; // Newest favorited first
          // (Change to `timeA - timeB` if oldest favorited first)
        });
    }

    if (q)
      matches = matches.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q),
      );

    lastMatches = matches;

    if (matches.length === 0) {
      grid.innerHTML = "";
      pagination.hidden = true;
      noResults.hidden = false;
      if (favoritesOnly && !q) {
        noResults.textContent =
          "You haven't favorited any books yet — tap the ♡ on a book to add it.";
      } else if (favoritesOnly && q) {
        noResults.innerHTML = `None of your favorites match "<span>${escapeHtml(searchInput.value.trim())}</span>". Clear the search to see all favorites.`;
      } else if (q) {
        noResults.innerHTML = `No books match "<span>${escapeHtml(searchInput.value.trim())}</span>".`;
      } else {
        noResults.textContent = "No books to show.";
      }
      setStatus("0 books shown", false);
      return;
    }

    noResults.hidden = true;
    renderCurrentPage();

    const noun = favoritesOnly ? "favorite" : "book";
    const scope = q ? ` matching "${searchInput.value.trim()}"` : "";
    setStatus(
      `Showing ${matches.length} ${noun}${matches.length === 1 ? "" : "s"}${scope}`,
      false,
    );
  }

  searchInput.addEventListener("input", () => applyFilter(true));

  favToggle.addEventListener("click", () => {
    favoritesOnly = !favoritesOnly;
    favToggle.setAttribute("aria-pressed", String(favoritesOnly));
    favToggleIcon.textContent = favoritesOnly ? "\u2665" : "\u2661";
    if (favoritesOnly && searchInput.value.trim()) {
      searchInput.value = "";
    }
    applyFilter(true);
  });

  async function loadBooks() {
    renderSkeletons(SKELETON_COUNT);
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

      allBooks = books
        .map((book, index) => ({
          book,
          index,
          addedAt: getAddedAtTimestamp(book),
        }))
        .sort((a, b) => {
          if (a.addedAt === null) {
            return b.addedAt === null ? a.index - b.index : 1;
          }
          if (b.addedAt === null) return -1;
          return b.addedAt - a.addedAt || a.index - b.index;
        })
        .map(({ book }) => book);
      renderContinueReading(allBooks);
      searchRow.hidden = false;
      favRow.hidden = false;
      updateFavCount();
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
})();
