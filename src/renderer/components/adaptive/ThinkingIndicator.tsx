import { useEffect, useState } from 'react';

const MESSAGES = [
  'Analyzing your code...',
  'Finding the answer...',
  'Preparing a hint...',
  'Almost ready...',
];

const BAR_COLORS = ['#A855F7', '#C084FC', '#38BDF8', '#C084FC', '#A855F7'];
const BAR_DELAYS = [0, 120, 240, 360, 480];

// Siri-style waveform — replaces the earlier orb/ring/particle "local
// reasoning" animation with 5 bars pulsing left-to-right while the AI thinks.
export default function ThinkingIndicator() {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setMessageIndex((i) => (i + 1) % MESSAGES.length);
    }, 2500);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        background: '#12102D',
        border: '1px solid #29204A',
        borderRadius: 10,
        maxWidth: 300,
        fontFamily: 'Segoe UI, sans-serif',
        animation: 'fabricaFadeIn 0.3s ease-out',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 20, flexShrink: 0 }}>
        {BAR_COLORS.map((color, i) => (
          <span
            key={i}
            style={{
              display: 'inline-block',
              width: 3,
              borderRadius: 2,
              background: color,
              boxShadow: `0 0 6px ${color}80`,
              height: 4,
              animation: 'fabricaWave 900ms ease-in-out infinite',
              animationDelay: `${BAR_DELAYS[i]}ms`,
            }}
          />
        ))}
      </div>

      <span
        key={messageIndex}
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: '#A9A3C7',
          animation: 'fabricaMsgFadeIn 0.3s ease-out',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 140,
        }}
      >
        {MESSAGES[messageIndex]}
      </span>

      <style>{`
        @keyframes fabricaWave {
          0%, 100% { height: 4px; }
          50%      { height: 16px; }
        }
        @keyframes fabricaMsgFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fabricaFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
