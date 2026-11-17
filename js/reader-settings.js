const SETTINGS_KEY = "ending:settings";
const SIZE_MIN = 14;
const SIZE_MAX = 26;
const SIZE_STEP = 1;
const THEME_CLASSES = ["theme-paper", "theme-sepia", "theme-dark"];

function defaultSettings() {
  const prefersDark =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: dark)").matches;
  return {
    font: "serif",
    size: 17,
    align: "left",
    theme: prefersDark ? "dark" : "paper",
  };
}

function readOverrides() {
  const overrides = {};
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
    if (["serif", "sans", "mono"].includes(saved.font))
      overrides.font = saved.font;
    if (["left", "justify"].includes(saved.align))
      overrides.align = saved.align;
    if (["paper", "sepia", "dark"].includes(saved.theme))
      overrides.theme = saved.theme;
    if (typeof saved.size === "number" && Number.isFinite(saved.size))
      overrides.size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, saved.size));
  } catch {}
  return overrides;
}

export function createReaderSettings(
  el,
  { onOpenNotes, onBeforeChange, onAfterChange } = {},
) {
  let overrides = readOverrides();
  let settings = { ...defaultSettings(), ...overrides };
  let returnFocusTo = null;

  function saveOverrides() {
    try {
      if (Object.keys(overrides).length) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(overrides));
      } else {
        localStorage.removeItem(SETTINGS_KEY);
      }
    } catch {}
  }

  function applySettings() {
    document.body.classList.remove(...THEME_CLASSES);
    document.body.classList.add("theme-" + settings.theme);
    document.documentElement.style.setProperty(
      "--font-size",
      settings.size / 16 + "rem",
    );
    document.documentElement.style.setProperty("--text-align", settings.align);

    const body = document.querySelector(".chapter-body");
    if (body) {
      body.classList.remove("font-serif", "font-sans", "font-mono");
      body.classList.add("font-" + settings.font);
    }

    [el.fontRow, el.alignRow, el.themeRow].forEach((row) => {
      row.querySelectorAll(".opt-btn").forEach((button) => {
        const on = button.dataset.value === settings[row.dataset.key];
        button.classList.toggle("active", on);
        button.setAttribute("aria-pressed", String(on));
      });
    });
    el.sizeValue.textContent = settings.size;
  }

  function updateSetting(key, value) {
    const token = onBeforeChange?.();
    settings[key] = value;
    overrides[key] = value;
    saveOverrides();
    applySettings();
    onAfterChange?.(token);
  }

  el.fontRow.addEventListener("click", (event) => {
    const button = event.target.closest(".opt-btn");
    if (button) updateSetting("font", button.dataset.value);
  });
  el.alignRow.addEventListener("click", (event) => {
    const button = event.target.closest(".opt-btn");
    if (button) updateSetting("align", button.dataset.value);
  });
  el.themeRow.addEventListener("click", (event) => {
    const button = event.target.closest(".opt-btn");
    if (button) updateSetting("theme", button.dataset.value);
  });
  el.sizeUp.addEventListener("click", () => {
    updateSetting("size", Math.min(SIZE_MAX, settings.size + SIZE_STEP));
  });
  el.sizeDown.addEventListener("click", () => {
    updateSetting("size", Math.max(SIZE_MIN, settings.size - SIZE_STEP));
  });
  el.resetBtn.addEventListener("click", () => {
    const token = onBeforeChange?.();
    overrides = {};
    settings = defaultSettings();
    saveOverrides();
    applySettings();
    onAfterChange?.(token);
  });

  // ---- drawers: aria-hidden/inert + focus management ----
  function setDrawerOpen(drawer, open) {
    drawer.classList.toggle("open", open);
    drawer.setAttribute("aria-hidden", String(!open));
    drawer.inert = !open;
  }

  function isOpen(drawer) {
    return drawer.classList.contains("open");
  }

  function syncBackdrop() {
    el.backdrop.classList.toggle(
      "visible",
      isOpen(el.drawer) || isOpen(el.notesDrawer),
    );
  }

  function restoreFocus() {
    if (isOpen(el.drawer) || isOpen(el.notesDrawer)) return;
    const target = returnFocusTo;
    returnFocusTo = null;
    if (target && document.contains(target)) target.focus();
  }

  function rememberFocus() {
    if (!isOpen(el.drawer) && !isOpen(el.notesDrawer))
      returnFocusTo = document.activeElement;
  }

  function openDrawer() {
    rememberFocus();
    setDrawerOpen(el.notesDrawer, false);
    setDrawerOpen(el.drawer, true);
    el.settingsBtn.classList.add("open");
    el.settingsBtn.setAttribute("aria-expanded", "true");
    syncBackdrop();
    el.drawerCloseBtn.focus();
  }

  function closeDrawer({ restore = true } = {}) {
    setDrawerOpen(el.drawer, false);
    el.settingsBtn.classList.remove("open");
    el.settingsBtn.setAttribute("aria-expanded", "false");
    syncBackdrop();
    if (restore) restoreFocus();
  }

  function openNotesDrawer() {
    rememberFocus();
    closeDrawer({ restore: false });
    onOpenNotes?.();
    setDrawerOpen(el.notesDrawer, true);
    syncBackdrop();
    el.notesCloseBtn.focus();
  }

  function closeNotesDrawer({ restore = true } = {}) {
    setDrawerOpen(el.notesDrawer, false);
    syncBackdrop();
    if (restore) restoreFocus();
  }

  el.settingsBtn.addEventListener("click", () => {
    if (isOpen(el.drawer)) {
      closeDrawer();
    } else {
      openDrawer();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      (isOpen(el.drawer) || isOpen(el.notesDrawer))
    ) {
      closeDrawer({ restore: false });
      closeNotesDrawer();
    }
  });
  el.backdrop.addEventListener("click", () => {
    closeDrawer({ restore: false });
    closeNotesDrawer();
  });
  el.drawerCloseBtn.addEventListener("click", () => closeDrawer());
  el.notesCloseBtn.addEventListener("click", () => closeNotesDrawer());
  el.openNotesBtn.addEventListener("click", openNotesDrawer);

  setDrawerOpen(el.drawer, false);
  setDrawerOpen(el.notesDrawer, false);
  applySettings();
  return {
    applySettings,
    openDrawer,
    closeDrawer,
    openNotesDrawer,
    closeNotesDrawer,
    isAnyDrawerOpen: () => isOpen(el.drawer) || isOpen(el.notesDrawer),
    get settings() {
      return settings;
    },
  };
}
