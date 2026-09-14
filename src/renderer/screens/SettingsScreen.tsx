import { useState, ReactNode } from 'react';
import logo from '../../assets/log.png';
import useModelSelector, { ModelOption } from '../hooks/useModelSelector';

type SettingsCategory = 'general' | 'appearance' | 'editor';

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative inline-flex items-center rounded-full transition-colors duration-200 shrink-0"
      style={{
        width: '38px',
        height: '20px',
        backgroundColor: checked ? '#a855f7' : '#1C0F30',
      }}
    >
      <span
        className="absolute rounded-full bg-white transition-transform duration-200"
        style={{
          width: '14px',
          height: '14px',
          top: '3px',
          left: '3px',
          transform: checked ? 'translateX(18px)' : 'translateX(0)',
        }}
      />
    </button>
  );
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between gap-6 py-3"
      style={{ borderBottom: '1px solid #180C29' }}
    >
      <div>
        <div className="text-sm font-medium" style={{ color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}>
          {label}
        </div>
        <div className="text-xs mt-0.5" style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}>
          {description}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function GeneralSettingsCategory() {
  return (
    <div className="text-sm" style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}>
      General settings are coming soon.
    </div>
  );
}

function AppearanceSettingsCategory() {
  return (
    <div className="text-sm" style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}>
      Appearance settings (theme, etc.) are coming soon.
    </div>
  );
}

function EditorSettingsCategory() {
  const [fontSize, setFontSize] = useState(14);
  const [tabSize, setTabSize] = useState(2);
  const [indentType, setIndentType] = useState<'spaces' | 'tabs'>('spaces');
  const [wordWrap, setWordWrap] = useState(true);
  const [lineNumbers, setLineNumbers] = useState(true);

  return (
    <div className="max-w-2xl">
      <SettingsRow label="Font Size" description="Adjust the text size in the code editor.">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={10}
            max={24}
            step={1}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="w-40"
            style={{ accentColor: '#a855f7' }}
          />
          <span
            className="text-xs w-10 text-right"
            style={{ color: '#F5F0FA', fontFamily: 'Space Mono, monospace' }}
          >
            {fontSize}px
          </span>
        </div>
      </SettingsRow>

      <SettingsRow label="Tab Size" description="Number of spaces a tab character represents.">
        <select
          value={tabSize}
          onChange={(e) => setTabSize(Number(e.target.value))}
          className="px-3 py-1.5 rounded text-sm outline-none"
          style={{
            backgroundColor: '#100718',
            color: '#F5F0FA',
            border: '1px solid rgba(168, 85, 247, 0.24)',
            fontFamily: 'Segoe UI, sans-serif',
          }}
        >
          <option value={2}>2</option>
          <option value={4}>4</option>
          <option value={8}>8</option>
        </select>
      </SettingsRow>

      <SettingsRow label="Indentation" description="Insert spaces or tab characters when pressing Tab.">
        <div className="flex rounded overflow-hidden" style={{ border: '1px solid rgba(168, 85, 247, 0.24)' }}>
          {(['spaces', 'tabs'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setIndentType(option)}
              className="px-3 py-1.5 text-xs font-medium capitalize transition-colors"
              style={{
                backgroundColor: indentType === option ? '#a855f7' : '#100718',
                color: indentType === option ? '#ffffff' : '#B8AFC2',
                fontFamily: 'Segoe UI, sans-serif',
              }}
            >
              {option}
            </button>
          ))}
        </div>
      </SettingsRow>

      <SettingsRow label="Word Wrap" description="Wrap long lines to fit the editor width.">
        <ToggleSwitch checked={wordWrap} onChange={setWordWrap} label="Word Wrap" />
      </SettingsRow>

      <SettingsRow label="Line Numbers" description="Show line numbers in the editor gutter.">
        <ToggleSwitch checked={lineNumbers} onChange={setLineNumbers} label="Line Numbers" />
      </SettingsRow>
    </div>
  );
}

export default function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { activeKey, modelName, models, switching, error, selectModel } = useModelSelector();
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general');

  const categories: { id: SettingsCategory; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'editor', label: 'Editor' },
  ];

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#100718', color: '#F5F0FA' }}>
      <div
        className="flex flex-col w-48 lg:w-56 shrink-0"
        style={{ backgroundColor: '#180C29', borderRight: '1px solid rgba(168, 85, 247, 0.24)' }}
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <img src={logo} alt="Fabrica" className="w-6 h-6" />
          <span className="text-base font-semibold hidden sm:block" style={{ color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}>
            Fabrica
          </span>
        </div>

        <nav className="flex flex-col gap-0.5 px-2 mt-2">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
            style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}
          >
            <span>📁</span> Projects
          </button>
          <div
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded"
            style={{
              backgroundColor: 'rgba(168, 85, 247, 0.15)',
              color: '#a855f7',
              fontFamily: 'Segoe UI, sans-serif',
              cursor: 'default',
            }}
          >
            <span>⚙️</span> Settings
          </div>
        </nav>

        <div className="mt-auto px-3 py-3">
          <div className="text-xs" style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif', marginBottom: '4px' }}>
            Default AI model
          </div>
          {switching ? (
            <div
              className="flex items-center justify-between px-3 py-1.5 rounded text-sm"
              style={{
                backgroundColor: '#100718',
                color: '#B8AFC2',
                fontFamily: 'Segoe UI, sans-serif',
                border: '1px solid rgba(168, 85, 247, 0.24)',
              }}
            >
              <span>Switching…</span>
              <span
                className="inline-block w-3 h-3 rounded-full animate-spin"
                style={{ border: '2px solid rgba(168, 85, 247, 0.3)', borderTopColor: '#a855f7' }}
              />
            </div>
          ) : (
            <div className="relative">
              <select
                value={activeKey ?? ''}
                onChange={(e) => selectModel(e.target.value as ModelOption['key'])}
                disabled={models.length === 0}
                className="w-full appearance-none px-3 py-1.5 pr-7 rounded text-sm"
                style={{
                  backgroundColor: '#100718',
                  color: '#F5F0FA',
                  fontFamily: 'Segoe UI, sans-serif',
                  border: '1px solid rgba(168, 85, 247, 0.24)',
                }}
              >
                {models.length === 0 && <option value="">{modelName}</option>}
                {models.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.displayName}
                  </option>
                ))}
              </select>
              <span
                className="pointer-events-none absolute top-1/2 -translate-y-1/2"
                style={{ right: '10px', color: '#B8AFC2' }}
              >
                ▼
              </span>
            </div>
          )}
          {error && (
            <div className="text-xs mt-1" style={{ color: '#f87171', fontFamily: 'Segoe UI, sans-serif' }}>
              {error}
            </div>
          )}
        </div>
      </div>

      <div
        className="flex flex-col w-44 shrink-0"
        style={{ backgroundColor: '#100718', borderRight: '1px solid rgba(168, 85, 247, 0.24)' }}
      >
        <div className="px-4 py-4">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#B8AFC2', fontFamily: 'Segoe UI, sans-serif' }}>
            Categories
          </span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setActiveCategory(category.id)}
              className="w-full text-left px-3 py-1.5 text-sm rounded transition-colors hover:bg-white/5"
              style={{
                backgroundColor: activeCategory === category.id ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
                color: activeCategory === category.id ? '#a855f7' : '#B8AFC2',
                fontFamily: 'Segoe UI, sans-serif',
              }}
            >
              {category.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div
          className="flex items-center justify-between px-4 sm:px-6 py-3 shrink-0"
          style={{ borderBottom: '1px solid rgba(168, 85, 247, 0.24)' }}
        >
          <h1 className="text-base sm:text-lg font-semibold" style={{ color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}>
            {categories.find((c) => c.id === activeCategory)?.label}
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
          {activeCategory === 'general' && <GeneralSettingsCategory />}
          {activeCategory === 'appearance' && <AppearanceSettingsCategory />}
          {activeCategory === 'editor' && <EditorSettingsCategory />}
        </div>
      </div>
    </div>
  );
}
