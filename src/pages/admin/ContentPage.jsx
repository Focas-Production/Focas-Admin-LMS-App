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

const LEVELS = ['Foundation', 'Intermediate', 'Final']
const LEVEL_COLORS = {
  Foundation:   'bg-emerald-100 text-emerald-700',
  Intermediate: 'bg-blue-100 text-blue-700',
  Final:        'bg-purple-100 text-purple-700',
}

const CATEGORY_META = {
  lecture:      { label: 'Lecture',      color: 'bg-blue-100 text-blue-700' },
  question_bank:{ label: 'Q. Bank',      color: 'bg-amber-100 text-amber-700' },
  test_series:  { label: 'Test Series',  color: 'bg-rose-100 text-rose-700' },
}

const TS_TYPES = [
  { value: 'chapter_wise',  label: 'Chapter Wise' },
  { value: 'segment_wise',  label: 'Segment Wise' },
  { value: 'full_test',     label: 'Full Test' },
]

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

function CatBadge({ category }) {
  const m = CATEGORY_META[category] || CATEGORY_META.lecture
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${m.color}`}>
      {m.label}
    </span>
  )
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

function SubjectPicker({ subjects, selected, onChange }) {
  const grouped = LEVELS.reduce((acc, l) => {
    acc[l] = subjects.filter(s => s.level === l && s.isActive !== false)
    return acc
  }, {})

  function toggle(id) {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id])
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {LEVELS.map(level => {
        const levelSubjects = grouped[level]
        if (!levelSubjects?.length) return null
        return (
          <div key={level}>
            <div className={`px-3 py-1.5 text-xs font-bold ${LEVEL_COLORS[level]} border-b border-gray-100`}>
              {level}
            </div>
            <div className="max-h-32 overflow-y-auto">
              {levelSubjects.map(s => (
                <label key={s._id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.includes(s._id)}
                    onChange={() => toggle(s._id)}
                    className="rounded border-gray-300 text-indigo-600"
                  />
                  <span className="text-sm text-gray-700">{s.name}</span>
                </label>
              ))}
            </div>
          </div>
        )
      })}
      {subjects.length === 0 && (
        <p className="text-xs text-gray-400 px-3 py-3">No subjects yet — create them in the Subjects page first</p>
      )}
    </div>
  )
}

// Single file drop zone
function FilePicker({ fileRef, file, setFile, label, accept, hint }) {
  return (
    <div>
      {label && <p className="text-xs font-semibold text-gray-600 mb-1.5">{label}</p>}
      <div
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
          file ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
        }`}
      >
        {file ? (
          <div>
            <p className="text-sm font-semibold text-gray-800 truncate">{file.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{fmtSize(file.size)}</p>
            <p className="text-xs text-indigo-600 mt-1">Click to change</p>
          </div>
        ) : (
          <div>
            <svg className="w-8 h-8 text-gray-300 mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm font-medium text-gray-600">Click to select</p>
            {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept={accept} onChange={e => { const f = e.target.files[0]; if (f) setFile(f) }} className="hidden" />
    </div>
  )
}

function FolderCombobox({ recentFolders, value, onChange, onSelectFolder, subjects }) {
  const [open,  setOpen]  = useState(false)
  const [query, setQuery] = useState('')
  const containerRef      = useRef(null)

  useEffect(() => {
    function handler(e) { if (!containerRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = recentFolders.filter(f =>
    !query || f.folder.toLowerCase().includes(query.toLowerCase())
  )

  function handleInputChange(e) {
    onChange(e.target.value)
    setQuery(e.target.value)
    setOpen(true)
  }

  function handleSelect(fd) {
    onSelectFolder(fd)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="relative" ref={containerRef}>
      <div className={`flex rounded-lg border bg-white transition-shadow ${open ? 'ring-2 ring-indigo-400 border-indigo-400' : 'border-gray-200'}`}>
        <input
          value={value}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          placeholder="Type a new folder name, or pick below…"
          className="flex-1 px-3 py-2 text-sm outline-none bg-transparent rounded-l-lg"
        />
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="px-3 border-l border-gray-200 bg-gray-50 hover:bg-gray-100 rounded-r-lg transition-colors"
          title="Show all folders"
        >
          <svg className={`w-4 h-4 text-gray-500 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-xl shadow-2xl mt-1 overflow-hidden">
          {recentFolders.length === 0 ? (
            <p className="px-4 py-3 text-xs text-gray-400 text-center">No folders yet — type a name above to create one</p>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-3 text-xs text-gray-400 text-center">No match — a new folder "<strong>{query}</strong>" will be created</p>
          ) : (
            <div className="max-h-60 overflow-y-auto">
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                {filtered.length} folder{filtered.length !== 1 ? 's' : ''} — click to upload into that folder
              </p>
              {filtered.map(fd => {
                const subName = subjects.find(s => fd.subjectIds?.includes(s._id))?.name || fd.subject || '—'
                const tsLabel = fd.testSeriesType ? TS_TYPES.find(t => t.value === fd.testSeriesType)?.label : null
                return (
                  <button
                    key={fd.folder}
                    type="button"
                    onClick={() => handleSelect(fd)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-indigo-50 text-left border-b border-gray-50 last:border-0 transition-colors ${
                      value === fd.folder ? 'bg-indigo-50' : ''
                    }`}
                  >
                    <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{fd.folder}</p>
                      <p className="text-xs text-gray-400 truncate">{subName} · {fd.itemCount} file{fd.itemCount !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <CatBadge category={fd.category} />
                      {tsLabel && <span className="text-[10px] text-gray-400">{tsLabel}</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function UploadDrawer({ products, subjects, recentFolders, onClose, onUploaded }) {
  const fileRef       = useRef(null)
  const answerFileRef = useRef(null)
  const tusRef        = useRef(null)

  const [file,          setFile]         = useState(null)
  const [answerFile,    setAnswerFile]    = useState(null)
  const [title,         setTitle]        = useState('')
  const [subjectIds,    setSubjectIds]   = useState([])
  const [productIds,    setProductIds]   = useState([])
  const [desc,     setDesc]     = useState('')
  const [category, setCategory] = useState('lecture')
  const [folder,        setFolder]       = useState('')
  const [unit,          setUnit]         = useState('')
  const [tsType,        setTsType]       = useState('chapter_wise')
  const [testDuration,  setTestDuration] = useState('180')
  const [totalMarks,    setTotalMarks]   = useState('100')
  const [progress,      setProgress]     = useState(0)
  const [uploading,     setUploading]    = useState(false)
  const [phase,         setPhase]        = useState('')
  const [error,         setError]        = useState('')
  const [lastUploaded,  setLastUploaded] = useState(null)
  const [errors,        setErrors]       = useState({})

  const acceptMain = category === 'lecture' ? 'video/*,.pdf,application/pdf' : '.pdf,application/pdf'

  function clearErr(field) {
    setErrors(prev => { const e = { ...prev }; delete e[field]; return e })
  }

  function resetForNextUpload() {
    setFile(null); setAnswerFile(null); setTitle(''); setDesc('')
    setProgress(0); setPhase(''); setErrors({})
    if (fileRef.current)       fileRef.current.value       = ''
    if (answerFileRef.current) answerFileRef.current.value = ''
  }

  // Picking a folder pre-fills folder name + subject + products only.
  // Category is per-file — a chapter can have lectures, Q.Bank and tests mixed.
  function selectFolder(fd) {
    setFolder(fd.folder)
    if (fd.subjectIds.length) setSubjectIds(fd.subjectIds)
    if (fd.productIds.length) setProductIds(fd.productIds)
    setLastUploaded(null)
    clearErr('folder')
  }

  function handleFile(f) {
    setFile(f)
    if (!title) setTitle(f.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' '))
    clearErr('file')
  }

  function runValidation() {
    const e = {}
    if (!file)               e.file     = 'Please select a file'
    if (!title.trim())       e.title    = 'Title is required'
    if (!folder.trim())      e.folder   = 'Chapter / folder name is required'
    if (category === 'lecture' && !unit.trim()) e.unit = 'Unit / Part is required for lectures'
    if (!subjectIds.length)  e.subjects = 'Select at least one subject'
    if (category === 'test_series' && !tsType) e.tsType = 'Select a test series type'
    if (category === 'test_series') {
      if (!(parseInt(testDuration, 10) > 0)) e.testDuration = 'Enter a valid duration'
      if (!(parseInt(totalMarks, 10)   > 0)) e.totalMarks   = 'Enter total marks'
    }
    return e
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = runValidation()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setUploading(true)
    setProgress(0)

    const isVid = file.type.startsWith('video/')

    // Video: TUS direct upload to Bunny Stream
    if (isVid) {
      setPhase('uploading')
      let prepareData
      try {
        prepareData = await apiFetch('/api/admin/content/prepare-upload', {
          method: 'POST',
          body: JSON.stringify({
            title: title.trim(), subjectIds,
            description: desc.trim(), order: 0, productIds,
            fileSize: file.size, fileName: file.name,
            category, folder: folder.trim(), unit: unit.trim(),
          }),
        })
      } catch (err) {
        setUploading(false); return setError(err.message)
      }

      const { content, tusEndpoint, tusHeaders } = prepareData
      onUploaded(content)

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
          await fetch(`${API_BASE}/api/admin/content/${content._id}/upload-complete`, {
            method: 'POST', headers: authHeaders(),
          }).catch(() => {})
          setUploading(false)
          setLastUploaded(content.title)
          resetForNextUpload()
        },
        onError(err) {
          setUploading(false); setError(`Upload failed: ${err.message}`)
        },
      })
      tusRef.current = upload
      upload.start()
      return
    }

    // PDF upload (all categories including test series)
    setPhase('uploading')
    const form = new FormData()
    form.append('file', file)
    form.append('title', title.trim())
    subjectIds.forEach(id => form.append('subjectIds', id))
    form.append('description', desc.trim())
    form.append('order', '0')
    productIds.forEach(id => form.append('productIds', id))
    form.append('category', category)
    form.append('folder', folder.trim())
    form.append('unit', unit.trim())
    if (category === 'test_series') {
      form.append('testSeriesType', tsType)
      form.append('testDuration', testDuration)
      form.append('totalMarks', totalMarks)
      if (answerFile) form.append('answerFile', answerFile)
    }

    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = ev => {
      if (ev.lengthComputable) setProgress(Math.round(ev.loaded / ev.total * 100))
    }
    xhr.onload = () => {
      setUploading(false)
      if (xhr.status >= 200 && xhr.status < 300) {
        const uploaded = JSON.parse(xhr.responseText).content
        onUploaded(uploaded)
        setLastUploaded(uploaded.title)
        resetForNextUpload()
      } else {
        try { setError(JSON.parse(xhr.responseText).error || 'Upload failed') }
        catch { setError('Upload failed') }
      }
    }
    xhr.onerror = () => { setUploading(false); setError('Network error') }
    xhr.open('POST', `${API_BASE}/api/admin/content/upload`)
    xhr.setRequestHeader('Authorization', `Bearer ${localStorage.getItem('admin_token')}`)
    xhr.send(form)
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
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Step 1 — Chapter / Folder (first so user picks context before anything else) */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Chapter / Folder <span className="text-red-500">*</span>
              <span className="text-gray-400 font-normal ml-1">— pick existing or type new</span>
            </label>
            <FolderCombobox
              recentFolders={recentFolders}
              value={folder}
              onChange={v => { setFolder(v); if (v.trim()) clearErr('folder') }}
              onSelectFolder={selectFolder}
              subjects={subjects}
            />
            {errors.folder
              ? <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>{errors.folder}</p>
              : folder.trim() && <p className="text-xs text-indigo-600 mt-1">Files grouped under <strong>{folder.trim()}</strong></p>
            }
          </div>

          {/* Step 1b — Unit / Part (groups files within a chapter) */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Unit / Part {category === 'lecture'
                ? <span className="text-red-500">*</span>
                : <span className="text-gray-400 font-normal">(optional)</span>}
              <span className="text-gray-400 font-normal ml-1">— pick existing or type new</span>
            </label>
            <input
              list="unit-suggestions"
              value={unit}
              onChange={e => { setUnit(e.target.value); if (e.target.value.trim()) clearErr('unit') }}
              placeholder="e.g. Unit 1: AS 1 — Disclosure of Accounting Policies"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <datalist id="unit-suggestions">
              {(recentFolders.find(f => f.folder === folder.trim())?.units || []).map(u => (
                <option key={u} value={u} />
              ))}
            </datalist>
            {errors.unit
              ? <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>{errors.unit}</p>
              : unit.trim() && <p className="text-xs text-indigo-600 mt-1">Under <strong>{folder.trim() || 'chapter'}</strong> → <strong>{unit.trim()}</strong></p>
            }
          </div>

          {/* Step 2 — Category */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">
              Content Type <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'lecture',       label: 'Lecture',     icon: '🎬', desc: 'Video / PDF lesson' },
                { value: 'question_bank', label: 'Q. Bank',     icon: '📚', desc: 'Practice questions' },
                { value: 'test_series',   label: 'Test Series', icon: '📝', desc: 'Question + Answer' },
              ].map(opt => (
                <button key={opt.value} type="button"
                  onClick={() => { setCategory(opt.value); setFile(null) }}
                  className={`px-2 py-2.5 rounded-xl border-2 text-center transition-all ${
                    category === opt.value
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}>
                  <div className="text-lg mb-0.5">{opt.icon}</div>
                  <p className={`text-xs font-bold ${category === opt.value ? 'text-indigo-700' : 'text-gray-700'}`}>{opt.label}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Test Series Type */}
          {category === 'test_series' && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Test Series Type <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                {TS_TYPES.map(t => (
                  <button key={t.value} type="button"
                    onClick={() => { setTsType(t.value); clearErr('tsType') }}
                    className={`flex-1 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                      tsType === t.value ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    }`}>
                    {t.label}
                  </button>
                ))}
              </div>
              {errors.tsType && <p className="text-xs text-red-500 mt-1">{errors.tsType}</p>}
            </div>
          )}

          {/* Test duration + total marks */}
          {category === 'test_series' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Duration (min) <span className="text-red-500">*</span>
                </label>
                <input type="number" min="1" value={testDuration}
                  onChange={e => { setTestDuration(e.target.value); clearErr('testDuration') }}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
                {errors.testDuration && <p className="text-xs text-red-500 mt-1">{errors.testDuration}</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Total Marks <span className="text-red-500">*</span>
                </label>
                <input type="number" min="1" value={totalMarks}
                  onChange={e => { setTotalMarks(e.target.value); clearErr('totalMarks') }}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
                {errors.totalMarks && <p className="text-xs text-red-500 mt-1">{errors.totalMarks}</p>}
              </div>
            </div>
          )}

          {/* Step 3 — File */}
          <div>
            <FilePicker
              fileRef={fileRef}
              file={file}
              setFile={handleFile}
              label={`${category === 'test_series' ? 'Question PDF' : 'File'} *`}
              accept={acceptMain}
              hint={category === 'lecture' ? 'Video (MP4, MKV…) or PDF' : 'PDF only'}
            />
            {errors.file && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>{errors.file}</p>}
          </div>

          {/* Answer PDF — test series only */}
          {category === 'test_series' && (
            <FilePicker
              fileRef={answerFileRef}
              file={answerFile}
              setFile={setAnswerFile}
              label="Answer PDF"
              accept=".pdf,application/pdf"
              hint="Optional — students never see this"
            />
          )}

          {/* Step 4 — Title */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Title <span className="text-red-500">*</span></label>
            <input type="text" value={title}
              onChange={e => { setTitle(e.target.value); if (e.target.value.trim()) clearErr('title') }}
              placeholder="e.g. Chapter 3 — Heads of Income"
              className={`w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent ${errors.title ? 'border-red-300 bg-red-50' : 'border-gray-200'}`} />
            {errors.title && <p className="text-xs text-red-500 mt-1">{errors.title}</p>}
          </div>

          {/* Step 5 — Subjects */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Subject <span className="text-red-500">*</span>
              <span className="text-gray-400 font-normal ml-1">(can pick multiple)</span>
            </label>
            <SubjectPicker subjects={subjects} selected={subjectIds}
              onChange={v => { setSubjectIds(v); if (v.length) clearErr('subjects') }} />
            {errors.subjects
              ? <p className="text-xs text-red-500 mt-1">{errors.subjects}</p>
              : subjectIds.length > 0 && <p className="text-xs text-indigo-600 mt-1">{subjectIds.length} subject{subjectIds.length > 1 ? 's' : ''} selected</p>
            }
          </div>

          {/* Products (optional) */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Link to Products <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <ProductPicker products={products} selected={productIds} onChange={setProductIds} />
          </div>

          {/* Description (optional) */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Description <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="Brief description…"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 space-y-3">
          {/* Upload error */}
          {error && !uploading && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
              <p className="text-xs text-red-700 flex-1">{error}</p>
              <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          )}

          {/* Success toast */}
          {lastUploaded && !uploading && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
              <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-green-700 truncate">"{lastUploaded}" uploaded</p>
                <p className="text-xs text-green-600">Select another file to upload to the same chapter</p>
              </div>
            </div>
          )}

          {/* Upload progress */}
          {uploading && (
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>
                  {phase === 'processing' ? 'Sent to Bunny — transcoding…'
                    : progress < 100 ? 'Uploading…'
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
                <p className="text-xs text-amber-600 mt-1">Bunny is transcoding the video. It will appear as Ready shortly.</p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={handleSubmit} disabled={uploading}
              className="flex-1 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 transition-colors text-sm">
              {uploading
                ? phase === 'processing' ? 'Transcoding…'
                  : progress < 100 ? `Uploading ${progress}%…`
                  : 'Finalising…'
                : 'Upload'}
            </button>
            {lastUploaded && !uploading && (
              <button onClick={onClose}
                className="px-4 py-2.5 text-sm font-semibold text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function EditModal({ item, products, subjects, onClose, onSaved }) {
  const [title,      setTitle]      = useState(item.title)
  const [subjectIds, setSubjectIds] = useState(() => {
    const fromArr = (item.subjectIds || []).map(s => s?._id || s).filter(Boolean)
    if (fromArr.length) return fromArr
    const legacy = item.subjectId?._id || item.subjectId
    return legacy ? [String(legacy)] : []
  })
  const [productIds, setProductIds] = useState(() => {
    const fromArr = (item.productIds || []).map(p => p?._id || p).filter(Boolean)
    if (fromArr.length) return fromArr
    const legacy = item.productId?._id || item.productId
    return legacy ? [legacy] : []
  })
  const [desc,     setDesc]     = useState(item.description || '')
  const [order,    setOrder]    = useState(String(item.order ?? 0))
  const [category, setCategory] = useState(item.category || 'lecture')
  const [folder,   setFolder]   = useState(item.folder || '')
  const [unit,     setUnit]     = useState(item.unit || '')
  const [tsType,   setTsType]   = useState(item.testSeriesType || 'chapter_wise')
  const [testDuration, setTestDuration] = useState(String(item.testDuration ?? 180))
  const [totalMarks,   setTotalMarks]   = useState(String(item.totalMarks ?? 100))
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  async function handleSave() {
    setSaving(true); setError('')
    try {
      const data = await apiFetch(`/api/admin/content/${item._id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: title.trim(), subjectIds, productIds,
          description: desc.trim(), order: parseInt(order),
          category, folder: folder.trim(), unit: unit.trim(),
          testSeriesType: category === 'test_series' ? tsType : null,
          testDuration: category === 'test_series' ? parseInt(testDuration, 10) || 180 : null,
          totalMarks:   category === 'test_series' ? parseInt(totalMarks, 10)   || 100 : null,
        }),
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
        <div className="px-5 py-4 space-y-3 overflow-y-auto max-h-[75vh]">
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>

          {/* Category */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Category</label>
            <div className="flex gap-2">
              {[['lecture','Lecture'],['question_bank','Q. Bank'],['test_series','Test Series']].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setCategory(v)}
                  className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                    category === v ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>{l}</button>
              ))}
            </div>
          </div>

          {/* Test series type */}
          {category === 'test_series' && (
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Test Series Type</label>
              <div className="flex gap-2">
                {TS_TYPES.map(t => (
                  <button key={t.value} type="button" onClick={() => setTsType(t.value)}
                    className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                      tsType === t.value ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}>{t.label}</button>
                ))}
              </div>
            </div>
          )}

          {/* Test duration + total marks */}
          {category === 'test_series' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Duration (min)</label>
                <input type="number" min="1" value={testDuration} onChange={e => setTestDuration(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Total Marks</label>
                <input type="number" min="1" value={totalMarks} onChange={e => setTotalMarks(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
            </div>
          )}

          {/* Folder */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Chapter / Folder Name</label>
            <input value={folder} onChange={e => setFolder(e.target.value)}
              placeholder="e.g. Chapter 3 — Heads of Income"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>

          {/* Unit / Part */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Unit / Part</label>
            <input value={unit} onChange={e => setUnit(e.target.value)}
              placeholder="e.g. Unit 1: AS 1 — Disclosure of Accounting Policies"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>

          {/* Answer PDF info */}
          {item.answerUrl && (
            <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <svg className="w-4 h-4 text-rose-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" /></svg>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-rose-700">Answer PDF attached</p>
                <p className="text-xs text-rose-500">{fmtSize(item.answerSize)}</p>
              </div>
              <a
                href={`${API_BASE}/api/admin/content/${item._id}/preview?part=answer&token=${localStorage.getItem('admin_token')}`}
                target="_blank" rel="noreferrer"
                className="text-xs font-semibold text-rose-600 underline hover:text-rose-800"
              >View</a>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">
              Subject <span className="text-gray-400">(tick all that apply)</span>
            </label>
            <SubjectPicker subjects={subjects} selected={subjectIds} onChange={setSubjectIds} />
            {subjectIds.length > 0 && (
              <p className="text-xs text-indigo-600 mt-1">{subjectIds.length} subject{subjectIds.length > 1 ? 's' : ''} selected</p>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">
              Products <span className="text-gray-400">(tick all that apply)</span>
            </label>
            <ProductPicker products={products} selected={productIds} onChange={setProductIds} />
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
  const [items,        setItems]       = useState([])
  const [products,     setProducts]    = useState([])
  const [subjects,     setSubjects]    = useState([])
  const [allFolders,   setAllFolders]  = useState([])   // fetched from server — all folders ever used
  const [loading,      setLoading]     = useState(true)
  const [total,        setTotal]       = useState(0)
  const [page,         setPage]        = useState(1)
  const [filterType,    setFType]    = useState('')
  const [filterSubject, setFSubject] = useState('')
  const [filterFolder,  setFFolder]  = useState('')
  const [search,         setSearch]   = useState('')
  const [filesCat,       setFilesCat] = useState('')  // client-side category filter inside a folder
  const [view,            setView]           = useState('subjects') // 'subjects' | 'folders' | 'files'
  const [selectedSubject, setSelectedSubject] = useState(null)
  const [showUpload,  setShowUpload] = useState(false)
  const [editItem,    setEditItem]  = useState(null)
  const [deleting,    setDeleting]  = useState(null)

  const LIMIT = 15

  useEffect(() => {
    apiFetch('/api/admin/products?limit=10000').then(d => setProducts(d.products || [])).catch(() => {})
    apiFetch('/api/admin/subjects').then(d => setSubjects(d.subjects || [])).catch(() => {})
    apiFetch('/api/admin/content/folders').then(d => setAllFolders(d.folders || [])).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    // Inside a folder: load all files at once (no pagination)
    const activeLimit = filterFolder ? 200 : LIMIT
    const params = new URLSearchParams({ page: filterFolder ? 1 : page, limit: activeLimit })
    if (filterType)    params.set('type',      filterType)
    if (filterSubject) params.set('subjectId', filterSubject)
    if (filterFolder)  params.set('folder',    filterFolder)
    if (search)        params.set('search',    search)
    apiFetch(`/api/admin/content?${params}`)
      .then(d => { setItems(d.content || []); setTotal(d.total || 0) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [page, filterType, filterSubject, filterFolder, search])

  function handleUploaded(content) {
    setItems(prev => [content, ...prev])
    setTotal(t => t + 1)
    // Refresh folder list so a newly-created folder shows up immediately on next open
    if (content.folder?.trim()) {
      apiFetch('/api/admin/content/folders').then(d => setAllFolders(d.folders || [])).catch(() => {})
    }
  }

  // Auto-refresh while any video is still processing
  useEffect(() => {
    const hasProcessing = items.some(i => i.status === 'processing')
    if (!hasProcessing) return
    const timer = setInterval(() => {
      const params = new URLSearchParams({ page, limit: LIMIT })
      if (filterType)    params.set('type',      filterType)
      if (filterSubject) params.set('subjectId', filterSubject)
      if (filterFolder)  params.set('folder',    filterFolder)
      if (search)        params.set('search',    search)
      apiFetch(`/api/admin/content?${params}`)
        .then(d => setItems(d.content || []))
        .catch(() => {})
    }, 15000)
    return () => clearInterval(timer)
  }, [items, page, filterType, filterSubject, filterFolder, search])

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
  }

  // ── Navigation helpers ──────────────────────────────────────────────────
  const subjectsWithData = subjects.map(s => {
    const fds = allFolders.filter(f => f.subjectIds.includes(s._id))
    return { ...s, folderCount: fds.length, fileCount: fds.reduce((n, f) => n + f.itemCount, 0) }
  })

  const foldersForSubject = selectedSubject
    ? allFolders.filter(f => f.subjectIds.includes(selectedSubject._id))
    : allFolders

  function navToSubjects() {
    setView('subjects'); setSelectedSubject(null); setFFolder(''); setFSubject(''); setPage(1)
  }
  function navToFolders(subj) {
    setView('folders'); setSelectedSubject(subj); setFSubject(subj._id); setFFolder(''); setPage(1)
  }
  function navToFiles(fd) {
    setView('files'); setFFolder(fd.folder); setPage(1)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6 max-w-7xl mx-auto">

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-xs mb-1.5">
            <button onClick={navToSubjects}
              className={`font-medium transition-colors ${view === 'subjects' ? 'text-gray-900' : 'text-gray-400 hover:text-gray-700'}`}>
              Content Library
            </button>
            {selectedSubject && (
              <>
                <svg className="w-3 h-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                <button onClick={() => navToFolders(selectedSubject)}
                  className={`font-medium transition-colors ${view === 'folders' ? 'text-gray-900' : 'text-gray-400 hover:text-gray-700'}`}>
                  {selectedSubject.name}
                </button>
              </>
            )}
            {filterFolder && (
              <>
                <svg className="w-3 h-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                <span className="font-medium text-gray-900">{filterFolder}</span>
              </>
            )}
          </nav>
          <h1 className="text-2xl font-bold text-gray-900">
            {view === 'subjects' ? 'Content Library' : view === 'folders' ? selectedSubject?.name : filterFolder}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {view === 'subjects' && 'Lectures, Question Bank & Test Series'}
            {view === 'folders' && selectedSubject && (
              <span>
                <span className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded-full mr-2 ${LEVEL_COLORS[selectedSubject.level]}`}>{selectedSubject.level}</span>
                {foldersForSubject.length} folder{foldersForSubject.length !== 1 ? 's' : ''}
              </span>
            )}
            {view === 'files' && `${total} file${total !== 1 ? 's' : ''} in this folder`}
          </p>
        </div>
        <button onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors shadow-sm">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
          </svg>
          Upload
        </button>
      </div>

      {/* ── SUBJECTS VIEW ── */}
      {view === 'subjects' && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
              </div>
              <div><p className="text-xl font-bold text-gray-900">{subjectsWithData.filter(s=>s.folderCount>0).length}</p><p className="text-xs text-gray-500">Subjects</p></div>
            </div>
            <div className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
              </div>
              <div><p className="text-xl font-bold text-gray-900">{allFolders.length}</p><p className="text-xs text-gray-500">Folders</p></div>
            </div>
            <div className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
              </div>
              <div><p className="text-xl font-bold text-gray-900">{allFolders.reduce((n,f)=>n+f.itemCount,0)}</p><p className="text-xs text-gray-500">Total Files</p></div>
            </div>
          </div>

          {/* Subject Cards */}
          {subjectsWithData.filter(s=>s.folderCount>0).length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm p-16 text-center">
              <svg className="w-16 h-16 text-gray-200 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
              <p className="text-gray-500 font-medium mb-1">No content uploaded yet</p>
              <p className="text-sm text-gray-400">Upload your first video or PDF with a folder name to get started</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {subjectsWithData.filter(s=>s.folderCount>0).map(s => {
                const lc = {
                  Foundation:   { bar:'bg-emerald-500', badge:'bg-emerald-100 text-emerald-700', ring:'hover:ring-emerald-200' },
                  Intermediate: { bar:'bg-blue-500',    badge:'bg-blue-100 text-blue-700',       ring:'hover:ring-blue-200' },
                  Final:        { bar:'bg-purple-500',  badge:'bg-purple-100 text-purple-700',   ring:'hover:ring-purple-200' },
                }[s.level] || { bar:'bg-gray-400', badge:'bg-gray-100 text-gray-600', ring:'hover:ring-gray-200' }
                return (
                  <button key={s._id} onClick={() => navToFolders(s)}
                    className={`bg-white rounded-2xl shadow-sm ring-2 ring-transparent ${lc.ring} p-5 text-left transition-all hover:shadow-md group`}>
                    <div className="flex items-start justify-between mb-4">
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-xl ${lc.bar}`}>
                        {s.name.charAt(0).toUpperCase()}
                      </div>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${lc.badge}`}>{s.level}</span>
                    </div>
                    <h3 className="font-bold text-gray-900 text-base mb-3">{s.name}</h3>
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1.5 text-xs text-gray-500">
                        <svg className="w-3.5 h-3.5 text-amber-400" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
                        {s.folderCount} folder{s.folderCount!==1?'s':''}
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-gray-500">
                        <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
                        {s.fileCount} file{s.fileCount!==1?'s':''}
                      </span>
                    </div>
                    <div className="mt-3 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-xs font-semibold text-indigo-600 flex items-center gap-1">
                        View folders <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ── FOLDERS VIEW ── */}
      {view === 'folders' && (
        foldersForSubject.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-16 text-center">
            <svg className="w-16 h-16 text-gray-200 mx-auto mb-4" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
            <p className="text-gray-500 font-medium mb-1">No folders in this subject yet</p>
            <p className="text-sm text-gray-400 mb-4">Upload content and set a chapter/folder name</p>
            <button onClick={() => setShowUpload(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Upload Content</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {foldersForSubject.map(fd => (
              <button key={fd.folder} onClick={() => navToFiles(fd)}
                className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-left hover:shadow-md hover:border-indigo-200 transition-all group">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {fd.lectures > 0 && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">{fd.lectures}L</span>
                    )}
                    {fd.questionBank > 0 && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">{fd.questionBank}QB</span>
                    )}
                    {fd.testSeries > 0 && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">{fd.testSeries}TS</span>
                    )}
                  </div>
                </div>
                <p className="text-sm font-bold text-gray-900 leading-snug line-clamp-2 mb-2">{fd.folder}</p>
                <div className="flex items-center justify-between mt-auto">
                  <span className="text-xs font-semibold text-indigo-600">{fd.itemCount} {fd.itemCount===1?'file':'files'}</span>
                  <svg className="w-4 h-4 text-gray-300 group-hover:text-indigo-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                </div>
              </button>
            ))}
          </div>
        )
      )}

      {/* ── FILES VIEW ── */}
      {view === 'files' && (() => {
        const lectureCount    = items.filter(i => (i.category||'lecture') === 'lecture').length
        const qbankCount      = items.filter(i => i.category === 'question_bank').length
        const testSeriesCount = items.filter(i => i.category === 'test_series').length
        const displayItems    = filesCat ? items.filter(i => (i.category||'lecture') === filesCat) : items
        return (
          <>
            {/* Category tabs */}
            <div className="flex items-center gap-2 mb-4">
              {[
                { v: '',              l: 'All',         count: items.length,    color: '' },
                { v: 'lecture',       l: '🎬 Lectures', count: lectureCount,    color: 'text-blue-600' },
                { v: 'question_bank', l: '📚 Q. Bank',  count: qbankCount,      color: 'text-amber-600' },
                { v: 'test_series',   l: '📝 Tests',    count: testSeriesCount, color: 'text-rose-600' },
              ].filter(t => t.v === '' || t.count > 0).map(t => (
                <button key={t.v} onClick={() => setFilesCat(t.v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                    filesCat === t.v
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}>
                  {t.l} <span className={`ml-1 ${filesCat === t.v ? 'opacity-80' : t.color}`}>{t.count}</span>
                </button>
              ))}
            </div>

            {/* Search + type filter */}
            <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
              <div className="flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[180px]">
                  <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                  <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Search in this folder…"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400"/>
                </div>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                  {[['','All'],['video','Videos'],['pdf','PDFs']].map(([v,l])=>(
                    <button key={v} onClick={()=>{setFType(v);setPage(1)}}
                      className={`px-3 py-2 font-medium transition-colors ${filterType===v?'bg-indigo-600 text-white':'bg-white text-gray-600 hover:bg-gray-50'}`}>{l}</button>
                  ))}
                </div>
                {(search||filterType||filesCat) && (
                  <button onClick={()=>{setSearch('');setFType('');setFilesCat('')}} className="text-xs text-indigo-600 font-medium hover:underline">Clear</button>
                )}
              </div>
            </div>

            {/* File table */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    <th className="text-left px-5 py-3">Title</th>
                    <th className="text-left px-4 py-3">Type</th>
                    <th className="text-left px-4 py-3">Category</th>
                    <th className="text-left px-4 py-3">Size</th>
                    <th className="text-left px-4 py-3">Date</th>
                    <th className="px-4 py-3"/>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(4)].map((_,i)=>(
                      <tr key={i} className="border-b border-gray-50 animate-pulse">
                        {[5,3,3,3,3,2].map((w,j)=>(
                          <td key={j} className="px-4 py-3"><div className={`h-4 bg-gray-100 rounded w-${w}/5`}/></td>
                        ))}
                      </tr>
                    ))
                  ) : displayItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-16 text-center">
                        <svg className="w-12 h-12 text-gray-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
                        <p className="text-gray-400 text-sm">{filesCat ? 'No files in this category' : 'No files in this folder yet'}</p>
                      </td>
                    </tr>
                  ) : displayItems.map(item=>(
                    <tr key={item._id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${item.type==='video'?'bg-blue-100':'bg-red-100'}`}>
                            {item.type==='video'
                              ? <svg className="w-3.5 h-3.5 text-blue-600" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z"/></svg>
                              : <svg className="w-3.5 h-3.5 text-red-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd"/></svg>
                            }
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 truncate max-w-[220px]">{item.title}</p>
                            {item.unit && <p className="text-[11px] text-indigo-500 truncate max-w-[220px]">{item.unit}</p>}
                            {item.status==='processing' && (
                              <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">
                                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                                Processing…
                              </span>
                            )}
                            {item.status==='error' && <span className="text-xs text-red-500">Upload failed</span>}
                            {item.answerUrl && <span className="text-xs text-rose-500">+ Answer PDF</span>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><TypeBadge type={item.type}/></td>
                      <td className="px-4 py-3">
                        <CatBadge category={item.category||'lecture'}/>
                        {item.testSeriesType && (
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {TS_TYPES.find(t=>t.value===item.testSeriesType)?.label}
                          </p>
                        )}
                        {item.category==='test_series' && (item.testDuration!=null || item.totalMarks!=null) && (
                          <p className="text-[10px] text-indigo-500 mt-0.5 font-medium">
                            {[item.testDuration!=null && `⏱ ${item.testDuration} min`, item.totalMarks!=null && `📝 ${item.totalMarks} marks`].filter(Boolean).join(' · ')}
                          </p>
                        )}
                        {item.answerUrl && (
                          <p className="text-[10px] text-rose-400 mt-0.5 font-medium">+ Answer</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{item.sizeLabel}</td>
                      <td className="px-4 py-3 text-gray-400">{fmtDate(item.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <a href={`${API_BASE}/api/admin/content/${item._id}/preview?token=${localStorage.getItem('admin_token')}`}
                            target="_blank" rel="noreferrer"
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors" title="Preview">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                          </a>
                          {item.answerUrl && (
                            <a href={`${API_BASE}/api/admin/content/${item._id}/preview?part=answer&token=${localStorage.getItem('admin_token')}`}
                              target="_blank" rel="noreferrer"
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-rose-50 hover:text-rose-600 transition-colors" title="Answer PDF">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                            </a>
                          )}
                          <button onClick={()=>setEditItem(item)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                          </button>
                          <button onClick={()=>handleDelete(item)} disabled={deleting===item._id}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      })()}

      {/* Upload Drawer */}
      {showUpload && (
        <UploadDrawer
          products={products}
          subjects={subjects}
          recentFolders={allFolders}
          onClose={()=>setShowUpload(false)}
          onUploaded={handleUploaded}
        />
      )}

      {/* Edit Modal */}
      {editItem && (
        <EditModal
          item={editItem}
          products={products}
          subjects={subjects}
          onClose={()=>setEditItem(null)}
          onSaved={handleSaved}
        />
      )}
      </div>
    </div>
  )
}
