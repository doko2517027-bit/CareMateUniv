// GitHub Pages cannot emit X-Frame-Options. Keep the application blank when it
// is embedded by another site so login controls cannot be clickjacked.
if (window.top === window.self) {
  document.documentElement.classList.add("top-window");
} else {
  document.documentElement.replaceChildren();
}
