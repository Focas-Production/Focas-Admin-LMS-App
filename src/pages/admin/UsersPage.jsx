import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../../api'
import { CA_LEVELS, CA_GROUPS, groupLabel } from '../../lib/ca'

function fmtDate(d) {
  if (!d) return '—'
  const date = new Date(d)
  const datePart = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const timePart = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  return `${datePart}, ${timePart}`
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

// Per-student override for the AI similar-question monthly quota.
// Shows the tier their purchased products grant + this month's usage.
function AiLimitModal({ user, onClose, onUpdated }) {
  const [value,   setValue]   = useState('')   // '' ⇒ use the tier default
  const [quota,   setQuota]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    apiFetch(`/api/admin/users/${user._id}/ai-quota`)
      .then(d => {
        setQuota(d.quota)
        const lim = d.user?.aiGen?.monthlyLimit
        setValue(lim == null ? '' : String(lim))
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [user._id])

  async function save(next) {
    setSaving(true); setError('')
    try {
      await apiFetch(`/api/admin/users/${user._id}/ai-limit`, {
        method: 'PATCH',
        body: JSON.stringify({ monthlyLimit: next }),
      })
      onUpdated?.()
      onClose()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  function handleSave() {
    if (value === '') return save(null)
    const n = Number(value)
    if (!Number.isInteger(n) || n < 0) return setError('Enter a whole number of 0 or more')
    save(n)
  }

  const TIER = { pro: 'bg-violet-100 text-violet-700', lite: 'bg-sky-100 text-sky-700' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">AI Generation Limit</h2>
            <p className="text-xs text-gray-400 mt-0.5">{user.name || user.phoneNumber}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {loading ? <p className="text-sm text-gray-400">Loading…</p> : (
            <>
              <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Tier (from purchases)</span>
                  {quota?.tier
                    ? <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase ${TIER[quota.tier]}`}>{quota.tier}</span>
                    : <span className="text-xs text-gray-400">No AI access</span>}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Used this month ({quota?.month})</span>
                  <span className="font-semibold text-gray-800">{quota?.used ?? 0} / {quota?.limit ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Remaining</span>
                  <span className="font-semibold text-emerald-700">{quota?.remaining ?? 0}</span>
                </div>
              </div>

              {!quota?.tier && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  This student owns no product marked AI Lite/Pro, so they can't generate yet. Mark a product's AI tier on the Products page.
                </p>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Monthly limit override</label>
                <input type="number" min="0" value={value} onChange={e => setValue(e.target.value)}
                  placeholder="Leave blank to use the tier default"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-violet-400" />
                <p className="text-[11px] text-gray-400 mt-1">
                  Blank = use the {quota?.tier || 'tier'} limit from AI Question Bank settings. Set a higher number to extend this student only.
                </p>
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <div className="flex justify-end gap-2">
                <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={handleSave} disabled={saving}
                  className="px-4 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-lg disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}


// What a student is enrolled for — this is what scopes their Chapter Progress
// list. Two mutually exclusive ways to say it, because most students buy a whole
// group but some buy individual papers:
//   • Whole group      → every paper in Group 1 / Group 2 / both
//   • Specific subjects → exactly the papers picked, ignoring groups
// Keeping them exclusive means there's never a question of which one applies.
function CourseModal({ user, onClose, onUpdated }) {
  const [level,   setLevel]   = useState(user.caLevel || '')
  const [group,   setGroup]   = useState(user.caGroup || '')
  const [picked,  setPicked]  = useState(() => new Set((user.caSubjects || []).map(String)))
  const [mode,    setMode]    = useState((user.caSubjects || []).length ? 'subjects' : 'group')
  const [subjects, setSubjects] = useState(null)   // null = loading
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    apiFetch('/api/admin/subjects')
      .then(d => setSubjects(d.subjects || []))
      .catch(() => setSubjects([]))
  }, [])

  const hasGroups = level === 'Intermediate' || level === 'Final'
  const bySubjects = mode === 'subjects'
  // Papers are picked within the chosen level; with no level yet, offer them all
  // rather than an empty box the admin can't act on.
  const options = (subjects || []).filter(s => !level || s.level === level)

  const togglePick = (id) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  async function handleSave() {
    setSaving(true); setError('')
    try {
      await apiFetch(`/api/admin/users/${user._id}/course`, {
        method: 'PATCH',
        body: JSON.stringify({
          caLevel: level || null,
          caGroup: bySubjects || !hasGroups ? null : (group || null),
          caSubjects: bySubjects ? [...picked] : [],
        }),
      })
      onUpdated?.()
      onClose()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const Choice = ({ active, onClick, children }) => (
    <button onClick={onClick}
      className={`px-3 py-2 text-sm rounded-xl border transition-colors ${
        active ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
      {children}
    </button>
  )

  const summary = () => {
    if (!level && !bySubjects) return 'With no level set, Chapter Progress lists only the chapters this student has actually attended a class for.'
    if (bySubjects) {
      return picked.size
        ? `Chapter Progress will list only these ${picked.size} paper${picked.size !== 1 ? 's' : ''} — groups are ignored.`
        : 'Pick at least one paper, or switch to Whole group.'
    }
    if (hasGroups && !group) return `Chapter Progress will list every ${level} chapter. Pick a group to narrow it to that group's papers.`
    if (group === 'both') return `Chapter Progress will list every ${level} paper — both groups.`
    if (hasGroups) return `Chapter Progress will list ${level} ${groupLabel(group)} papers only.`
    return `Chapter Progress will list every ${level} chapter — this level has no groups.`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="font-bold text-gray-900">Enrollment</h2>
            <p className="text-xs text-gray-400 mt-0.5">{user.name || user.phoneNumber}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Level</p>
            <div className="flex flex-wrap gap-2">
              {CA_LEVELS.map(l => (
                <Choice key={l} active={level === l} onClick={() => setLevel(level === l ? '' : l)}>{l}</Choice>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Enrolled for</p>
            <div className="flex gap-2">
              <Choice active={!bySubjects} onClick={() => setMode('group')}>Whole group</Choice>
              <Choice active={bySubjects} onClick={() => setMode('subjects')}>Specific subjects</Choice>
            </div>
          </div>

          {!bySubjects && hasGroups && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Group</p>
              <div className="flex flex-wrap gap-2">
                {CA_GROUPS.map(g => (
                  <Choice key={g.value} active={group === g.value} onClick={() => setGroup(group === g.value ? '' : g.value)}>{g.label}</Choice>
                ))}
              </div>
            </div>
          )}

          {bySubjects && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Subjects {picked.size > 0 && <span className="text-indigo-600 normal-case">· {picked.size} selected</span>}
              </p>
              {subjects === null ? (
                <div className="space-y-1.5">{[1, 2, 3].map(i => <div key={i} className="h-9 bg-gray-100 rounded-lg animate-pulse" />)}</div>
              ) : !options.length ? (
                <p className="text-sm text-gray-400">No subjects{level ? ` in ${level}` : ''} yet.</p>
              ) : (
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {options.map(s => {
                    const on = picked.has(String(s._id))
                    return (
                      <button key={s._id} onClick={() => togglePick(String(s._id))}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors ${
                          on ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <span className={`w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                          on ? 'bg-indigo-600 text-white' : 'border border-gray-300 text-transparent'}`}>✓</span>
                        <span className={`text-sm flex-1 truncate ${on ? 'text-indigo-800 font-medium' : 'text-gray-700'}`}>{s.name}</span>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">
                          {s.level}{s.group ? ` · ${s.group === 'group1' ? 'G1' : 'G2'}` : ''}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-gray-400 leading-relaxed">{summary()}</p>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="px-5 py-3 border-t flex justify-end gap-2 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} disabled={saving || (bySubjects && picked.size === 0)}
            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-60">
            {saving ? 'Saving…' : 'Save'}
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

          {/* Straight into the full report — the drawer is a summary, that page
              is the whole picture. */}
          {!user.isAdmin && !user.isMentor && (
            <Link to={`/admin/users/${user._id}/progress`}
              className="flex items-center justify-center gap-2 w-full mb-4 px-4 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              View full progress report
            </Link>
          )}

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
            {!user.isAdmin && !user.isMentor && (
              <Row label="Enrolled for">
                {user.caSubjects?.length > 0
                  ? `${user.caLevel ? `${user.caLevel} · ` : ''}${user.caSubjects.length} specific subject${user.caSubjects.length !== 1 ? 's' : ''}`
                  : user.caLevel
                    ? `${user.caLevel}${user.caGroup ? ` · ${groupLabel(user.caGroup)}` : ''}`
                    : <span className="text-gray-400">Not set</span>}
              </Row>
            )}
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

// What a mentor has taught and marked done, scoped to just their own subjects
// (classes they've hosted) — the same syllabus-progress data mentors see in
// their own portal, viewed read-only from the admin side.
const CHIP_TONES = {
  amber:   'bg-amber-100 text-amber-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  gray:    'bg-gray-200 text-gray-700',
}

function FilterChip({ active, onClick, tone, children }) {
  return (
    <button onClick={onClick}
      className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
        active ? CHIP_TONES[tone] : 'text-gray-400 hover:bg-gray-100'}`}>
      {children}
    </button>
  )
}

function MentorSyllabusModal({ mentor, onClose }) {
  const [subjects, setSubjects] = useState(null)   // null = loading
  const [filter, setFilter] = useState('pending')  // pending | done | all
  const [query, setQuery] = useState('')
  const [openIds, setOpenIds] = useState(() => new Set())
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    apiFetch(`/api/live-classes/manage/syllabus?mentorId=${mentor._id}`)
      .then(d => setSubjects(d.subjects || []))
      .catch(() => setSubjects([]))
  }, [mentor._id])

  const allChapters = (subjects || []).flatMap(s => s.chapters || [])
  const doneCount = allChapters.filter(c => c.completed).length
  const pendingCount = allChapters.length - doneCount

  const q = query.trim().toLowerCase()
  const visible = (subjects || [])
    .map(s => ({
      ...s,
      done: (s.chapters || []).filter(c => c.completed).length,
      total: (s.chapters || []).length,
      chapters: (s.chapters || []).filter(c =>
        (filter === 'all' || (filter === 'done' ? c.completed : !c.completed)) &&
        (!q || `${c.name} ${(c.units || []).map(u => u.name).join(' ')}`.toLowerCase().includes(q))),
    }))
    .filter(s => s.chapters.length)

  // Same rule as the student view: short lists stay flat, long ones collapse.
  const visibleCount = visible.reduce((n, s) => n + s.chapters.length, 0)
  const autoOpen = !!q || (!touched && visibleCount <= 15)
  const isOpen = (id) => autoOpen || openIds.has(id)
  const toggleOpen = (id) => {
    setOpenIds(prev => {
      const next = new Set(autoOpen ? visible.map(s => s._id) : prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    setTouched(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="font-bold text-gray-900">Syllabus Progress</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {mentor.name || mentor.phoneNumber}
              {subjects && allChapters.length > 0 && <span> · {doneCount}/{allChapters.length} chapters completed</span>}
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {subjects && allChapters.length > 0 && (
          <div className="px-5 pt-3 flex items-center gap-2 flex-shrink-0 flex-wrap">
            <div className="flex gap-1.5">
              <FilterChip active={filter === 'pending'} onClick={() => setFilter('pending')} tone="amber">Not completed {pendingCount}</FilterChip>
              <FilterChip active={filter === 'done'} onClick={() => setFilter('done')} tone="emerald">Completed {doneCount}</FilterChip>
              <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} tone="gray">All {allChapters.length}</FilterChip>
            </div>
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search chapter or unit…"
              className="ml-auto text-xs px-3 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 w-48" />
          </div>
        )}

        <div className="px-5 py-4 overflow-y-auto">
          {subjects === null ? (
            <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}</div>
          ) : !subjects.length ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-sm font-medium">No subjects yet</p>
              <p className="text-xs mt-1">This mentor hasn't hosted a class tied to a chapter yet.</p>
            </div>
          ) : !visible.length ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-sm font-medium">
                {q ? 'No match' : filter === 'pending' ? 'Nothing pending' : 'Nothing completed yet'}
              </p>
              <p className="text-xs mt-1">
                {q ? `Nothing here matches "${query.trim()}".`
                  : filter === 'pending' ? 'This mentor has marked every chapter completed.'
                  : 'This mentor hasn\'t marked any chapter completed yet.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {visible.map(subj => {
                const chapters = subj.chapters
                const open = isOpen(subj._id)
                const pct = subj.total ? Math.round((subj.done / subj.total) * 100) : 0
                return (
                  <div key={subj._id} className="border border-gray-100 rounded-xl overflow-hidden">
                    <button onClick={() => toggleOpen(subj._id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors">
                      <span className="text-gray-300 text-xs w-3 flex-shrink-0">{open ? '▾' : '▸'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {subj.name} <span className="text-gray-300 font-normal">· {subj.level}</span>
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="h-1.5 bg-gray-100 rounded-full flex-1 max-w-[160px] overflow-hidden">
                            <div className="h-full bg-teal-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[11px] text-gray-400 flex-shrink-0">{subj.done}/{subj.total} done</span>
                        </div>
                      </div>
                      {!open && (
                        <span className="text-[11px] text-gray-400 flex-shrink-0">
                          {chapters.length} {filter === 'pending' ? 'pending' : 'shown'}
                        </span>
                      )}
                    </button>

                    {open && (
                    <div className="px-3 pb-3 space-y-1.5">
                      {chapters.map(ch => (
                        <div key={ch._id} className={`rounded-lg border p-2.5 ${ch.completed ? 'bg-teal-50/50 border-teal-100' : 'bg-gray-50 border-gray-100'}`}>
                          <div className="flex items-center gap-2">
                            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${
                              ch.completed ? 'bg-teal-500 text-white' : 'bg-white border border-gray-300 text-transparent'}`}>✓</span>
                            <p className={`text-sm font-medium flex-1 truncate ${ch.completed ? 'text-teal-700' : 'text-gray-700'}`}>{ch.name}</p>
                            {ch.completed && ch.completedBy?.name && <span className="text-[10px] text-gray-400 flex-shrink-0">by {ch.completedBy.name}</span>}
                          </div>
                          {(ch.units || []).length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-1.5 pl-6">
                              {ch.units.map(u => (
                                <span key={u._id} className={`text-[11px] px-2 py-0.5 rounded-md ${u.completed ? 'bg-teal-100 text-teal-800' : 'bg-gray-100 text-gray-500'}`}>
                                  {u.completed ? '✓' : '○'} {u.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t flex justify-end flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">Close</button>
        </div>
      </div>
    </div>
  )
}

export default function UsersPage() {
  const navigate = useNavigate()
  const [users,   setUsers]   = useState([])
  const [total,   setTotal]   = useState(0)
  const [page,    setPage]    = useState(1)
  const [search,  setSearch]  = useState('')
  const [loading, setLoading] = useState(true)
  const [grantUser,    setGrantUser]    = useState(null)
  const [accessUser,   setAccessUser]   = useState(null)
  const [limitUser,    setLimitUser]    = useState(null)
  const [aiLimitUser,  setAiLimitUser]  = useState(null)
  const [addingUser,   setAddingUser]   = useState(false)
  const [detailUser,   setDetailUser]   = useState(null)
  const [syllabusMentor, setSyllabusMentor] = useState(null)
  const [courseUser,     setCourseUser]     = useState(null)

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
                      u.isAdmin ? 'bg-red-100 text-red-600' : u.isMentor ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {u.isAdmin ? 'Admin' : u.isMentor ? 'Mentor' : 'Student'}
                    </span>
                    {!u.isAdmin && !u.isMentor && (u.caLevel || u.caSubjects?.length > 0) && (
                      <span className="block text-[10px] text-gray-400 mt-1">
                        {u.caLevel}
                        {u.caSubjects?.length > 0
                          ? `${u.caLevel ? ' · ' : ''}${u.caSubjects.length} subject${u.caSubjects.length !== 1 ? 's' : ''}`
                          : u.caGroup ? ` · ${groupLabel(u.caGroup)}` : ''}
                      </span>
                    )}
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
                    {u.isMentor ? (
                      <button onClick={() => setSyllabusMentor(u)}
                        className="flex items-center gap-1.5 text-xs font-semibold text-teal-600 bg-teal-50 px-3 py-1.5 rounded-lg hover:bg-teal-100 transition-colors whitespace-nowrap">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                        </svg>
                        Syllabus
                      </button>
                    ) : !u.isAdmin && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => setCourseUser(u)}
                          className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors whitespace-nowrap">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                          Course
                        </button>
                        <button onClick={() => navigate(`/admin/users/${u._id}/progress`)}
                          title="Full progress report — syllabus, attendance, test marks, lectures"
                          className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg hover:bg-emerald-100 transition-colors whitespace-nowrap">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                          Progress
                        </button>
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
                        <button onClick={() => setLimitUser(u)}
                          className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition-colors whitespace-nowrap">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Limit
                        </button>
                        <button onClick={() => setAiLimitUser(u)}
                          className="flex items-center gap-1.5 text-xs font-semibold text-violet-600 bg-violet-50 px-3 py-1.5 rounded-lg hover:bg-violet-100 transition-colors whitespace-nowrap">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          AI Limit
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

      {limitUser && (
        <TestLimitModal
          user={limitUser}
          onClose={() => setLimitUser(null)}
          onUpdated={load}
        />
      )}

      {aiLimitUser && (
        <AiLimitModal
          user={aiLimitUser}
          onClose={() => setAiLimitUser(null)}
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

      {syllabusMentor && (
        <MentorSyllabusModal
          mentor={syllabusMentor}
          onClose={() => setSyllabusMentor(null)}
        />
      )}

      {courseUser && (
        <CourseModal
          user={courseUser}
          onClose={() => setCourseUser(null)}
          onUpdated={load}
        />
      )}
    </div>
  )
}
