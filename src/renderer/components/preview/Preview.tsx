import { useEffect, useMemo, useRef, useState } from 'react';

const C = {
  bgPreviewAI: '#0C0922',
  bgCard: '#12102D',
  border: '#29204A',
  accentAI: '#A855F7',
  codePurple: '#C084FC',
  textPrimary: '#F4F1FF',
  textSecondary: '#A9A3C7',
  textMuted: '#77718F',
};

export type DeviceType = 'desktop' | 'tablet' | 'mobile';

interface PreviewProps {
  html: string;
  isHtmlFile: boolean;
  zoom?: number;
  device?: DeviceType;
  refreshKey?: number;
  // When set, the iframe navigates to this URL (e.g. a blob: URL) instead of
  // rendering `html` via srcDoc. srcDoc documents inherit and only ever add
  // restrictions on top of the parent document's CSP, which breaks content
  // that needs a looser policy (e.g. 'unsafe-eval' for in-browser transpiling)
  // — a real navigation to its own URL is a separate document not bound by
  // the parent's CSP. `html` is ignored while `src` is set.
  src?: string;
}

export default function Preview({
  html,
  isHtmlFile,
  zoom = 1,
  device = 'desktop',
  refreshKey = 0,
  src,
}: PreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [iframeKey, setIframeKey] = useState(0);
  useEffect(() => {
    setIframeKey((k) => k + 1);
  }, [refreshKey]);

  const hasExternalResources = useMemo(() => {
    if (!isHtmlFile) return false;
    return /https?:\/\/[^\s"']+\.(css|js)/i.test(html);
  }, [html, isHtmlFile]);

  const getDeviceWidth = () => {
    switch (device) {
      case 'desktop': return '100%';
      case 'tablet': return '768px';
      case 'mobile': return '375px';
    }
  };

  if (!isHtmlFile) {
    return (
      <div className="flex flex-col h-full w-full" style={{ background: C.bgPreviewAI }}>
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <div>
            <div
              className="mx-auto mb-4 flex items-center justify-center"
              style={{
                width: 56, height: 56, borderRadius: '50%',
                background: 'rgba(168, 85, 247, 0.08)',
                border: `1px solid ${C.border}`,
                color: C.accentAI, fontSize: 22,
              }}
            >
              ⃠
            </div>
            <div className="text-sm" style={{ color: C.textMuted, fontFamily: 'Segoe UI, sans-serif' }}>
              Preview not available
              <br />for this file type
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full" style={{ background: C.bgPreviewAI }}>
      {hasExternalResources && (
        <div className="px-3 py-1 text-[10px] shrink-0"
          style={{
            background: C.bgCard,
            borderBottom: `1px solid ${C.border}`,
            color: C.textMuted,
            fontFamily: 'Segoe UI, sans-serif',
          }}>
          ⚠ External CSS/JS detected
        </div>
      )}

      <div className="flex-1 overflow-auto flex items-start justify-center"
        style={{ background: C.bgPreviewAI }}>
        <div style={{ width: getDeviceWidth(), height: '100%', transition: 'width 0.3s ease' }}>
          <iframe
            key={iframeKey}
            ref={iframeRef}
            {...(src ? { src } : { srcDoc: html })}
            className="w-full h-full border-none block"
            style={{
              background: '#ffffff',
              transform: zoom === 1 ? undefined : `scale(${zoom})`,
              transformOrigin: 'top left',
              width: zoom === 1 ? '100%' : `${100 / zoom}%`,
              height: zoom === 1 ? '100%' : `${100 / zoom}%`,
            }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
            title="Live Preview"
          />
        </div>
      </div>
    </div>
  );
}