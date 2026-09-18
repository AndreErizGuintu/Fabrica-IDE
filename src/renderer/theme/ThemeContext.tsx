import React, { createContext, useContext, useEffect, useState } from 'react';
import { themes, DEFAULT_THEME_ID, Theme } from './themes';

function resolveTheme(id: string): Theme {
  const found = themes.find(t => t.id === id);
  const fallback = themes.find(t => t.id === DEFAULT_THEME_ID)!;
  if (!found) return fallback;
  return { ...found, ui: { ...fallback.ui, ...found.ui } };
}

type ThemeContextValue = { theme: Theme; themeId: string; setTheme: (id: string) => void };
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState<string>(DEFAULT_THEME_ID);

  useEffect(() => {
    let cancelled = false;
    window.settings.getTheme().then((result) => {
      if (!cancelled && result.success && result.theme) setThemeId(result.theme);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const setTheme = (id: string) => {
    setThemeId(id);
    window.settings.setTheme(id).catch(() => {});
  };

  const theme = resolveTheme(themeId);

  return (
    <ThemeContext.Provider value={{ theme, themeId, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
