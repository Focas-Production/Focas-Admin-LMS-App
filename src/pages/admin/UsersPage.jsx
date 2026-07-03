import { useState, useEffect } from 'react'
import { apiFetch } from '../../api'

function fmtDate(d) {
  if (!d) return '—'
  const date = new Date(d)
  const datePart = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const timePart = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  return `${datePart}, ${timePart}`
}

function fmtDuration(sec) {
  if (!sec) return '0m'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function ProgressModal({ user, onClose }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch(`/api/admin/users/${user._id}/progress`)
      .then(d => setData(d))
      .catch(() => setData({ progress: [], totalSeconds: 0 }))
      .finally(() => setLoading(false))
  }, [user._id])

  // Group by product
  const byProduct = {}
  ;(data?.progress || []).forEach(p => {
    const pid = p.productId?._id || p.productId || 'unknown'
    const pname = p.productId?.name || 'Unknown Product'
    if (!byProduct[pid]) byProduct[pid] = { name: pname, items: [] }
    byProduct[pid].items.push(p)
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">Watch Progress</h2>
            <p className="text-xs text-gray-400 mt-0.5">{user.name || user.phoneNumber} · Total: {fmtDuration(data?.totalSeconds)}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 max-h-[65vh] overflow-y-auto">
          {loading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
          ) : (data?.progress || []).length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <svg className="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.871v6.258a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
              <p className="text-sm font-medium">No watch history yet</p>
            </div>
          ) : (
            <div className="space-y-5">
              {Object.values(byProduct).map((group, gi) => (
                <div key={gi}>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-2">
                    <span className="w-4 h-4 bg-indigo-100 rounded flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
                      </svg>
                    </span>
                    {group.name}
                  </p>
                  <div className="space-y-2">
                    {group.items.map((p, i) => {
                      const pct = Math.min(100, p.watchedSeconds > 0 ? 100 : 0)
                      const lastSeen = fmtDate(p.updatedAt)
                      return (
                        <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            p.contentId?.type === 'video' ? 'bg-blue-100' : 'bg-red-100'
                          }`}>
                            {p.contentId?.type === 'video'
                              ? <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z"/></svg>
                              : <svg className="w-4 h-4 text-red-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd"/></svg>
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {p.contentId?.title || 'Unknown'}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {p.contentId?.subject && (
                                <span className="text-xs text-gray-400">{p.contentId.subject}</span>
                              )}
                              <span className="text-xs text-indigo-600 font-medium">
                                {fmtDuration(p.watchedSeconds)} watched
                              </span>
                              {p.lastPosition > 0 && (
                                <span className="text-xs text-gray-400">· at {fmtDuration(p.lastPosition)}</span>
                              )}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs text-gray-400">{lastSeen}</p>
                            {p.completed && (
                              <span className="text-xs text-green-600 font-semibold">✓ Done</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t flex justify-between items-center">
          <div className="text-xs text-gray-400">
            {(data?.progress || []).length} videos tracked
          </div>
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function AccessModal({ user, onClose, onUpdated }) {
  const [access,   setAccess]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editDate, setEditDate] = useState('')

  useEffect(() => {
    apiFetch(`/api/admin/users/${user._id}/access`)
      .then(d => setAccess(d.productAccess || []))
      .catch(() => setAccess([]))
      .finally(() => setLoading(false))
  }, [user._id])

  async function handleUpdateAccess(productId) {
    if (!editDate) return setError('Please select a date')
    setSaving(true); setError('')
    try {
      await apiFetch(`/api/admin/users/${user._id}/access/${productId}`, {
        method: 'PATCH',
        body: JSON.stringify({ expiresAt: new Date(editDate) }),
      })
      setEditingId(null)
      setEditDate('')
      setAccess(prev => prev.map(a =>
        a.productId === productId ? { ...a, expiresAt: new Date(editDate) } : a
      ))
      onUpdated?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">Manage Access</h2>
            <p className="text-xs text-gray-400 mt-0.5">{user.name || user.phoneNumber}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 max-h-[65vh] overflow-y-auto">
          {loading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
          ) : access.length === 0 ? (
            <div className="text-center py-12">
              <svg className="w-10 h-10 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 015.646 5.646 9 9 0 1020.354 15.354z" />
              </svg>
              <p className="text-sm font-medium text-gray-400">No purchases yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {access.map(a => {
                const isEditing = editingId === a.productId
                const expireDate = new Date(a.expiresAt)
                const isExpired = a.isExpired
                return (
                  <div key={a.productId} className={`p-4 rounded-xl border ${
                    isExpired ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'
                  }`}>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900">{a.productName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Purchased on {fmtDate(a.purchaseDate)}
                        </p>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full flex-shrink-0 ${
                        isExpired ? 'bg-red-200 text-red-800' : 'bg-green-200 text-green-800'
                      }`}>
                        {isExpired ? 'Expired' : `${a.daysRemaining}d left`}
                      </span>
                    </div>
                    {!isEditing ? (
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-gray-600">
                          Expires: <span className="font-medium">{fmtDate(a.expiresAt)}</span>
                        </p>
                        <button onClick={() => {
                          setEditingId(a.productId)
                          setEditDate(expireDate.toISOString().split('T')[0])
                        }}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                          Edit
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                          className="flex-1 px-3 py-2 text-sm border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                        <button onClick={() => handleUpdateAccess(a.productId)} disabled={saving}
                          className="px-3 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setEditingId(null)}
                          className="px-3 py-2 text-xs font-semibold text-gray-600 bg-gray-200 rounded-lg hover:bg-gray-300">
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
        </div>

        <div className="px-5 py-3 border-t flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function AddUserModal({ onClose, onCreated }) {
  const [name,  setName]  = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  async function handleSave() {
    if (phone.length !== 10) return setError('Enter a valid 10-digit phone number')
    setSaving(true); setError('')
    try {
      await apiFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          phoneNumber: phone,
          email: email.trim(),
          notes: notes.trim(),
        }),
      })
      onCreated?.()
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
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">Add User</h2>
            <p className="text-xs text-gray-400 mt-0.5">Role: Student · Source: Custom</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Student name"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Phone Number <span className="text-red-500">*</span></label>
            <div className="flex border border-gray-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500">
              <span className="flex items-center px-3 bg-gray-50 text-gray-500 text-sm border-r border-gray-200">+91</span>
              <input value={phone} type="tel" placeholder="10-digit mobile"
                onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                className="flex-1 px-3 py-2.5 text-sm outline-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Email <span className="text-gray-400 font-normal">(optional)</span></label>
            <input value={email} type="email" onChange={e => setEmail(e.target.value)} placeholder="you@example.com"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Any note about this user…"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || phone.length !== 10}
            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Adding…' : 'Add User'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TestLimitModal({ user, onClose, onUpdated }) {
  const [value,   setValue]   = useState('')        // '' ⇒ use default
  const [dflt,    setDflt]    = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    apiFetch(`/api/admin/users/${user._id}`)
      .then(d => {
        setDflt(d.defaultTestAttemptLimit ?? 1)
        const lim = d.user?.testAttemptLimit
        setValue(lim == null ? '' : String(lim))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user._id])

  async function save(next) {
    setSaving(true); setError('')
    try {
      await apiFetch(`/api/admin/users/${user._id}/test-attempt-limit`, {
        method: 'PATCH',
        body: JSON.stringify({ testAttemptLimit: next }),
      })
      onUpdated?.()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function handleSave() {
    if (value === '') return save(null)
    const n = Number(value)
    if (!Number.isInteger(n) || n < 1) return setError('Enter a whole number of 1 or more')
    save(n)
  }

  const effective = value === '' ? dflt : Number(value) || dflt

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">Test Series Limit</h2>
            <p className="text-xs text-gray-400 mt-0.5">{user.name || user.phoneNumber}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-gray-600">
            How many times this student may <strong>write &amp; submit each test paper</strong>.
            Leave blank to use the system default (<strong>{dflt}</strong>).
          </p>

          {loading ? (
            <div className="h-11 bg-gray-100 rounded-xl animate-pulse" />
          ) : (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Attempts per test</label>
              <input
                type="number" min="1" step="1" value={value}
                onChange={e => setValue(e.target.value.replace(/[^\d]/g, ''))}
                placeholder={`Default (${dflt})`}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" />
              <p className="text-xs text-gray-400 mt-1.5">
                Effective limit: <span className="font-semibold text-gray-600">{effective}</span> attempt{effective !== 1 ? 's' : ''} per test
                {value === '' && ' (using default)'}
              </p>
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t flex gap-2 justify-between items-center">
          <button onClick={() => { setValue(''); save(null) }} disabled={saving || loading}
            className="text-xs font-semibold text-gray-500 hover:text-gray-700 disabled:opacity-40">
            Reset to default
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || loading}
              className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function GrantModal({ user, onClose, onGranted }) {
  const [products,  setProducts]  = useState([])
  const [selected,  setSelected]  = useState([])
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')
  const [purchases, setPurchases] = useState([])

  useEffect(() => {
    apiFetch('/api/admin/products?limit=10000').then(d => setProducts(d.products || [])).catch(() => {})
    apiFetch(`/api/admin/users/${user._id}`).then(d => setPurchases(d.purchases || [])).catch(() => {})
  }, [user._id])

  function toggle(id) {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  }

  async function handleGrant() {
    if (selected.length === 0) return setError('Select at least one product')
    setSaving(true); setError('')
    try {
      await apiFetch(`/api/admin/users/${user._id}/grant-access`, {
        method: 'POST',
        body: JSON.stringify({ productIds: selected }),
      })
      onGranted()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const allCourses = [
    ...(user.access?.website?.courses  || []),
    ...(user.access?.shopify?.courses  || []),
    ...(user.access?.combo?.courses    || []),
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">Grant Course Access</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {user.name || user.phoneNumber || user.email}
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto space-y-4">
          {/* Current access */}
          {allCourses.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Currently Enrolled</p>
              <div className="flex flex-wrap gap-1.5">
                {allCourses.map((c, i) => (
                  <span key={i} className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-full">{c}</span>
                ))}
              </div>
            </div>
          )}

          {/* Past purchases */}
          {purchases.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Purchase History ({purchases.length})</p>
              <div className="space-y-1">
                {purchases.map(p => (
                  <div key={p._id} className="flex items-center justify-between text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                    <span>{(p.items || []).map(i => i.name).join(', ') || '—'}</span>
                    <span className="text-gray-400">{fmtDate(p.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Product selector */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Grant Access To</p>
            {products.length === 0 ? (
              <div className="text-sm text-gray-400 py-3">Loading products…</div>
            ) : (
              <div className="space-y-1.5">
                {products.map(p => (
                  <label key={p._id}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      selected.includes(p._id) ? 'border-indigo-300 bg-indigo-50' : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                    }`}>
                    <input type="checkbox" checked={selected.includes(p._id)} onChange={() => toggle(p._id)}
                      className="w-4 h-4 accent-indigo-600" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{p.name}</p>
                      {p.level && <p className="text-xs text-gray-400">{p.level}{p.category ? ` · ${p.category}` : ''}</p>}
                    </div>
                    {p.grants?.courses?.length > 0 && (
                      <span className="text-xs text-indigo-500 flex-shrink-0">
                        {p.grants.courses.join(', ')}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleGrant} disabled={saving || selected.length === 0}
            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
            {saving
              ? <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Granting…</>
              : <>Grant Access ({selected.length})</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}

function UserDetailDrawer({ user, onClose }) {
  const [purchases, setPurchases] = useState([])
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    apiFetch(`/api/admin/users/${user._id}`)
      .then(d => setPurchases(d.purchases || []))
      .catch(() => setPurchases([]))
      .finally(() => setLoading(false))
  }, [user._id])

  const courses = [
    ...(user.access?.website?.courses || []),
    ...(user.access?.shopify?.courses || []),
    ...(user.access?.combo?.courses   || []),
  ]
  const role = user.isAdmin ? 'Admin' : (user.isMentor ? 'Mentor' : 'Student')

  const Row = ({ label, children }) => (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-gray-50">
      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-0.5">{label}</span>
      <span className="text-sm text-gray-800 text-right break-words min-w-0">{children}</span>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="bg-white w-full max-w-md h-full shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="font-bold text-gray-900">User Details</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4">
          {/* Identity */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center text-lg font-bold text-indigo-600 flex-shrink-0">
              {user.name?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-gray-900 truncate">{user.name || '—'}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  user.isAdmin ? 'bg-red-100 text-red-600' : user.isMentor ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-600'
                }`}>{role}</span>
                {user.source && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 capitalize">{user.source}</span>
                )}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="mb-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notes</p>
            <div className={`rounded-xl px-3 py-2.5 text-sm whitespace-pre-wrap break-words ${
              user.notes ? 'bg-amber-50 text-gray-700 border border-amber-100' : 'bg-gray-50 text-gray-400'
            }`}>
              {user.notes || 'No notes'}
            </div>
          </div>

          {/* Fields */}
          <div className="mb-4">
            <Row label="Phone">{user.phoneNumber || '—'}</Row>
            <Row label="Email">{user.email || '—'}</Row>
            <Row label="Role">{role}</Row>
            <Row label="Source"><span className="capitalize">{user.source || '—'}</span></Row>
            <Row label="Joined">{fmtDate(user.createdAt)}</Row>
            <Row label="Last Login">{user.activeSession?.lastLoginTime ? fmtDate(user.activeSession.lastLoginTime) : '—'}</Row>
            <Row label="Device">
              {user.activeSession
                ? `${user.activeSession.deviceName || '—'} (${user.activeSession.deviceType || '—'})`
                : 'Not logged in'}
            </Row>
            <Row label="Test Limit">{user.testAttemptLimit == null ? 'Default' : `${user.testAttemptLimit} / test`}</Row>
          </div>

          {/* Enrolled courses */}
          <div className="mb-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Enrolled Courses ({courses.length})</p>
            {courses.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {courses.map((c, i) => (
                  <span key={i} className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-full">{c}</span>
                ))}
              </div>
            ) : <p className="text-sm text-gray-400">None</p>}
          </div>

          {/* Purchases */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Purchase History</p>
            {loading ? (
              <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-10 bg-gray-100 rounded-xl animate-pulse" />)}</div>
            ) : purchases.length > 0 ? (
              <div className="space-y-1.5">
                {purchases.map(p => (
                  <div key={p._id} className="flex items-center justify-between gap-2 text-xs bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-gray-700 truncate">{(p.items || []).map(i => i.name).join(', ') || '—'}</span>
                    <span className="text-gray-400 flex-shrink-0">{fmtDate(p.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-gray-400">No purchases</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function UsersPage() {
  const [users,   setUsers]   = useState([])
  const [total,   setTotal]   = useState(0)
  const [page,    setPage]    = useState(1)
  const [search,  setSearch]  = useState('')
  const [loading, setLoading] = useState(true)
  const [grantUser,    setGrantUser]    = useState(null)
  const [progressUser, setProgressUser] = useState(null)
  const [accessUser,   setAccessUser]   = useState(null)
  const [limitUser,    setLimitUser]    = useState(null)
  const [addingUser,   setAddingUser]   = useState(false)
  const [detailUser,   setDetailUser]   = useState(null)

  function load() {
    setLoading(true)
    const query = new URLSearchParams({ page, limit: 20, ...(search && { search }) })
    apiFetch(`/api/admin/users?${query}`)
      .then(d => { setUsers(d.users || []); setTotal(d.pagination?.total || 0) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page, search])

  const totalPages = Math.ceil(total / 20)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-gray-400 text-sm mt-0.5">{total} total users</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search users..." className="pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 w-56" />
          </div>
          <button onClick={() => setAddingUser(true)}
            className="flex items-center gap-1.5 text-sm font-semibold text-white bg-indigo-600 px-4 py-2 rounded-xl hover:bg-indigo-700 transition-colors whitespace-nowrap">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add User
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              <th className="text-left px-5 py-3.5">Name</th>
              <th className="text-left px-5 py-3.5">Phone</th>
              <th className="text-left px-5 py-3.5">Email</th>
              <th className="text-left px-5 py-3.5">Role</th>
              <th className="text-left px-5 py-3.5">Device</th>
              <th className="text-left px-5 py-3.5">Last Login</th>
              <th className="text-left px-5 py-3.5">Enrolled</th>
              <th className="text-left px-5 py-3.5">Joined</th>
              <th className="px-5 py-3.5" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array(8).fill(0).map((_, i) => (
                <tr key={i} className="border-b border-gray-50">
                  {Array(9).fill(0).map((_, j) => (
                    <td key={j} className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded animate-pulse w-24" /></td>
                  ))}
                </tr>
              ))
            ) : users.length === 0 ? (
              <tr><td colSpan={9} className="px-5 py-10 text-center text-gray-400">No users found</td></tr>
            ) : users.map(u => {
              const courses = [
                ...(u.access?.website?.courses || []),
                ...(u.access?.shopify?.courses  || []),
                ...(u.access?.combo?.courses    || []),
              ]
              return (
                <tr key={u._id} onClick={() => setDetailUser(u)}
                  className="border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-600 flex-shrink-0">
                        {u.name?.[0]?.toUpperCase() || '?'}
                      </div>
                      <span className="font-medium text-gray-900">{u.name || '—'}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-gray-600">{u.phoneNumber || '—'}</td>
                  <td className="px-5 py-3.5 text-gray-600 max-w-[180px] truncate">{u.email || '—'}</td>
                  <td className="px-5 py-3.5">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      u.isAdmin ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {u.isAdmin ? 'Admin' : 'Student'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    {u.activeSession ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 bg-green-500 rounded-full"></span>
                        <span className="text-xs text-gray-700 font-medium">{u.activeSession.deviceName || '—'}</span>
                        <span className="text-xs text-gray-400">({u.activeSession.deviceType || '—'})</span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">Not logged in</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-gray-400 text-xs">
                    {u.activeSession?.lastLoginTime ? fmtDate(u.activeSession.lastLoginTime) : '—'}
                  </td>
                  <td className="px-5 py-3.5">
                    {courses.length > 0
                      ? <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{courses.length} course{courses.length !== 1 ? 's' : ''}</span>
                      : <span className="text-xs text-gray-300">None</span>
                    }
                  </td>
                  <td className="px-5 py-3.5 text-gray-400 text-xs">{fmtDate(u.createdAt)}</td>
                  <td className="px-5 py-3.5" onClick={e => e.stopPropagation()}>
                    {!u.isAdmin && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => setGrantUser(u)}
                          className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors whitespace-nowrap">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                          </svg>
                          Grant
                        </button>
                        <button onClick={() => setAccessUser(u)}
                          className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors whitespace-nowrap">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          Access
                        </button>
                        <button onClick={() => setProgressUser(u)}
                          className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg hover:bg-emerald-100 transition-colors whitespace-nowrap">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                          Progress
                        </button>
                        <button onClick={() => setLimitUser(u)}
                          className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition-colors whitespace-nowrap">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Limit
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100">
            <p className="text-sm text-gray-400">Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Previous</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
            </div>
          </div>
        )}
      </div>

      {grantUser && (
        <GrantModal
          user={grantUser}
          onClose={() => setGrantUser(null)}
          onGranted={load}
        />
      )}

      {accessUser && (
        <AccessModal
          user={accessUser}
          onClose={() => setAccessUser(null)}
          onUpdated={load}
        />
      )}

      {progressUser && (
        <ProgressModal
          user={progressUser}
          onClose={() => setProgressUser(null)}
        />
      )}

      {limitUser && (
        <TestLimitModal
          user={limitUser}
          onClose={() => setLimitUser(null)}
          onUpdated={load}
        />
      )}

      {addingUser && (
        <AddUserModal
          onClose={() => setAddingUser(false)}
          onCreated={() => { setPage(1); load() }}
        />
      )}

      {detailUser && (
        <UserDetailDrawer
          user={detailUser}
          onClose={() => setDetailUser(null)}
        />
      )}
    </div>
  )
}
