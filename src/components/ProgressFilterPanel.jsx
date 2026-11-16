// Advanced filter drawer for the admin Progress list — the scheduler's
// condition builder plus its own AND / OR at every gap between rows. AND binds
// tighter than OR, so rows joined by AND sit together in one box and each OR
// starts a new box: "(1 AND 2) OR 3" reads straight off the screen. Rows apply
// live (the page re-asks the server, which does the filtering). Saved views are
// shared by every admin, stored under scope 'progress-list', and capture the
// page's quick filters as well as the rows.
import { useState } from 'react'
import { apiFetch } from '../api'
import {
  PROGRESS_FIELDS, progressConditionComplete, progressRowProblem, MAX_CONDITIONS, withBatchOptions,
} from '../lib/progressFilter'
import ConditionList from './ConditionList'

export const PROGRESS_VIEW_SCOPE = 'progress-list'

export default function ProgressFilterPanel({
  filter, setFilter, subjects, programs, allBatches, views, setViews,
  activeViewId, setActiveViewId, currentView, onApplyView, onClearAll,
  matchCount, loading, onClose,
}) {
  const [viewName, setViewName] = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')

  const { conditions } = filter
  const activeView = (views || []).find(v => String(v._id) === activeViewId) || null
  const setConditions = (next) => setFilter({ conditions: next })

  const fields = withBatchOptions(allBatches, conditions)
  const notApplied = conditions.filter(c => progressRowProblem(c)).length

  const saveAsNew = async () => {
    const name = viewName.trim()
    if (!name) { setError('Give the view a name first'); return }
    setBusy(true); setError('')
    try {
      const d = await apiFetch('/api/admin/filter-views', {
        method: 'POST',
        body: JSON.stringify({ scope: PROGRESS_VIEW_SCOPE, name, filters: currentView() }),
      })
      setViews([...(views || []), d.view].sort((a, b) => a.name.localeCompare(b.name)))
      setActiveViewId(String(d.view._id))
      setViewName('')
    } catch (err) {
      setError(err.message || 'Could not save the view')
    } finally {
      setBusy(false)
    }
  }

  const updateActive = async () => {
    if (!activeView) return
    setBusy(true); setError('')
    try {
      const d = await apiFetch(`/api/admin/filter-views/${activeView._id}`, {
        method: 'PUT',
        body: JSON.stringify({ filters: currentView() }),
      })
      setViews((views || []).map(v => (String(v._id) === String(d.view._id) ? d.view : v)))
    } catch (err) {
      setError(err.message || 'Could not update the view')
    } finally {
      setBusy(false)
    }
  }

  const deleteView = async (id) => {
    if (!window.confirm('Delete this saved view for every admin?')) return
    setBusy(true); setError('')
    try {
      await apiFetch(`/api/admin/filter-views/${id}`, { method: 'DELETE' })
      setViews((views || []).filter(v => String(v._id) !== String(id)))
      if (String(id) === activeViewId) setActiveViewId('')
    } catch (err) {
      setError(err.message || 'Could not delete the view')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-[400px] max-w-full bg-white shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900">Advanced filter</h2>
            <p className="text-[11px] text-gray-400">
              {loading ? 'Checking…' : `${matchCount} ${matchCount === 1 ? 'student' : 'students'}`} · applies live, together with the filters on the page
            </p>
            {notApplied > 0 && (
              <p className="mt-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                ⚠ {notApplied} condition{notApplied > 1 ? 's' : ''} not applied — the count above leaves {notApplied > 1 ? 'them' : 'it'} out. Fix or remove the row marked below.
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-500 text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Saved views */}
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">Saved views (shared)</p>
            {views === null ? (
              <p className="text-xs text-gray-400">Loading…</p>
            ) : !views.length ? (
              <p className="text-xs text-gray-400">None yet — build a filter below and save it.</p>
            ) : (
              <div className="space-y-1">
                {views.map(v => (
                  <div key={v._id}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs ${
                      String(v._id) === activeViewId ? 'border-indigo-300 bg-indigo-50' : 'border-gray-100 hover:bg-gray-50'}`}>
                    <button onClick={() => onApplyView(v)} className="flex-1 text-left font-semibold text-gray-700 truncate">
                      {v.name}
                    </button>
                    {String(v._id) === activeViewId && (
                      <button onClick={updateActive} disabled={busy}
                        title="Overwrite this view with the current filters"
                        className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700">
                        Update
                      </button>
                    )}
                    <button onClick={() => deleteView(v._id)} disabled={busy}
                      title="Delete for every admin"
                      className="text-gray-300 hover:text-red-500">✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-1.5 mt-2">
              <input value={viewName} onChange={e => setViewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveAsNew() }}
                maxLength={60}
                placeholder="Save current filters as…"
                className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
              <button onClick={saveAsNew} disabled={busy}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-300">
                Save
              </button>
            </div>
            {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
          </div>

          {/* Condition rows, one box per AND-group */}
          <ConditionList conditions={conditions} setConditions={setConditions} fields={fields}
            subjects={subjects} programs={programs}
            isComplete={progressConditionComplete} rowProblem={progressRowProblem}
            newFieldKey={PROGRESS_FIELDS[0].key} max={MAX_CONDITIONS} />
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
          <button onClick={() => { onClearAll(); setViewName('') }}
            className="text-xs font-semibold text-gray-400 hover:text-red-500">
            Clear all filters
          </button>
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700">
            Done
          </button>
        </div>
      </div>
    </>
  )
}
