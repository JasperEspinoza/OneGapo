import { useLayoutEffect } from 'react';
import { applyThemeMode, getStoredThemeMode } from './theme';

export default function ThemeInitializer() {
  useLayoutEffect(() => {
    applyThemeMode(getStoredThemeMode());

    const handleStorage = (event) => {
      if (event.key === 'onegapo-theme') {
        applyThemeMode(event.newValue === 'dark' ? 'dark' : 'light');
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return null;
}