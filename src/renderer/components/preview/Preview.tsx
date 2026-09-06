import { useEffect, useRef, useState } from 'react'

interface PreviewProps {
  html: string
  isHtmlFile: boolean
  zoom?: number
}

type DeviceType = 'desktop' | 'tablet' | 'mobile';

export default function Preview({ html, isHtmlFile, zoom = 1 }: PreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [device, setDevice] = useState<DeviceType>('desktop')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (iframeRef.current && isHtmlFile) {
      iframeRef.current.srcdoc = html
    }
  }, [html, isHtmlFile, refreshKey])

  const getDeviceWidth = () => {
    switch (device) {
      case 'desktop': return '100%'
      case 'tablet': return '768px'
      case 'mobile': return '375px'
    }
  }

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1)
  }

  return (
    <div className="flex flex-col h-full w-full"
      style={{ background: '#1e1e2e', borderLeft: '1px solid #2d2d3a' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0"
        style={{ background: '#252535', borderBottom: '1px solid #2d2d3a' }}>
        <span className="text-xs font-medium flex items-center gap-2" style={{ color: '#6b7280', fontFamily: 'Segoe UI, sans-serif' }}>
          🔍 Live Preview
        </span>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 bg-[#1e1e2e] rounded p-0.5">
            {(['desktop', 'tablet', 'mobile'] as DeviceType[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDevice(d)}
                className="text-[10px] px-2 py-0.5 rounded transition-colors"
                style={{
                  background: device === d ? '#a78bfa' : 'transparent',
                  color: device === d ? '#ffffff' : '#6b7280',
                }}
              >
                {d === 'desktop' ? '🖥️' : d === 'tablet' ? '📱' : '📱'}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="text-gray-600 hover:text-white transition-colors text-sm"
            title="Refresh preview"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Preview area */}
      {isHtmlFile ? (
        <div className="flex-1 overflow-auto flex items-center justify-center" style={{ background: '#1e1e2e' }}>
          <div style={{ width: getDeviceWidth(), height: '100%', transition: 'width 0.3s ease' }}>
            <iframe
              ref={iframeRef}
              className="w-full h-full border-none block"
              style={{
                background: '#ffffff',
                transform: zoom === 1 ? undefined : `scale(${zoom})`,
                transformOrigin: 'top left',
                width: zoom === 1 ? '100%' : `${100 / zoom}%`,
                height: zoom === 1 ? '100%' : `${100 / zoom}%`,
              }}
              sandbox="allow-scripts allow-same-origin"
              title="Live Preview"
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <div>
            <div className="text-4xl mb-4">🚫</div>
            <div className="text-sm text-gray-500"
              style={{ fontFamily: 'Segoe UI, sans-serif' }}>
              Preview not available
              <br/>for this file type
            </div>
          </div>
        </div>
      )}
    </div>
  )
}