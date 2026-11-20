import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArrowDownToLine,
  ArrowLeftRight,
  BadgeCheck,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  FileArchive,
  FileImage,
  FileOutput,
  FileText,
  Gauge,
  History,
  Image as ImageIcon,
  Layers3,
  LockKeyhole,
  Menu,
  Minimize2,
  PanelLeftClose,
  Plus,
  RefreshCcw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UploadCloud,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { compressInWorker, convertToPng, getRecommendation, inspectFile } from './lib/image'
import { downloadBlob, downloadZip } from './lib/download'
import { formatBytes, formatLabel, outputName, savingsPercent } from './lib/format'
import { imagesToPdf, pdfToImages, type ImagesToPdfOptions } from './lib/pdf'
import type { CompressionSettings, HistoryEntry, ImageAsset, OutputFormat } from './types'

type Section = 'dashboard' | 'compressor' | 'png' | 'pdf' | 'batch' | 'history'

const navItems: Array<{ id: Section; label: string; icon: typeof Gauge }> = [
  { id: 'dashboard', label: 'Overview', icon: Gauge },
  { id: 'compressor', label: 'Image compressor', icon: Minimize2 },
  { id: 'png', label: 'PNG converter', icon: ImageIcon },
  { id: 'pdf', label: 'PDF converter', icon: FileText },
  { id: 'batch', label: 'Batch processing', icon: Layers3 },
  { id: 'history', label: 'Processing history', icon: History },
]

const presets = [
  { label: 'Maximum', quality: 0.94 },
  { label: 'High', quality: 0.86 },
  { label: 'Balanced', quality: 0.76 },
  { label: 'Smaller', quality: 0.62 },
]

function App() {
  const [section, setSection] = useState<Section>('dashboard')
  const [assets, setAssets] = useState<ImageAsset[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [settings, setSettings] = useState<CompressionSettings>({
    format: 'image/webp',
    quality: 0.86,
    preserveQuality: true,
    resize: false,
  })
  const [targetValue, setTargetValue] = useState('')
  const [targetUnit, setTargetUnit] = useState<'KB' | 'MB'>('KB')
  const [compare, setCompare] = useState(50)
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('isr-history') ?? '[]') as HistoryEntry[] } catch { return [] }
  })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const currentCancel = useRef<(() => void) | undefined>(undefined)

  const selected = assets.find((asset) => asset.id === selectedId) ?? assets[0]
  const completeAssets = assets.filter((asset) => asset.result)

  useEffect(() => {
    if (!selectedId && assets[0]) setSelectedId(assets[0].id)
  }, [assets, selectedId])

  useEffect(() => {
    localStorage.setItem('isr-history', JSON.stringify(history.slice(0, 30)))
  }, [history])

  useEffect(() => () => {
    assets.forEach((asset) => {
      URL.revokeObjectURL(asset.url)
      if (asset.result) URL.revokeObjectURL(asset.result.url)
    })
  }, [])

  const updateAsset = (id: string, update: Partial<ImageAsset>) => {
    setAssets((current) => current.map((asset) => asset.id === id ? { ...asset, ...update } : asset))
  }

  async function addFiles(fileList: FileList | File[]) {
    setGlobalError('')
    const files = Array.from(fileList)
    if (!files.length) return
    const inspected = await Promise.allSettled(files.map(inspectFile))
    const valid: ImageAsset[] = []
    const errors: string[] = []
    inspected.forEach((result, index) => {
      if (result.status === 'fulfilled') valid.push(result.value)
      else errors.push(`${files[index].name}: ${result.reason instanceof Error ? result.reason.message : 'Could not read image.'}`)
    })
    if (valid.length) {
      setAssets((current) => [...current, ...valid])
      setSelectedId((current) => current ?? valid[0].id)
      const recommendation = getRecommendation(valid[0])
      setSettings((current) => ({ ...current, format: recommendation.format }))
      if (section === 'dashboard') setSection('compressor')
    }
    if (errors.length) setGlobalError(errors.join(' '))
  }

  function removeAsset(id: string) {
    setAssets((current) => {
      const removed = current.find((asset) => asset.id === id)
      if (removed) {
        URL.revokeObjectURL(removed.url)
        if (removed.result) URL.revokeObjectURL(removed.result.url)
      }
      const remaining = current.filter((asset) => asset.id !== id)
      if (selectedId === id) setSelectedId(remaining[0]?.id)
      return remaining
    })
  }

  function settingsWithTarget(): CompressionSettings {
    const numeric = Number.parseFloat(targetValue)
    const targetBytes = Number.isFinite(numeric) && numeric > 0
      ? Math.round(numeric * (targetUnit === 'MB' ? 1024 * 1024 : 1024))
      : undefined
    return { ...settings, targetBytes }
  }

  async function processAsset(asset: ImageAsset) {
    if (asset.result) URL.revokeObjectURL(asset.result.url)
    updateAsset(asset.id, { status: 'processing', progress: 1, error: undefined, result: undefined })
    const operation = compressInWorker(asset, settingsWithTarget(), (progress) => updateAsset(asset.id, { progress }))
    currentCancel.current = operation.cancel
    try {
      const workerResult = await operation.promise
      const result = { ...workerResult, url: URL.createObjectURL(workerResult.blob) }
      updateAsset(asset.id, { status: 'complete', progress: 100, result })
      setHistory((current) => [{
        id: crypto.randomUUID(),
        name: asset.name,
        before: asset.size,
        after: workerResult.blob.size,
        format: workerResult.blob.type,
        completedAt: Date.now(),
      }, ...current].slice(0, 30))
    } catch (error) {
      updateAsset(asset.id, { status: 'error', progress: 0, error: error instanceof Error ? error.message : 'Compression failed.' })
    } finally {
      currentCancel.current = undefined
    }
  }

  async function processAll() {
    for (const asset of assets) await processAsset(asset)
  }

  function cancelProcessing() {
    currentCancel.current?.()
    if (selected?.status === 'processing') updateAsset(selected.id, { status: 'cancelled', progress: 0, error: 'Processing cancelled.' })
  }

  function restoreOriginal() {
    if (!selected?.result) return
    URL.revokeObjectURL(selected.result.url)
    updateAsset(selected.id, { result: undefined, status: 'ready', progress: 0, error: undefined })
  }

  async function downloadAllResults() {
    await downloadZip(completeAssets.map((asset) => ({
      blob: asset.result!.blob,
      name: outputName(asset.name, asset.result!.blob.type),
    })), 'isr-hr-optimized-images.zip')
  }

  const content = section === 'dashboard'
    ? <Dashboard onUpload={() => fileInput.current?.click()} onNavigate={setSection} assetCount={assets.length} history={history} />
    : section === 'compressor'
      ? <CompressorWorkspace
          assets={assets}
          selected={selected}
          settings={settings}
          setSettings={setSettings}
          targetValue={targetValue}
          setTargetValue={setTargetValue}
          targetUnit={targetUnit}
          setTargetUnit={setTargetUnit}
          compare={compare}
          setCompare={setCompare}
          zoom={zoom}
          setZoom={setZoom}
          onUpload={() => fileInput.current?.click()}
          onSelect={setSelectedId}
          onRemove={removeAsset}
          onProcess={() => selected && processAsset(selected)}
          onProcessAll={processAll}
          onCancel={cancelProcessing}
          onRestore={restoreOriginal}
          onDownloadAll={downloadAllResults}
        />
      : section === 'png'
        ? <PngConverter assets={assets} onUpload={() => fileInput.current?.click()} />
        : section === 'pdf'
          ? <PdfConverter />
          : section === 'batch'
            ? <BatchView assets={assets} onSelect={(id) => { setSelectedId(id); setSection('compressor') }} onUpload={() => fileInput.current?.click()} onProcessAll={processAll} onDownloadAll={downloadAllResults} />
            : <HistoryView history={history} onClear={() => setHistory([])} />

  return (
    <div className="app-shell" onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><Sparkles size={20} /></div>
          <div><strong>ISR HR</strong><span>Smart Compressor</span></div>
          <button className="icon-button mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><PanelLeftClose /></button>
        </div>
        <nav>
          {navItems.map((item) => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => { setSection(item.id); setSidebarOpen(false) }}>
            <item.icon size={18} /><span>{item.label}</span>{item.id === 'batch' && assets.length > 0 && <em>{assets.length}</em>}
          </button>)}
        </nav>
        <div className="privacy-card">
          <div className="privacy-icon"><ShieldCheck size={18} /></div>
          <div><strong>Private by design</strong><span>Files stay on this device.</span></div>
        </div>
        <div className="sidebar-foot"><span className="status-dot" />Processing engine ready</div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu /></button>
          <div className="topbar-title"><span>{navItems.find((item) => item.id === section)?.label}</span><small>Local processing workspace</small></div>
          <div className="topbar-actions"><span className="private-pill"><LockKeyhole size={14} /> 100% local</span><button className="upload-button" onClick={() => fileInput.current?.click()}><Plus size={17} /> Add images</button></div>
        </header>

        {globalError && <div className="global-error"><CircleAlert size={18} /><span>{globalError}</span><button onClick={() => setGlobalError('')}><X size={16} /></button></div>}
        <div className="content-area">{content}</div>
      </main>

      <input ref={fileInput} type="file" accept=".png,.jpg,.jpeg,.webp,.avif,.heic,.heif,image/*" multiple hidden onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = '' }} />
      <div
        className={`drop-overlay ${dragging ? 'visible' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false) }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files) }}
      ><div><UploadCloud size={46} /><strong>Drop images anywhere</strong><span>They stay inside your browser</span></div></div>
    </div>
  )
}

function Dashboard({ onUpload, onNavigate, assetCount, history }: { onUpload: () => void; onNavigate: (section: Section) => void; assetCount: number; history: HistoryEntry[] }) {
  const totalSaved = history.reduce((sum, item) => sum + Math.max(0, item.before - item.after), 0)
  return <div className="dashboard-page">
    <section className="hero-panel">
      <div className="hero-copy">
        <span className="eyebrow"><WandSparkles size={15} /> Adaptive image intelligence</span>
        <h1>Compress smarter.<br /><span>Preserve every detail.</span></h1>
        <p>Intelligent image compression and conversion, engineered for exceptional quality and smaller file sizes.</p>
        <div className="hero-actions"><button className="primary-action" onClick={onUpload}><UploadCloud size={19} /> Choose images</button><button className="secondary-action" onClick={() => onNavigate('pdf')}><FileText size={18} /> Open PDF tools</button></div>
        <div className="trust-row"><span><Check /> No uploads</span><span><Check /> Real output sizes</span><span><Check /> Original dimensions</span></div>
      </div>
      <button className="hero-dropzone" onClick={onUpload}>
        <div className="upload-orbit"><div className="upload-core"><UploadCloud size={28} /></div><i /><i /></div>
        <strong>Drop images to begin</strong><span>PNG, JPG, WebP, AVIF, HEIC</span><small>Up to 80 MB per file</small>
      </button>
    </section>

    <section className="stats-grid">
      <StatCard icon={FileImage} label="Images in workspace" value={String(assetCount)} accent="blue" />
      <StatCard icon={Archive} label="Total space saved" value={formatBytes(totalSaved)} accent="violet" />
      <StatCard icon={LockKeyhole} label="Files sent to cloud" value="Zero" accent="green" />
      <StatCard icon={BadgeCheck} label="Completed sessions" value={String(history.length)} accent="cyan" />
    </section>

    <section className="tool-grid">
      <ToolCard icon={Minimize2} title="Intelligent compressor" text="Target a file size with iterative quality-safe encoding." action="Compress images" onClick={() => onNavigate('compressor')} />
      <ToolCard icon={ImageIcon} title="PNG converter" text="Create transparent, full-resolution PNG files locally." action="Convert to PNG" onClick={() => onNavigate('png')} />
      <ToolCard icon={FileText} title="PDF studio" text="Combine images or render selected PDF pages as images." action="Open PDF studio" onClick={() => onNavigate('pdf')} />
    </section>

    <section className="engine-strip"><div><BrainCircuit /><span><strong>Quality-aware engine</strong><small>Iterates toward your target while measuring visual difference.</small></span></div><div className="engine-flow"><span>Inspect</span><i /><span>Encode</span><i /><span>Measure</span><i /><span>Optimize</span></div></section>
  </div>
}

function StatCard({ icon: Icon, label, value, accent }: { icon: typeof Gauge; label: string; value: string; accent: string }) {
  return <div className="stat-card"><div className={`stat-icon ${accent}`}><Icon /></div><div><span>{label}</span><strong>{value}</strong></div></div>
}

function ToolCard({ icon: Icon, title, text, action, onClick }: { icon: typeof Gauge; title: string; text: string; action: string; onClick: () => void }) {
  return <button className="tool-card" onClick={onClick}><div className="tool-icon"><Icon /></div><strong>{title}</strong><p>{text}</p><span>{action} <ArrowLeftRight size={15} /></span></button>
}

interface WorkspaceProps {
  assets: ImageAsset[]
  selected?: ImageAsset
  settings: CompressionSettings
  setSettings: React.Dispatch<React.SetStateAction<CompressionSettings>>
  targetValue: string
  setTargetValue: (value: string) => void
  targetUnit: 'KB' | 'MB'
  setTargetUnit: (unit: 'KB' | 'MB') => void
  compare: number
  setCompare: (value: number) => void
  zoom: number
  setZoom: (value: number) => void
  onUpload: () => void
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onProcess: () => void
  onProcessAll: () => void
  onCancel: () => void
  onRestore: () => void
  onDownloadAll: () => void
}

function CompressorWorkspace(props: WorkspaceProps) {
  const { assets, selected, settings, setSettings, targetValue, setTargetValue, targetUnit, setTargetUnit, compare, setCompare, zoom, setZoom } = props
  if (!selected) return <EmptyWorkspace onUpload={props.onUpload} />
  const recommendation = getRecommendation(selected)
  const result = selected.result
  const expectedRatio = settings.format === 'image/png' ? 0.82 : 0.25 + settings.quality * 0.55
  const estimated = settings.targetBytes ?? Math.round(selected.size * expectedRatio)
  return <div className="workspace-grid">
    <section className="file-rail panel">
      <div className="panel-head"><div><span className="section-kicker">Queue</span><strong>{assets.length} image{assets.length === 1 ? '' : 's'}</strong></div><button className="icon-button" onClick={props.onUpload} aria-label="Add images"><Plus /></button></div>
      <div className="asset-list">
        {assets.map((asset) => <div key={asset.id} role="button" tabIndex={0} className={`asset-row ${asset.id === selected.id ? 'selected' : ''}`} onClick={() => props.onSelect(asset.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') props.onSelect(asset.id) }}>
          <img src={asset.url} alt="" /><span><strong>{asset.name}</strong><small>{formatBytes(asset.size)} · {asset.width}×{asset.height}</small>{asset.status === 'processing' && <i style={{ width: `${asset.progress}%` }} />}</span>
          {asset.status === 'complete' ? <Check className="success-icon" size={16} /> : <button className="remove-mini" onClick={(event) => { event.stopPropagation(); props.onRemove(asset.id) }} aria-label={`Remove ${asset.name}`}><X size={14} /></button>}
        </div>)}
      </div>
      <button className="rail-add" onClick={props.onUpload}><Plus size={16} /> Add more images</button>
      {assets.length > 1 && <button className="rail-process" onClick={props.onProcessAll}><Layers3 size={16} /> Process entire queue</button>}
      {assets.some((asset) => asset.result) && <button className="rail-download" onClick={props.onDownloadAll}><FileArchive size={16} /> Download results ZIP</button>}
    </section>

    <section className="preview-panel panel">
      <div className="preview-toolbar"><div><span className="section-kicker">Visual inspection</span><strong>{selected.name}</strong></div><div className="zoom-controls"><button onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}><ZoomOut /></button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom(Math.min(3, zoom + 0.25))}><ZoomIn /></button></div></div>
      <div className="comparison-stage">
        <div className="image-plane" style={{ transform: `scale(${zoom})` }}><img src={selected.url} alt="Original" /></div>
        {result && <div className="image-plane result-plane" style={{ clipPath: `inset(0 ${100 - compare}% 0 0)`, transform: `scale(${zoom})` }}><img src={result.url} alt="Compressed result" /></div>}
        {result && <><div className="compare-line" style={{ left: `${compare}%` }}><span><ArrowLeftRight /></span></div><input className="compare-input" type="range" min="0" max="100" value={compare} onChange={(event) => setCompare(Number(event.target.value))} aria-label="Before and after comparison" /></>}
        <span className="image-label original">Original</span>{result && <span className="image-label processed">Optimized</span>}
      </div>
      <div className="result-metrics">
        <Metric label="Original" value={formatBytes(selected.size)} />
        <Metric label="Optimized" value={result ? formatBytes(result.blob.size) : '—'} highlight />
        <Metric label="Savings" value={result ? `${savingsPercent(selected.size, result.blob.size)}%` : '—'} />
        <Metric label="Similarity" value={result ? `${(result.similarity * 100).toFixed(1)}%` : '—'} />
        <Metric label="Dimensions" value={result ? `${result.width}×${result.height}` : `${selected.width}×${selected.height}`} />
      </div>
      {(result?.warning || selected.error) && <div className="quality-warning"><CircleAlert /><div><strong>{selected.error ? 'Processing issue' : 'Quality notice'}</strong><span>{selected.error ?? result?.warning}</span></div></div>}
    </section>

    <section className="controls-panel panel">
      <div className="panel-head"><div><span className="section-kicker">Output controls</span><strong>Compression profile</strong></div><Settings2 /></div>
      <label className="control-label">Output format</label>
      <div className="format-grid">{(['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as OutputFormat[]).map((format) => <button key={format} className={settings.format === format ? 'active' : ''} onClick={() => setSettings((current) => ({ ...current, format }))}>{formatLabel(format)}{recommendation.format === format && <i>Best</i>}</button>)}</div>

      <div className="control-separator" />
      <div className="control-heading"><label>Quality</label><strong>{Math.round(settings.quality * 100)}%</strong></div>
      <input className="quality-slider" type="range" min="30" max="98" value={Math.round(settings.quality * 100)} onChange={(event) => setSettings((current) => ({ ...current, quality: Number(event.target.value) / 100 }))} style={{ '--range': `${((settings.quality * 100 - 30) / 68) * 100}%` } as React.CSSProperties} />
      <div className="preset-row">{presets.map((preset) => <button key={preset.label} className={Math.abs(settings.quality - preset.quality) < 0.01 ? 'active' : ''} onClick={() => setSettings((current) => ({ ...current, quality: preset.quality }))}>{preset.label}</button>)}</div>

      <div className="control-separator" />
      <label className="control-label">Custom target size <span>Optional</span></label>
      <div className="target-input"><input type="number" min="1" inputMode="decimal" placeholder="e.g. 500" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} /><select value={targetUnit} onChange={(event) => setTargetUnit(event.target.value as 'KB' | 'MB')}><option>KB</option><option>MB</option></select></div>
      <div className="target-chips">{[100, 250, 500, 750].map((value) => <button key={value} onClick={() => { setTargetValue(String(value)); setTargetUnit('KB') }}>{value} KB</button>)}</div>
      <div className="estimate-card"><span><Gauge />Estimated output</span><strong>{formatBytes(estimated)}</strong><small>Encoding determines the exact size</small></div>

      <label className="toggle-row"><span><strong>Protect visual quality</strong><small>Stop before visible degradation</small></span><input type="checkbox" checked={settings.preserveQuality} onChange={(event) => setSettings((current) => ({ ...current, preserveQuality: event.target.checked }))} /><i /></label>
      <label className="toggle-row"><span><strong>Resize dimensions</strong><small>Off keeps original dimensions</small></span><input type="checkbox" checked={settings.resize} onChange={(event) => setSettings((current) => ({ ...current, resize: event.target.checked }))} /><i /></label>
      {settings.resize && <div className="dimension-inputs"><input type="number" placeholder="Max width" value={settings.maxWidth ?? ''} onChange={(event) => setSettings((current) => ({ ...current, maxWidth: Number(event.target.value) || undefined }))} /><input type="number" placeholder="Max height" value={settings.maxHeight ?? ''} onChange={(event) => setSettings((current) => ({ ...current, maxHeight: Number(event.target.value) || undefined }))} /></div>}

      <div className="recommendation"><BrainCircuit /><div><strong>Smart recommendation</strong><p>{recommendation.message}</p></div></div>

      {selected.status === 'processing' ? <div className="processing-block"><div><span>Optimizing image</span><strong>{selected.progress}%</strong></div><i><b style={{ width: `${selected.progress}%` }} /></i><button onClick={props.onCancel}>Cancel processing</button></div>
        : result ? <div className="completed-actions"><button className="download-main" onClick={() => downloadBlob(result.blob, outputName(selected.name, result.blob.type))}><ArrowDownToLine /> Download · {formatBytes(result.blob.size)}</button><button className="restore-button" onClick={props.onRestore}><RotateCcw /> Restore original</button></div>
          : <button className="process-main" onClick={props.onProcess}><Sparkles /> Compress image <span>→</span></button>}
    </section>
  </div>
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return <div><span>{label}</span><strong className={highlight ? 'highlight' : ''}>{value}</strong></div>
}

function EmptyWorkspace({ onUpload }: { onUpload: () => void }) {
  return <div className="empty-workspace"><div className="empty-art"><UploadCloud /><i /><i /></div><span className="eyebrow">Private local processing</span><h2>Add your images to open the workspace</h2><p>Inspect, compress, compare, and download image files without sending them to a server.</p><button className="primary-action" onClick={onUpload}><Plus /> Choose images</button><div className="empty-formats"><span>PNG</span><span>JPG</span><span>WEBP</span><span>AVIF</span><span>HEIC*</span></div><small>* When the browser can decode it</small></div>
}

function PngConverter({ assets, onUpload }: { assets: ImageAsset[]; onUpload: () => void }) {
  const [busyId, setBusyId] = useState<string>()
  const [error, setError] = useState('')
  const convert = async (asset: ImageAsset) => {
    setBusyId(asset.id); setError('')
    try {
      const blob = await convertToPng(asset.file)
      downloadBlob(blob, outputName(asset.name, 'image/png', 'converted'))
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'PNG conversion failed.') }
    finally { setBusyId(undefined) }
  }
  return <div className="converter-page"><div className="page-intro"><span className="eyebrow"><ImageIcon /> Lossless output</span><h2>PNG converter</h2><p>Convert browser-supported images to full-resolution PNG while preserving transparency and removing ancillary metadata.</p></div>
    {error && <div className="global-error"><CircleAlert />{error}</div>}
    {!assets.length ? <EmptyWorkspace onUpload={onUpload} /> : <div className="converter-list panel"><div className="panel-head"><div><span className="section-kicker">Available images</span><strong>{assets.length} ready to convert</strong></div><button className="upload-button" onClick={onUpload}><Plus /> Add images</button></div>{assets.map((asset) => <div className="convert-row" key={asset.id}><img src={asset.url} alt="" /><div><strong>{asset.name}</strong><span>{formatLabel(asset.mime)} · {asset.width}×{asset.height} · {formatBytes(asset.size)}</span></div><span className={asset.hasAlpha ? 'alpha-badge' : 'neutral-badge'}>{asset.hasAlpha ? 'Transparency' : 'Opaque'}</span><button disabled={busyId === asset.id} onClick={() => convert(asset)}>{busyId === asset.id ? 'Converting…' : <><FileOutput /> Convert & download</>}</button></div>)}</div>}
  </div>
}

function PdfConverter() {
  const [mode, setMode] = useState<'create' | 'extract'>('create')
  const [images, setImages] = useState<File[]>([])
  const [pdf, setPdf] = useState<File>()
  const [pdfOptions, setPdfOptions] = useState<ImagesToPdfOptions>({ pageSize: 'a4', orientation: 'portrait', margin: 24, fit: 'contain' })
  const [renderFormat, setRenderFormat] = useState<'png' | 'jpeg'>('png')
  const [renderScale, setRenderScale] = useState(2)
  const [pageText, setPageText] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const imageInput = useRef<HTMLInputElement>(null)
  const pdfInput = useRef<HTMLInputElement>(null)

  const move = (index: number, direction: -1 | 1) => setImages((current) => {
    const target = index + direction
    if (target < 0 || target >= current.length) return current
    const next = [...current]; [next[index], next[target]] = [next[target], next[index]]
    return next
  })
  const createPdf = async () => {
    setBusy(true); setError(''); setProgress('Preparing images…')
    try { const blob = await imagesToPdf(images, pdfOptions); downloadBlob(blob, 'isr-hr-images.pdf'); setProgress(`PDF ready · ${formatBytes(blob.size)}`) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'PDF creation failed.') }
    finally { setBusy(false) }
  }
  const extractPdf = async () => {
    if (!pdf) return
    setBusy(true); setError(''); setProgress('Reading PDF…')
    const pages = pageText.trim() ? pageText.split(',').flatMap((part) => {
      const trimmed = part.trim(); const range = trimmed.match(/^(\d+)-(\d+)$/)
      if (range) return Array.from({ length: Math.max(0, Number(range[2]) - Number(range[1]) + 1) }, (_, index) => Number(range[1]) + index)
      const value = Number(trimmed); return Number.isInteger(value) ? [value] : []
    }) : undefined
    try {
      const results = await pdfToImages(pdf, { format: renderFormat, scale: renderScale, pages, onProgress: (current, total) => setProgress(`Rendering page ${current} of ${total}`) })
      if (results.length === 1) downloadBlob(results[0].blob, results[0].name)
      else await downloadZip(results, `${pdf.name.replace(/\.pdf$/i, '')}-pages.zip`)
      setProgress(`${results.length} page${results.length === 1 ? '' : 's'} converted`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'PDF rendering failed.') }
    finally { setBusy(false) }
  }
  return <div className="pdf-page"><div className="page-intro"><span className="eyebrow"><FileText /> PDF studio</span><h2>Convert images and PDF pages</h2><p>Build polished documents from ordered images or render selected PDF pages at high resolution.</p></div>
    <div className="mode-tabs"><button className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}><FileImage /> Images to PDF</button><button className={mode === 'extract' ? 'active' : ''} onClick={() => setMode('extract')}><FileOutput /> PDF to images</button></div>
    {error && <div className="global-error"><CircleAlert />{error}</div>}
    {mode === 'create' ? <div className="pdf-layout"><section className="panel pdf-files"><div className="panel-head"><div><span className="section-kicker">Page order</span><strong>{images.length ? `${images.length} image${images.length === 1 ? '' : 's'}` : 'Add images'}</strong></div><button className="upload-button" onClick={() => imageInput.current?.click()}><Plus /> Add</button></div>
      {!images.length ? <button className="compact-drop" onClick={() => imageInput.current?.click()}><UploadCloud /><strong>Choose images</strong><span>Each image becomes one PDF page</span></button> : <div className="pdf-image-list">{images.map((file, index) => <div key={`${file.name}-${index}`}><span>{index + 1}</span><FileImage /><div><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></div><button onClick={() => move(index, -1)} disabled={index === 0}><ChevronUp /></button><button onClick={() => move(index, 1)} disabled={index === images.length - 1}><ChevronDown /></button><button onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></button></div>)}</div>}
      <input ref={imageInput} hidden type="file" multiple accept="image/*,.heic,.heif" onChange={(event) => { if (event.target.files) setImages((current) => [...current, ...Array.from(event.target.files!)]); event.target.value = '' }} /></section>
      <section className="panel pdf-settings"><div className="panel-head"><div><span className="section-kicker">Document setup</span><strong>PDF options</strong></div><SlidersHorizontal /></div><label>Page size<select value={pdfOptions.pageSize} onChange={(event) => setPdfOptions((current) => ({ ...current, pageSize: event.target.value as ImagesToPdfOptions['pageSize'] }))}><option value="a4">A4</option><option value="a3">A3</option><option value="letter">Letter</option><option value="original">Original image ratio</option></select></label><label>Orientation<select value={pdfOptions.orientation} onChange={(event) => setPdfOptions((current) => ({ ...current, orientation: event.target.value as 'portrait' | 'landscape' }))}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label><label>Image fit<select value={pdfOptions.fit} onChange={(event) => setPdfOptions((current) => ({ ...current, fit: event.target.value as 'contain' | 'cover' }))}><option value="contain">Fit entire image</option><option value="cover">Fill page</option></select></label><label>Margin <span>{pdfOptions.margin} pt</span><input type="range" min="0" max="72" value={pdfOptions.margin} onChange={(event) => setPdfOptions((current) => ({ ...current, margin: Number(event.target.value) }))} /></label><button className="process-main" disabled={!images.length || busy} onClick={createPdf}>{busy ? 'Creating PDF…' : <><FileText /> Create & download PDF</>}</button>{progress && <div className="success-note"><Check />{progress}</div>}</section></div>
      : <div className="pdf-layout"><section className="panel pdf-files"><div className="panel-head"><div><span className="section-kicker">Source document</span><strong>{pdf?.name ?? 'Choose a PDF'}</strong></div></div>{!pdf ? <button className="compact-drop" onClick={() => pdfInput.current?.click()}><UploadCloud /><strong>Select PDF</strong><span>Processed entirely in this browser</span></button> : <div className="selected-pdf"><FileText /><div><strong>{pdf.name}</strong><span>{formatBytes(pdf.size)}</span></div><button onClick={() => setPdf(undefined)}><X /></button></div>}<input ref={pdfInput} hidden type="file" accept="application/pdf,.pdf" onChange={(event) => setPdf(event.target.files?.[0])} /></section>
      <section className="panel pdf-settings"><div className="panel-head"><div><span className="section-kicker">Render setup</span><strong>Image output</strong></div><SlidersHorizontal /></div><label>Output format<select value={renderFormat} onChange={(event) => setRenderFormat(event.target.value as 'png' | 'jpeg')}><option value="png">PNG</option><option value="jpeg">JPEG</option></select></label><label>Resolution<select value={renderScale} onChange={(event) => setRenderScale(Number(event.target.value))}><option value="1">Standard · 96 DPI</option><option value="1.5">High · 144 DPI</option><option value="2">Sharp · 192 DPI</option><option value="3">Print · 288 DPI</option></select></label><label>Pages <span>Leave blank for all</span><input className="text-input" value={pageText} onChange={(event) => setPageText(event.target.value)} placeholder="1, 3, 5-8" /></label><button className="process-main" disabled={!pdf || busy} onClick={extractPdf}>{busy ? progress : <><FileArchive /> Convert & download</>}</button>{progress && !busy && <div className="success-note"><Check />{progress}</div>}</section></div>}
  </div>
}

function BatchView({ assets, onSelect, onUpload, onProcessAll, onDownloadAll }: { assets: ImageAsset[]; onSelect: (id: string) => void; onUpload: () => void; onProcessAll: () => void; onDownloadAll: () => void }) {
  const complete = assets.filter((asset) => asset.result).length
  return <div className="batch-page"><div className="page-intro"><span className="eyebrow"><Layers3 /> Multi-file workflow</span><h2>Batch processing</h2><p>Process the queue with one compression profile and review each measured result.</p></div>{!assets.length ? <EmptyWorkspace onUpload={onUpload} /> : <section className="panel batch-table"><div className="panel-head"><div><span className="section-kicker">Current queue</span><strong>{complete} of {assets.length} complete</strong></div><div><button className="secondary-action" disabled={!complete} onClick={onDownloadAll}><FileArchive /> Download ZIP</button><button className="upload-button" onClick={onProcessAll}><Sparkles /> Process all</button></div></div>{assets.map((asset) => <button className="batch-row" key={asset.id} onClick={() => onSelect(asset.id)}><img src={asset.url} alt="" /><div><strong>{asset.name}</strong><span>{asset.width}×{asset.height} · {formatLabel(asset.mime)}</span></div><span>{formatBytes(asset.size)}</span><span className={`status status-${asset.status}`}>{asset.status}</span><strong>{asset.result ? `${savingsPercent(asset.size, asset.result.blob.size)}% saved` : '—'}</strong></button>)}</section>}</div>
}

function HistoryView({ history, onClear }: { history: HistoryEntry[]; onClear: () => void }) {
  return <div className="history-page"><div className="page-intro page-intro-row"><div><span className="eyebrow"><History /> Local activity</span><h2>Processing history</h2><p>Recent measurements are stored locally. Image files and output bytes are never retained.</p></div>{history.length > 0 && <button className="secondary-action" onClick={onClear}><Trash2 /> Clear history</button>}</div>{!history.length ? <div className="empty-history"><History /><strong>No processed images yet</strong><span>Completed results will appear here.</span></div> : <section className="panel history-table">{history.map((entry) => <div className="history-row" key={entry.id}><div className="history-check"><Check /></div><div><strong>{entry.name}</strong><span>{new Date(entry.completedAt).toLocaleString()}</span></div><Metric label="Original" value={formatBytes(entry.before)} /><Metric label="Output" value={formatBytes(entry.after)} highlight /><Metric label="Savings" value={`${savingsPercent(entry.before, entry.after)}%`} /><span className="neutral-badge">{formatLabel(entry.format)}</span></div>)}</section>}</div>
}

export default App
