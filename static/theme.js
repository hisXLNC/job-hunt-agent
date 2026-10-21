// Apply the saved theme before the page paints (the CSP allows no inline scripts).
try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
