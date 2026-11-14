const SETTINGS_KEY = "ending:settings";
const DEFAULT_SETTINGS = {
  font: "serif",
  size: 17,
  align: "left",
  theme: "paper",
};
const SIZE_MIN = 14;
const SIZE_MAX = 26;
const SIZE_STEP = 1;

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const settings = { ...DEFAULT_SETTINGS };
    if (["serif", "sans", "mono"].includes(saved.font))
      settings.font = saved.font;
    if (["left", "justify"].includes(saved.align))
      settings.align = saved.align;
    if (["paper", "sepia", "dark"].includes(saved.theme))
      settings.theme = saved.theme;
    const size = Number(saved.size);
    if (Number.isFinite(size))
      settings.size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, size));
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function createReaderSettings(el, { onEscape, onOpenNotes } = {}) {
  let settings = loadSettings();

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {}
  }

  function applySettings() {
    document.body.className = "theme-" + settings.theme;
    document.documentElement.style.setProperty(
      "--font-size",
      settings.size + "px",
    );
    document.documentElement.style.setProperty("--text-align", settings.align);

    const body = document.querySelector(".chapter-body");
    if (body) {
      body.classList.remove("font-serif", "font-sans", "font-mono");
      body.classList.add("font-" + settings.font);
    }

    [el.fontRow, el.alignRow, el.themeRow].forEach((row) => {
      row.querySelectorAll(".opt-btn").forEach((button) => {
        button.classList.toggle(
          "active",
          button.dataset.value === settings[row.dataset.key],
        );
      });
    });
    el.sizeValue.textContent = settings.size;
  }

  function updateSetting(key, value) {
    settings[key] = value;
    saveSettings();
    applySettings();
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
    settings = { ...DEFAULT_SETTINGS };
    saveSettings();
    applySettings();
  });

  function openDrawer() {
    el.drawer.classList.add("open");
    el.backdrop.classList.add("visible");
    el.settingsBtn.classList.add("open");
    el.settingsBtn.setAttribute("aria-expanded", "true");
  }

  function closeDrawer() {
    el.drawer.classList.remove("open");
    el.backdrop.classList.remove("visible");
    el.settingsBtn.classList.remove("open");
    el.settingsBtn.setAttribute("aria-expanded", "false");
  }

  function openNotesDrawer() {
    closeDrawer();
    onOpenNotes?.();
    el.notesDrawer.classList.add("open");
    el.notesDrawer.setAttribute("aria-hidden", "false");
    el.backdrop.classList.add("visible");
  }

  function closeNotesDrawer() {
    el.notesDrawer.classList.remove("open");
    el.notesDrawer.setAttribute("aria-hidden", "true");
    if (!el.drawer.classList.contains("open"))
      el.backdrop.classList.remove("visible");
  }

  el.settingsBtn.addEventListener("click", () => {
    closeNotesDrawer();
    el.drawer.classList.contains("open") ? closeDrawer() : openDrawer();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDrawer();
      closeNotesDrawer();
      onEscape?.();
    }
  });
  el.backdrop.addEventListener("click", () => {
    closeDrawer();
    closeNotesDrawer();
  });
  el.drawerCloseBtn.addEventListener("click", closeDrawer);
  el.notesCloseBtn.addEventListener("click", closeNotesDrawer);
  el.openNotesBtn.addEventListener("click", openNotesDrawer);

  applySettings();
  return {
    applySettings,
    openDrawer,
    closeDrawer,
    openNotesDrawer,
    closeNotesDrawer,
    get settings() {
      return settings;
    },
  };
}
