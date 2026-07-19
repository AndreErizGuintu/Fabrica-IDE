import { useEffect, useRef } from 'react'

interface PreviewProps {
  html: string
  isHtmlFile: boolean
  zoom?: number
}

export default function Preview({ html, isHtmlFile, zoom = 1 }: PreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (iframeRef.current && isHtmlFile) {
      iframeRef.current.srcdoc = html
    }
  }, [html, isHtmlFile])

  return (
    <div className="flex flex-col h-full w-full"
      style={{ background: '#1a0a2e', borderLeft: '1px solid #2d1b4e' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2"
        style={{ background: '#2d1b4e' }}>
        <span className="text-xs font-bold tracking-widest text-gray-400"
          style={{ fontFamily: 'Space Mono, monospace' }}>
          LIVE PREVIEW
        </span>
        <button
          title="Auto-refreshing on every change"
          className="text-gray-600 cursor-default text-sm">
          ↺
        </button>
      </div>

      {/* Preview area */}
      {isHtmlFile ? (
        <div className="flex-1 overflow-auto">
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
            sandbox="allow-scripts"
            title="Live Preview"
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <div>
            <div className="text-4xl mb-4">🚫</div>
            <div className="text-sm text-gray-500"
              style={{ fontFamily: 'Space Mono, monospace' }}>
              Preview not available
              <br/>for this file type
            </div>
          </div>
        </div>
      )}
    </div>
  )
}