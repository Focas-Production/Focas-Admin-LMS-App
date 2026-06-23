import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../../api'

const CA_LEVELS = ['Foundation', 'Intermediate', 'Final']

const LEVEL_BADGE = {
  Foundation:   'bg-green-100 text-green-700',
  Intermediate: 'bg-yellow-100 text-yellow-700',
  Final:        'bg-purple-100 text-purple-700',
}

const LEVEL_CHECK = {
  Foundation:   'text-green-700',
  Intermediate: 'text-yellow-700',
  Final:        'text-purple-700',
}

// ─── Subject picker (grouped by level) ────────────────────────────────────────
function SubjectPicker({ subjects, selected, onChange }) {
  const grouped = CA_LEVELS.reduce((acc, lv) => {
    acc[lv] = subjects.filter(s => s.level === lv)
    return acc
  }, {})

  const toggle = id => {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  }

  return (
    <div className="space-y-2">
      {CA_LEVELS.map(lv => {
        if (!grouped[lv].length) return null
        return (
          <div key={lv}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">{lv}</p>
            <div className="max-h-28 overflow-y-auto space-y-0.5 pr-1">
              {grouped[lv].map(s => (
                <label key={s._id} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer hover:text-gray-900">
                  <input
                    type="checkbox"
                    checked={selected.includes(s._id)}
                    onChange={() => toggle(s._id)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  {s.name}
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Content Access Panel ──────────────────────────────────────────────────────
function ContentAccessPanel({ product, subjects }) {
  const [levels,     setLevels]     = useState(product.contentAccess?.levels     ?? [])
  const [subjectIds, setSubjectIds] = useState(
    (product.contentAccess?.subjectIds ?? []).map(id => (typeof id === 'object' ? id._id ?? id : id))
  )
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState(null)

  const toggleLevel = lv => {
    setLevels(prev => prev.includes(lv) ? prev.filter(x => x !== lv) : [...prev, lv])
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await apiFetch(`/api/admin/products/${product._id}/content-access`, {
        method: 'PUT',
        body: JSON.stringify({ levels, subjectIds }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const dirty =
    JSON.stringify([...levels].sort()) !== JSON.stringify([...(product.contentAccess?.levels ?? [])].sort()) ||
    JSON.stringify([...subjectIds].sort()) !== JSON.stringify(
      [...((product.contentAccess?.subjectIds ?? []).map(id => (typeof id === 'object' ? id._id ?? id : id)))].sort()
    )

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">LMS Content Access</p>

      {/* Level checkboxes */}
      <div className="mb-3">
        <p className="text-[11px] text-gray-400 mb-1.5">Grant entire levels</p>
        <div className="flex flex-wrap gap-2">
          {CA_LEVELS.map(lv => (
            <label key={lv} className={`flex items-center gap-1.5 text-xs font-medium cursor-pointer ${LEVEL_CHECK[lv]}`}>
              <input
                type="checkbox"
                checked={levels.includes(lv)}
                onChange={() => toggleLevel(lv)}
                className="rounded border-gray-300 focus:ring-indigo-500"
              />
              {lv}
            </label>
          ))}
        </div>
      </div>

      {/* Subject picker */}
      {subjects.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] text-gray-400 mb-1.5">Grant specific subjects</p>
          <SubjectPicker subjects={subjects} selected={subjectIds} onChange={ids => { setSubjectIds(ids); setSaved(false) }} />
        </div>
      )}

      {/* Save row */}
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={handleSave}
          disabled={saving || (!dirty && !saved)}
          className="text-xs px-3 py-1 rounded-lg bg-indigo-600 text-white font-medium disabled:opacity-40 hover:bg-indigo-700 transition-colors"
        >
          {saving ? 'Saving…' : 'Save Access'}
        </button>
        {saved  && <span className="text-xs text-green-600 font-medium">Saved</span>}
        {error  && <span className="text-xs text-red-500">{error}</span>}
      </div>
    </div>
  )
}

// ─── Test-series access (independent of content access) ─────────────────────────
function TestSeriesAccessPanel({ product, subjects }) {
  const ts = product.testSeriesAccess || {}
  const [enabled,    setEnabled]    = useState(!!ts.enabled)
  const [levels,     setLevels]     = useState(ts.levels ?? [])
  const [subjectIds, setSubjectIds] = useState(
    (ts.subjectIds ?? []).map(id => (typeof id === 'object' ? id._id ?? id : id))
  )
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState(null)

  const toggleLevel = lv => {
    setLevels(prev => prev.includes(lv) ? prev.filter(x => x !== lv) : [...prev, lv])
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true); setError(null); setSaved(false)
    try {
      await apiFetch(`/api/admin/products/${product._id}/test-series-access`, {
        method: 'PUT',
        body: JSON.stringify({ enabled, levels, subjectIds }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const orig = {
    enabled: !!ts.enabled,
    levels: [...(ts.levels ?? [])].sort(),
    subjectIds: [...((ts.subjectIds ?? []).map(id => (typeof id === 'object' ? id._id ?? id : id)))].sort(),
  }
  const dirty =
    enabled !== orig.enabled ||
    JSON.stringify([...levels].sort()) !== JSON.stringify(orig.levels) ||
    JSON.stringify([...subjectIds].sort()) !== JSON.stringify(orig.subjectIds)

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <label className="flex items-center justify-between cursor-pointer mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Test Series Access</p>
        <span className="relative inline-flex items-center">
          <input type="checkbox" checked={enabled} onChange={() => { setEnabled(v => !v); setSaved(false) }} className="sr-only peer" />
          <span className="w-9 h-5 bg-gray-200 rounded-full peer-checked:bg-emerald-500 transition-colors" />
          <span className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
        </span>
      </label>

      {!enabled ? (
        <p className="text-[11px] text-gray-400">This product does not grant test-series access.</p>
      ) : (
        <>
          <div className="mb-3">
            <p className="text-[11px] text-gray-400 mb-1.5">Grant entire levels (all subjects in the level)</p>
            <div className="flex flex-wrap gap-2">
              {CA_LEVELS.map(lv => (
                <label key={lv} className={`flex items-center gap-1.5 text-xs font-medium cursor-pointer ${LEVEL_CHECK[lv]}`}>
                  <input type="checkbox" checked={levels.includes(lv)} onChange={() => toggleLevel(lv)}
                    className="rounded border-gray-300 focus:ring-emerald-500" />
                  {lv}
                </label>
              ))}
            </div>
          </div>

          {subjects.length > 0 && (
            <div className="mb-3">
              <p className="text-[11px] text-gray-400 mb-1.5">Or grant specific subjects only</p>
              <SubjectPicker subjects={subjects} selected={subjectIds} onChange={ids => { setSubjectIds(ids); setSaved(false) }} />
            </div>
          )}
        </>
      )}

      <div className="flex items-center gap-2 mt-2">
        <button onClick={handleSave} disabled={saving || (!dirty && !saved)}
          className="text-xs px-3 py-1 rounded-lg bg-emerald-600 text-white font-medium disabled:opacity-40 hover:bg-emerald-700 transition-colors">
          {saving ? 'Saving…' : 'Save Test Access'}
        </button>
        {saved && <span className="text-xs text-green-600 font-medium">Saved</span>}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    </div>
  )
}

// ─── Lecture (video) access (independent of content access) ──────────────────────
function LectureAccessPanel({ product, subjects }) {
  const la = product.lectureAccess || {}
  const [enabled,    setEnabled]    = useState(!!la.enabled)
  const [levels,     setLevels]     = useState(la.levels ?? [])
  const [subjectIds, setSubjectIds] = useState(
    (la.subjectIds ?? []).map(id => (typeof id === 'object' ? id._id ?? id : id))
  )
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState(null)

  const toggleLevel = lv => {
    setLevels(prev => prev.includes(lv) ? prev.filter(x => x !== lv) : [...prev, lv])
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true); setError(null); setSaved(false)
    try {
      await apiFetch(`/api/admin/products/${product._id}/lecture-access`, {
        method: 'PUT',
        body: JSON.stringify({ enabled, levels, subjectIds }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const orig = {
    enabled: !!la.enabled,
    levels: [...(la.levels ?? [])].sort(),
    subjectIds: [...((la.subjectIds ?? []).map(id => (typeof id === 'object' ? id._id ?? id : id)))].sort(),
  }
  const dirty =
    enabled !== orig.enabled ||
    JSON.stringify([...levels].sort()) !== JSON.stringify(orig.levels) ||
    JSON.stringify([...subjectIds].sort()) !== JSON.stringify(orig.subjectIds)

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <label className="flex items-center justify-between cursor-pointer mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Lecture (Video) Access</p>
        <span className="relative inline-flex items-center">
          <input type="checkbox" checked={enabled} onChange={() => { setEnabled(v => !v); setSaved(false) }} className="sr-only peer" />
          <span className="w-9 h-5 bg-gray-200 rounded-full peer-checked:bg-blue-500 transition-colors" />
          <span className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
        </span>
      </label>

      {!enabled ? (
        <p className="text-[11px] text-gray-400">No lecture videos for this product (e.g. Lite/Pro — Q.Bank &amp; Test Series only).</p>
      ) : (
        <>
          <div className="mb-3">
            <p className="text-[11px] text-gray-400 mb-1.5">Grant entire levels (all subjects in the level)</p>
            <div className="flex flex-wrap gap-2">
              {CA_LEVELS.map(lv => (
                <label key={lv} className={`flex items-center gap-1.5 text-xs font-medium cursor-pointer ${LEVEL_CHECK[lv]}`}>
                  <input type="checkbox" checked={levels.includes(lv)} onChange={() => toggleLevel(lv)}
                    className="rounded border-gray-300 focus:ring-blue-500" />
                  {lv}
                </label>
              ))}
            </div>
          </div>

          {subjects.length > 0 && (
            <div className="mb-3">
              <p className="text-[11px] text-gray-400 mb-1.5">Or grant specific subjects only</p>
              <SubjectPicker subjects={subjects} selected={subjectIds} onChange={ids => { setSubjectIds(ids); setSaved(false) }} />
            </div>
          )}
        </>
      )}

      <div className="flex items-center gap-2 mt-2">
        <button onClick={handleSave} disabled={saving || (!dirty && !saved)}
          className="text-xs px-3 py-1 rounded-lg bg-blue-600 text-white font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors">
          {saving ? 'Saving…' : 'Save Lecture Access'}
        </button>
        {saved && <span className="text-xs text-green-600 font-medium">Saved</span>}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function ProductsPage() {
  const [products,  setProducts]  = useState([])
  const [subjects,  setSubjects]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [expanded,  setExpanded]  = useState({})   // { [productId]: boolean }

  useEffect(() => {
    Promise.all([
      apiFetch('/api/admin/products').then(d => d.products || []),
      apiFetch('/api/admin/subjects').then(d => d.subjects || []),
    ])
      .then(([prods, subs]) => { setProducts(prods); setSubjects(subs) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const toggleExpand = useCallback(id => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }, [])

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Products</h1>
        <p className="text-gray-400 text-sm mt-0.5">{products.length} products</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading
          ? Array(6).fill(0).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-5 shadow-sm animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/2 mb-4" />
                <div className="h-6 bg-gray-100 rounded w-1/4" />
              </div>
            ))
          : products.map(p => {
              const hasAccess = (p.contentAccess?.levels?.length || p.contentAccess?.subjectIds?.length)
              return (
                <div key={p._id} className="bg-white rounded-2xl p-5 shadow-sm">
                  {/* Product header */}
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900 text-sm leading-snug">{p.name}</h3>
                    {p.level && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${LEVEL_BADGE[p.level] || 'bg-gray-100 text-gray-600'}`}>
                        {p.level}
                      </span>
                    )}
                  </div>
                  {p.category && (
                    <p className="text-xs text-gray-400 mb-3">
                      {p.category}{p.subCategory ? ` · ${p.subCategory}` : ''}
                    </p>
                  )}

                  {/* Price + tags */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {p.originalPrice && p.originalPrice > p.price && (
                        <span className="text-xs text-gray-400 line-through">₹{p.originalPrice.toLocaleString('en-IN')}</span>
                      )}
                      <span className="text-base font-bold text-indigo-600">₹{(p.price || 0).toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex gap-1.5">
                      {p.isCourse   && <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">Course</span>}
                      {p.shipToHome && <span className="text-xs px-2 py-0.5 bg-orange-50 text-orange-600 rounded-full">Physical</span>}
                    </div>
                  </div>

                  {p.stock != null && (
                    <p className="text-xs text-gray-400 mt-2">
                      Stock: <span className={p.stock <= 5 ? 'text-red-500 font-medium' : 'text-gray-600'}>{p.stock}</span>
                    </p>
                  )}

                  {/* Toggle button */}
                  <button
                    onClick={() => toggleExpand(p._id)}
                    className="mt-3 flex items-center gap-1.5 text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                  >
                    <svg className={`w-3.5 h-3.5 transition-transform ${expanded[p._id] ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    LMS Access
                    {hasAccess && !expanded[p._id] && (
                      <span className="ml-1 w-1.5 h-1.5 rounded-full bg-green-400 inline-block" title="Has content access configured" />
                    )}
                  </button>

                  {/* Expandable panel */}
                  {expanded[p._id] && (
                    <>
                      <ContentAccessPanel product={p} subjects={subjects} />
                      <LectureAccessPanel product={p} subjects={subjects} />
                      <TestSeriesAccessPanel product={p} subjects={subjects} />
                    </>
                  )}
                </div>
              )
            })
        }
      </div>
    </div>
  )
}
