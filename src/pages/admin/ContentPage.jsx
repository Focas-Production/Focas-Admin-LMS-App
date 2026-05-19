import { useState, useEffect, useRef } from 'react'
import * as tus from 'tus-js-client'
import { apiFetch, authHeaders } from '../../api'

const API_BASE = import.meta.env.VITE_API_BASE

function fmtSize(bytes) {
  if (!bytes) return '—'
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e3).toFixed(0)} KB`
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}

function TypeBadge({ type }) {
  return type === 'video'
    ? <span className="inline-flex items-center gap-1 text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" /></svg>
        Video
      </span>
    : <span className="inline-flex items-center gap-1 text-xs font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" /></svg>
        PDF
      </span>
}

function ProductPicker({ products, selected, onChange }) {
  return (
    <div className="border border-gray-200 rounded-lg max-h-36 overflow-y-auto">
      {products.length === 0
        ? <p className="text-xs text-gray-400 px-3 py-2">No products available</p>
        : products.map(p => (
          <label key={p._id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(p._id)}
              onChange={() => onChange(selected.includes(p._id)
                ? selected.filter(id => id !== p._id)
                : [...selected, p._id]
              )}
              className="rounded border-gray-300 text-indigo-600"
            />
            <span className="text-sm text-gray-700">{p.name}{p.level ? ` (${p.level})` : ''}</span>
          </label>
        ))
      }
    </div>
  )
}

function UploadDrawer({ products, subjects, onClose, onUploaded }) {
  const fileRef    = useRef(null)
  const tusRef     = useRef(null)
  const [file,        setFile]       = useState(null)
  const [title,       setTitle]      = useState('')
  const [subject,     setSubject]    = useState('')
  const [productIds,  setProductIds] = useState([])
  const [desc,        setDesc]       = useState('')
  const [order,       setOrder]      = useState('0')
  const [progress,    setProgress]   = useState(0)
  const [uploading,   setUploading]  = useState(false)
  const [phase,       setPhase]      = useState('') // 'uploading' | 'processing'
  const [error,       setError]      = useState('')

  function handleFile(e) {
    const f = e.target.files[0]
    if (!f) return
    setFile(f)
    if (!title) setTitle(f.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' '))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file)           return setError('Please select a file')
    if (!title.trim())   return setError('Title is required')
    if (!subject.trim()) return setError('Subject is required')
    setError('')
    setUploading(true)
    setProgress(0)

    const isVideo = file.type.startsWith('video/')

    // ── PDF: upload to server via XHR (small files, no TUS needed) ──
    if (!isVideo) {
      setPhase('uploading')
      const form = new FormData()
      form.append('file', file)
      form.append('title', title.trim())
      form.append('subject', subject.trim())
      form.append('description', desc.trim())
      form.append('order', order)
      productIds.forEach(id => form.append('productIds', id))
      const xhr = new XMLHttpRequest()
      xhr.upload.onprogress = ev => {
        if (ev.lengthComputable) setProgress(Math.round(ev.loaded / ev.total * 100))
      }
      xhr.onload = () => {
        setUploading(false)
        if (xhr.status >= 200 && xhr.status < 300) {
          onUploaded(JSON.parse(xhr.responseText).content); onClose()
        } else {
          try { setError(JSON.parse(xhr.responseText).error || 'Upload failed') }
          catch { setError('Upload failed') }
        }
      }
      xhr.onerror = () => { setUploading(false); setError('Network error') }
      xhr.open('POST', `${API_BASE}/api/admin/content/upload`)
      xhr.setRequestHeader('Authorization', `Bearer ${localStorage.getItem('admin_token')}`)
      xhr.send(form)
      return
    }

    // ── Video: TUS direct upload to Bunny Stream ──
    setPhase('uploading')
    let prepareData
    try {
      prepareData = await apiFetch('/api/admin/content/prepare-upload', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(), subject: subject.trim(),
          description: desc.trim(), order, productIds,
          fileSize: file.size, fileName: file.name,
        }),
      })
    } catch (err) {
      setUploading(false); return setError(err.message)
    }

    const { content, tusEndpoint, tusHeaders } = prepareData
    onUploaded(content) // add to list immediately as "processing"

    const upload = new tus.Upload(file, {
      endpoint: tusEndpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: tusHeaders,
      metadata: { filename: file.name, filetype: file.type },
      onProgress(bytesUploaded, bytesTotal) {
        setProgress(Math.round(bytesUploaded / bytesTotal * 100))
      },
      async onSuccess() {
        setPhase('processing')
        // Notify server so it starts polling Bunny for transcoding completion
        await fetch(`${API_BASE}/api/admin/content/${content._id}/upload-complete`, {
          method: 'POST', headers: authHeaders(),
        }).catch(() => {})
        setUploading(false)
        onClose()
      },
      onError(err) {
        setUploading(false); setError(`Upload failed: ${err.message}`)
      },
    })
    tusRef.current = upload
    upload.start()
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Upload Content</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100">
            <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* File picker */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">File <span className="text-red-500">*</span></label>
            <div
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors ${
                file ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
              }`}
            >
              {file ? (
                <div>
                  <div className="flex items-center justify-center mb-2">
                    {file.type.startsWith('video/') ? (
                      <svg className="w-8 h-8 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
                      </svg>
                    ) : (
                      <svg className="w-8 h-8 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-gray-800 truncate">{file.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{fmtSize(file.size)}</p>
                  <p className="text-xs text-indigo-600 mt-1">Click to change</p>
                </div>
              ) : (
                <div>
                  <svg className="w-10 h-10 text-gray-300 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-sm font-medium text-gray-600">Click to select file</p>
                  <p className="text-xs text-gray-400 mt-0.5">Video (MP4, MKV, etc.) or PDF</p>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept="video/*,.pdf,application/pdf" onChange={handleFile} className="hidden" />
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Title <span className="text-red-500">*</span></label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Chapter 1 — Introduction"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent" />
          </div>

          {/* Subject */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Subject <span className="text-red-500">*</span></label>
            <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
              list="subjects-list" placeholder="e.g. Financial Reporting"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent" />
            <datalist id="subjects-list">
              {subjects.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>

          {/* Products */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Link to Products <span className="text-gray-400">(optional — tick all that apply)</span>
            </label>
            <ProductPicker products={products} selected={productIds} onChange={setProductIds} />
            {productIds.length > 0 && (
              <p className="text-xs text-indigo-600 mt-1">{productIds.length} product{productIds.length > 1 ? 's' : ''} selected</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Description</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder="Brief description…"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
          </div>

          {/* Order */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Display Order</label>
            <input type="number" value={order} onChange={e => setOrder(e.target.value)} min="0"
              className="w-28 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>

          {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100">
          {uploading && (
            <div className="mb-3">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>
                  {phase === 'processing' ? 'Sent to Bunny — transcoding…'
                    : progress < 100 ? `Uploading directly to Bunny Stream…`
                    : 'Finalising…'}
                </span>
                {phase !== 'processing' && <span>{progress}%</span>}
              </div>
              {phase !== 'processing' && (
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div className="bg-indigo-600 h-2 rounded-full transition-all duration-200" style={{ width: `${progress}%` }} />
                </div>
              )}
              {phase === 'processing' && (
                <p className="text-xs text-amber-600 mt-1">
                  Bunny is transcoding the video. It will appear as Ready in the list shortly.
                </p>
              )}
            </div>
          )}
          <button onClick={handleSubmit} disabled={uploading}
            className="w-full py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 transition-colors text-sm">
            {uploading
              ? phase === 'processing' ? 'Transcoding…'
                : progress < 100 ? `Uploading ${progress}%…`
                : 'Finalising…'
              : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  )
}

function EditModal({ item, products, subjects, onClose, onSaved }) {
  const [title,      setTitle]      = useState(item.title)
  const [subject,    setSubject]    = useState(item.subject)
  const [productIds, setProductIds] = useState(() => {
    const fromArr = (item.productIds || []).map(p => p?._id || p).filter(Boolean)
    if (fromArr.length) return fromArr
    const legacy = item.productId?._id || item.productId
    return legacy ? [legacy] : []
  })
  const [desc,    setDesc]    = useState(item.description || '')
  const [order,   setOrder]   = useState(String(item.order ?? 0))
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  async function handleSave() {
    setSaving(true); setError('')
    try {
      const data = await apiFetch(`/api/admin/content/${item._id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: title.trim(), subject: subject.trim(), productIds, description: desc.trim(), order: parseInt(order) }),
      })
      onSaved(data.content)
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-bold text-gray-900">Edit Content</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} list="edit-subjects-list"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
            <datalist id="edit-subjects-list">{subjects.map(s => <option key={s} value={s} />)}</datalist>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">
              Products <span className="text-gray-400">(tick all that apply)</span>
            </label>
            <ProductPicker products={products} selected={productIds} onChange={setProductIds} />
            {productIds.length > 0 && (
              <p className="text-xs text-indigo-600 mt-1">{productIds.length} product{productIds.length > 1 ? 's' : ''} selected</p>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Description</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Order</label>
            <input type="number" value={order} onChange={e => setOrder(e.target.value)} min="0"
              className="w-24 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
        <div className="px-5 py-4 border-t flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-60">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ContentPage() {
  const [items,     setItems]     = useState([])
  const [products,  setProducts]  = useState([])
  const [subjects,  setSubjects]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [total,     setTotal]     = useState(0)
  const [page,      setPage]      = useState(1)
  const [filterType,    setFType]     = useState('')
  const [filterSubject, setFSubject]  = useState('')
  const [search,        setSearch]    = useState('')
  const [showUpload,    setShowUpload] = useState(false)
  const [editItem,      setEditItem]  = useState(null)
  const [deleting,      setDeleting]  = useState(null)

  const LIMIT = 15

  useEffect(() => {
    apiFetch('/api/admin/products').then(d => setProducts(d.products || [])).catch(() => {})
    apiFetch('/api/admin/content/subjects').then(d => setSubjects(d.subjects || [])).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ page, limit: LIMIT })
    if (filterType)    params.set('type',    filterType)
    if (filterSubject) params.set('subject', filterSubject)
    if (search)        params.set('search',  search)
    apiFetch(`/api/admin/content?${params}`)
      .then(d => { setItems(d.content || []); setTotal(d.total || 0) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [page, filterType, filterSubject, search])

  function handleUploaded(content) {
    setItems(prev => [content, ...prev])
    setTotal(t => t + 1)
    if (!subjects.includes(content.subject)) setSubjects(s => [...s, content.subject].sort())
  }

  // Auto-refresh every 15 s while any video is still processing
  useEffect(() => {
    const hasProcessing = items.some(i => i.status === 'processing')
    if (!hasProcessing) return
    const timer = setInterval(() => {
      const params = new URLSearchParams({ page, limit: LIMIT })
      if (filterType)    params.set('type',    filterType)
      if (filterSubject) params.set('subject', filterSubject)
      if (search)        params.set('search',  search)
      apiFetch(`/api/admin/content?${params}`)
        .then(d => setItems(d.content || []))
        .catch(() => {})
    }, 15000)
    return () => clearInterval(timer)
  }, [items, page, filterType, filterSubject, search])

  async function handleDelete(item) {
    if (!confirm(`Delete "${item.title}"? This will remove it from storage permanently.`)) return
    setDeleting(item._id)
    try {
      await apiFetch(`/api/admin/content/${item._id}`, { method: 'DELETE' })
      setItems(prev => prev.filter(i => i._id !== item._id))
      setTotal(t => t - 1)
    } catch (e) {
      alert(e.message)
    } finally {
      setDeleting(null)
    }
  }

  function handleSaved(updated) {
    setItems(prev => prev.map(i => i._id === updated._id ? { ...i, ...updated } : i))
    if (!subjects.includes(updated.subject)) setSubjects(s => [...s, updated.subject].sort())
  }

  const pages = Math.ceil(total / LIMIT)
  const videoCount = items.filter(i => i.type === 'video').length
  const pdfCount   = items.filter(i => i.type === 'pdf').length

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Content Library</h1>
          <p className="text-sm text-gray-400 mt-0.5">Videos & PDFs stored on Bunny.net</p>
        </div>
        <button onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          Upload
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <div><p className="text-xl font-bold text-gray-900">{total}</p><p className="text-xs text-gray-500">Total Files</p></div>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" /></svg>
          </div>
          <div><p className="text-xl font-bold text-gray-900">{videoCount}</p><p className="text-xs text-gray-500">Videos</p></div>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" /></svg>
          </div>
          <div><p className="text-xl font-bold text-gray-900">{pdfCount}</p><p className="text-xs text-gray-500">PDFs</p></div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Search titles…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>

        <select value={filterSubject} onChange={e => { setFSubject(e.target.value); setPage(1) }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 bg-white min-w-[160px]">
          <option value="">All Subjects</option>
          {subjects.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {[['', 'All'], ['video', 'Videos'], ['pdf', 'PDFs']].map(([v, l]) => (
            <button key={v} onClick={() => { setFType(v); setPage(1) }}
              className={`px-3 py-2 font-medium transition-colors ${filterType === v ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {l}
            </button>
          ))}
        </div>

        {(search || filterSubject || filterType) && (
          <button onClick={() => { setSearch(''); setFSubject(''); setFType(''); setPage(1) }}
            className="text-xs text-indigo-600 font-medium hover:underline">Clear</button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              <th className="text-left px-5 py-3">Title</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-left px-4 py-3">Subject</th>
              <th className="text-left px-4 py-3">Product</th>
              <th className="text-left px-4 py-3">Size</th>
              <th className="text-left px-4 py-3">Date</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="border-b border-gray-50 animate-pulse">
                  {[5, 4, 4, 4, 4, 4, 4].map((w, j) => (
                    <td key={j} className="px-4 py-3"><div className={`h-4 bg-gray-100 rounded w-${w}/5`} /></td>
                  ))}
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-14 text-gray-400">
                  <svg className="w-10 h-10 mx-auto mb-2 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  No content uploaded yet
                </td>
              </tr>
            ) : items.map(item => (
              <tr key={item._id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${item.type === 'video' ? 'bg-blue-100' : 'bg-red-100'}`}>
                      {item.type === 'video'
                        ? <svg className="w-3.5 h-3.5 text-blue-600" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" /></svg>
                        : <svg className="w-3.5 h-3.5 text-red-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" /></svg>
                      }
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate max-w-[200px]">{item.title}</p>
                      {item.status === 'processing' && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                          Processing…
                        </span>
                      )}
                      {item.status === 'error' && (
                        <span className="text-xs text-red-500 font-medium">Upload failed</span>
                      )}
                      {item.status !== 'processing' && item.status !== 'error' && item.description && (
                        <p className="text-xs text-gray-400 truncate max-w-[200px]">{item.description}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3"><TypeBadge type={item.type} /></td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">{item.subject}</span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {(item.productIds?.length
                    ? item.productIds.map(p => p?.name).filter(Boolean)
                    : item.productId?.name ? [item.productId.name] : []
                  ).join(', ') || '—'}
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">{item.sizeLabel || fmtSize(item.size)}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{fmtDate(item.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <a href={`${API_BASE}/api/admin/content/${item._id}/preview?token=${localStorage.getItem('admin_token')}`}
                      target="_blank" rel="noreferrer"
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors" title="Open">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                    <button onClick={() => setEditItem(item)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <button onClick={() => handleDelete(item)} disabled={deleting === item._id}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-400">Showing {(page-1)*LIMIT+1}–{Math.min(page*LIMIT, total)} of {total}</p>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
                className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Prev</button>
              {[...Array(Math.min(pages, 5))].map((_, i) => {
                const p = i + 1
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${page === p ? 'bg-indigo-600 text-white' : 'border border-gray-200 hover:bg-gray-50'}`}>
                    {p}
                  </button>
                )
              })}
              <button onClick={() => setPage(p => Math.min(pages, p+1))} disabled={page === pages}
                className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
            </div>
          </div>
        )}
      </div>

      {showUpload && (
        <UploadDrawer
          products={products}
          subjects={subjects}
          onClose={() => setShowUpload(false)}
          onUploaded={handleUploaded}
        />
      )}

      {editItem && (
        <EditModal
          item={editItem}
          products={products}
          subjects={subjects}
          onClose={() => setEditItem(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
