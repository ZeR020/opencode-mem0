// Apply saved theme before render to prevent FOUC.
// Extracted from inline <script> to allow removing 'unsafe-inline' from script-src CSP.
(function () {
  var saved = localStorage.getItem("mem0-theme");
  if (saved) {
    document.documentElement.setAttribute("data-theme", saved);
  }
})();
