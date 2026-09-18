import Store from 'electron-store';

// Hand-duplicated from src/renderer/theme/themes.ts's DEFAULT_THEME_ID -- main
// process can't import renderer modules (separate tsconfig rootDir/webpack
// bundle), so this default is kept in sync by hand. Update BOTH sides together.
const DEFAULT_THEME_ID = 'fabrica-dark';

type SettingsSchema = {
  theme: string;
};

const store = new Store<SettingsSchema>({
  name: 'settings',
  defaults: {
    theme: DEFAULT_THEME_ID,
  },
});

export function getTheme(): string {
  return store.get('theme');
}

export function setTheme(themeId: string): void {
  store.set('theme', themeId);
}
