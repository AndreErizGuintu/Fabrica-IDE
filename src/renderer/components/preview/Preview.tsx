import { useEffect, useRef } from 'react'

export type DeviceType = 'desktop' | 'tablet' | 'mobile';

interface PreviewProps {
  html: string
  isHtmlFile: boolean
  zoom?: number
  device?: DeviceType
  refreshKey?: number
}

export default function Preview({ html, isHtmlFile, zoom = 1, device = 'desktop', refreshKey = 0 }: PreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

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

  return (
    <div className="flex flex-col h-full w-full"
      style={{ background: '#1e1e2e', borderLeft: '1px solid #2d2d3a' }}>

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