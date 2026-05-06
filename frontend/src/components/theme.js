export function getStoredThemeMode() {
  if (typeof window === 'undefined') return 'light';

  const savedTheme = window.localStorage.getItem('onegapo-theme');
  return savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : 'light';
}

export function applyThemeMode(themeMode) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  if (themeMode === 'dark') {
    root.classList.add('theme-dark');
  } else {
    root.classList.remove('theme-dark');
  }
}

export function persistThemeMode(themeMode) {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem('onegapo-theme', themeMode);
}