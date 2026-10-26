const themeModes = ["system", "light", "dark"];
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
let themeMode = "system";
try {
  const saved = localStorage.getItem("aside-site-theme");
  if (themeModes.includes(saved)) themeMode = saved;
} catch {
  // Theme switching still works when browser storage is unavailable.
}

function applyTheme() {
  const dark =
    themeMode === "dark" || (themeMode === "system" && systemTheme.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  for (const source of document.querySelectorAll('source[data-theme="dark"]')) {
    source.media = dark ? source.dataset.media || "all" : "not all";
  }
  const button = document.querySelector(".theme-toggle");
  if (button) {
    button.dataset.mode = themeMode;
    const label = button.dataset[`${themeMode}Label`];
    button.setAttribute("aria-label", label);
    button.title = label;
  }
}
applyTheme();
systemTheme.addEventListener("change", applyTheme);

document.addEventListener("DOMContentLoaded", () => {
  applyTheme();
  document.querySelector(".theme-toggle").addEventListener("click", () => {
    themeMode =
      themeModes[(themeModes.indexOf(themeMode) + 1) % themeModes.length];
    applyTheme();
    try {
      localStorage.setItem("aside-site-theme", themeMode);
    } catch {
      // Keep the selected theme for this page even without persistence.
    }
  });
  const imageDialog = document.querySelector(".image-dialog");
  const enlargedImage = imageDialog.querySelector("img");
  const caption = imageDialog.querySelector("figcaption");

  for (const link of document.querySelectorAll(".screenshot-link")) {
    link.addEventListener("click", (event) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      const image = link.querySelector("img");
      enlargedImage.src = image.currentSrc;
      enlargedImage.alt = image.alt;
      caption.textContent = image.alt;
      imageDialog.showModal();
    });
  }

  imageDialog.addEventListener("click", (event) => {
    if (event.target !== imageDialog) return;
    const bounds = imageDialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) {
      imageDialog.close();
    }
  });

  const languageMenu = document.querySelector(".language-menu");
  const languageOptions = languageMenu.querySelector(".language-options");
  function positionLanguageMenu() {
    if (!languageMenu.open) return;
    const anchor = languageMenu.getBoundingClientRect();
    const width = languageOptions.offsetWidth;
    const centeredLeft = anchor.left + (anchor.width - width) / 2;
    const left = Math.max(
      18,
      Math.min(centeredLeft, document.documentElement.clientWidth - width - 18),
    );
    languageOptions.style.setProperty(
      "--menu-shift",
      `${left - centeredLeft}px`,
    );
  }
  languageMenu.addEventListener("toggle", positionLanguageMenu);
  window.addEventListener("resize", positionLanguageMenu);
  document.addEventListener("pointerdown", (event) => {
    if (!event.composedPath().includes(languageMenu)) languageMenu.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !languageMenu.open) return;
    event.preventDefault();
    languageMenu.open = false;
    languageMenu.querySelector("summary").focus();
  });
  languageMenu.addEventListener("focusout", (event) => {
    if (event.relatedTarget && !languageMenu.contains(event.relatedTarget))
      languageMenu.open = false;
  });
});
