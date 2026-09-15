import {
  FolderClosed,
  BarChart3,
  Settings as SettingsIcon,
} from 'lucide-react';
import logo from '../assets/log.png';

export type AppScreen = 'main' | 'stats-dashboard' | 'settings';

interface AppSidebarProps {
  active: AppScreen;
  onNavigate: (screen: AppScreen) => void;
  bottomSlot?: React.ReactNode;
}

interface NavItem {
  id: AppScreen;
  label: string;
  icon: React.ReactNode;
}

export default function AppSidebar({ active, onNavigate, bottomSlot }: AppSidebarProps) {
  const items: NavItem[] = [
    { id: 'main', label: 'Projects', icon: <FolderClosed size={16} strokeWidth={2} /> },
    { id: 'stats-dashboard', label: 'Stats', icon: <BarChart3 size={16} strokeWidth={2} /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon size={16} strokeWidth={2} /> },
  ];

  return (
    <div
      className="flex flex-col w-48 lg:w-56 shrink-0"
      style={{
        backgroundColor: '#180C29',
        borderRight: '1px solid rgba(168, 85, 247, 0.24)',
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-4">
        <img src={logo} alt="Fabrica" className="w-6 h-6" />
        <span
          className="text-base font-semibold hidden sm:block"
          style={{ color: '#ffffff', fontFamily: 'Segoe UI, sans-serif' }}
        >
          Fabrica
        </span>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 px-2 mt-2">
        {items.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className="flex items-center gap-2.5 px-3 py-1.5 text-sm rounded transition-colors"
              style={{
                backgroundColor: isActive ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
                color: isActive ? '#c084fc' : '#B8AFC2',
                fontFamily: 'Segoe UI, sans-serif',
                fontWeight: isActive ? 500 : 400,
                cursor: isActive ? 'default' : 'pointer',
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)';
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <span
                style={{
                  color: isActive ? '#a855f7' : '#81748F',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                {item.icon}
              </span>
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Bottom widget (per-screen, optional) */}
      {bottomSlot && <div className="mt-auto px-3 py-3">{bottomSlot}</div>}
    </div>
  );
}