// Paint the stored theme before the first frame; leave <html> bare when the user has never
// chosen so the stylesheet can follow prefers-color-scheme. Kept as an external file (not an
// inline <script>) so the Content-Security-Policy can forbid inline scripts entirely.
try {
  var t = localStorage.getItem('theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
