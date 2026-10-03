// The guide page follows the app's light/dark choice (dark is the default).
try {
  if (localStorage.getItem("bead-pattern:theme") === "light") document.documentElement.dataset.theme = "light";
} catch {}
