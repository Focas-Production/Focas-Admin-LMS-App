import { useState, useEffect } from 'react'
import { apiFetch } from '../../api'

const LEVELS = ['Foundation', 'Intermediate', 'Final']

const LEVEL_COLORS = {
  Foundation:   'bg-emerald-100 text-emerald-700',
  Intermediate: 'bg-blue-100 text-blue-700',
  Final:        'bg-purple-100 text-purple-700',
}

function SubjectModal({ subject, level, onClose, onSaved }) {
  const isEdit = !!subject
  const [name, setName]         = useState(subject?.name || '')
  const [desc, setDesc]         = useState(subject?.description || '')
  const [order, setOrder]       = useState(subject?.order ?? 0)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return setError('Name is required')
    setSaving(true)
    setError('')
    try {
      if (isEdit) {
        const data = await apiFetch(`/api/admin/subjects/${subject._id}`, {
          method: 'PUT',
          body: JSON.stringify({ name, description: desc, order: parseInt(order) || 0 }),
        })
        onSaved(data.subject)
      } else {
        const data = await apiFetch('/api/admin/subjects', {
          method: 'POST',
          body: JSON.stringify({ name, level, description: desc, order: parseInt(order) || 0 }),
        })
        onSaved(data.subject)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-900">
            {isEdit ? 'Edit Subject' : `Add Subject — ${level}`}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Accounting"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-gray-400">(optional)</span></label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Display Order</label>
            <input
              type="number"
              value={order}
              onChange={e => setOrder(e.target.value)}
              min={0}
              className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors">
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Subject'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function SubjectRow({ subject, onEdit, onDelete, onToggleActive }) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!window.confirm(`Delete "${subject.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await onDelete(subject._id)
    } catch (err) {
      alert(err.message)
      setDeleting(false)
    }
  }

  return (
    <div className={`flex items-center gap-4 px-4 py-3 rounded-xl border ${subject.isActive ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50'} hover:shadow-sm transition-shadow`}>
      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 flex-shrink-0">
        {subject.order}
      </div>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${subject.isActive ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
          {subject.name}
        </p>
        {subject.description && (
          <p className="text-xs text-gray-400 truncate mt-0.5">{subject.description}</p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => onToggleActive(subject)}
          title={subject.isActive ? 'Deactivate' : 'Activate'}
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
            subject.isActive ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {subject.isActive
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            }
          </svg>
        </button>

        <button onClick={() => onEdit(subject)}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>

        <button onClick={handleDelete} disabled={deleting}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default function SubjectsPage() {
  const [activeLevel, setActiveLevel] = useState('Foundation')
  const [subjects, setSubjects]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [modal, setModal]             = useState(null) // null | { mode: 'add'|'edit', subject? }

  async function loadSubjects() {
    setLoading(true)
    try {
      const data = await apiFetch('/api/admin/subjects')
      setSubjects(data.subjects || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadSubjects() }, [])

  const levelSubjects = subjects.filter(s => s.level === activeLevel)

  async function handleToggleActive(subject) {
    try {
      const data = await apiFetch(`/api/admin/subjects/${subject._id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !subject.isActive }),
      })
      setSubjects(prev => prev.map(s => s._id === data.subject._id ? data.subject : s))
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleDelete(id) {
    await apiFetch(`/api/admin/subjects/${id}`, { method: 'DELETE' })
    setSubjects(prev => prev.filter(s => s._id !== id))
  }

  function handleSaved(saved) {
    setSubjects(prev => {
      const exists = prev.find(s => s._id === saved._id)
      return exists ? prev.map(s => s._id === saved._id ? saved : s) : [...prev, saved]
    })
    setModal(null)
  }

  const counts = LEVELS.reduce((acc, l) => {
    acc[l] = subjects.filter(s => s.level === l).length
    return acc
  }, {})

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Subjects</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage subjects level-wise for the CA curriculum</p>
        </div>
        <button
          onClick={() => setModal({ mode: 'add' })}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Subject
        </button>
      </div>

      {/* Level Tabs */}
      <div className="flex gap-2 mb-6 border-b border-gray-200">
        {LEVELS.map(level => (
          <button
            key={level}
            onClick={() => setActiveLevel(level)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeLevel === level
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {level}
            <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
              activeLevel === level ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'
            }`}>
              {counts[level]}
            </span>
          </button>
        ))}
      </div>

      {/* Subject List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      ) : levelSubjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <p className="text-gray-500 text-sm font-medium">No subjects yet for {activeLevel}</p>
          <p className="text-gray-400 text-xs mt-1">Click "Add Subject" to create the first one</p>
          <button
            onClick={() => setModal({ mode: 'add' })}
            className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            Add Subject
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {levelSubjects.map(subject => (
            <SubjectRow
              key={subject._id}
              subject={subject}
              onEdit={s => setModal({ mode: 'edit', subject: s })}
              onDelete={handleDelete}
              onToggleActive={handleToggleActive}
            />
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {modal && (
        <SubjectModal
          subject={modal.subject}
          level={activeLevel}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
