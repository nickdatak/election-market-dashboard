(() => {
  'use strict';

  const storageKey = 'election-theme';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;
  const browserColor = document.querySelector('meta[name="theme-color"]');
  let toggle;

  function savedChoice() {
    try {
      const value = localStorage.getItem(storageKey);
      return value === 'dark' || value === 'light' ? value : null;
    } catch {
      return null;
    }
  }

  let choice = savedChoice();
  function applyTheme() {
    const theme = choice || (system.matches ? 'dark' : 'light');
    const changed = root.dataset.theme !== theme;
    root.dataset.theme = theme;
    browserColor.content = theme === 'dark' ? '#030303' : '#f4f3f0';
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(theme === 'light'));
      toggle.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    }
    if (changed) window.dispatchEvent(new CustomEvent('electionthemechange', { detail: { theme } }));
  }

  // This script runs in the head so the first paint uses the saved appearance.
  applyTheme();
  document.addEventListener('DOMContentLoaded', () => {
    toggle = document.getElementById('theme-toggle');
    applyTheme();
    toggle.addEventListener('click', () => {
      choice = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(storageKey, choice);
      } catch {
        // The in-memory choice also supports browsers with storage disabled.
      }
      applyTheme();
    });
  });
  system.addEventListener('change', () => {
    if (!choice) applyTheme();
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== storageKey && event.key !== null) return;
    choice = savedChoice();
    applyTheme();
  });
})();
