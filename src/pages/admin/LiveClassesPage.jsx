import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../../api'
import AttendanceModal from '../../components/AttendanceModal'

function fmtWhen(d) {
  if (!d) return ''
  return new Date(d).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

// How long the class ran on the clock: start → end (or → now if still live).
function runDuration(c) {
  if (!c.startedAt) return null
  const end = c.endedAt ? new Date(c.endedAt).getTime() : (c.status === 'live' ? Date.now() : null)
  if (!end) return null
  const m = Math.round((end - new Date(c.startedAt).getTime()) / 60000)
  const label = m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
  return c.status === 'live' ? `${label} so far` : label
}

const STATUS_STYLE = {
  scheduled: 'bg-sky-100 text-sky-700',
  live:      'bg-red-100 text-red-700',
  ended:     'bg-gray-100 text-gray-500',
  cancelled: 'bg-amber-100 text-amber-700',
}

const EMPTY = { title: '', description: '', hostUserId: '', scheduledStart: '', scheduledEnd: '' }

export default function LiveClassesPage() {
  const [classes, setClasses] = useState(null)
  const [hosts, setHosts]     = useState([])
  const [form, setForm]       = useState(EMPTY)
  const [saving, setSaving]   = useState(false)
  const [busyId, setBusyId]   = useState(null)
  const [error, setError]     = useState('')
  const [attendance, setAttendance] = useState(null)  // { title, roster, class } modal

  const load = useCallback(async () => {
    try {
      const d = await apiFetch('/api/live-classes/manage')
      setClasses(d.classes || [])
    } catch {
      setClasses([])
    }
  }, [])

  useEffect(() => {
    load()
    apiFetch('/api/live-classes/manage/hosts')
      .then(d => setHosts(d.hosts || []))
      .catch(() => {})
  }, [load])

  const create = async (e) => {
    e.preventDefault()
    if (!form.title.trim() || !form.hostUserId || !form.scheduledStart) {
      setError('Title, host and start time are required'); return
    }
    setSaving(true); setError('')
    try {
      await apiFetch('/api/live-classes/manage', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          hostUserId: form.hostUserId,
          scheduledStart: new Date(form.scheduledStart).toISOString(),
          scheduledEnd: form.scheduledEnd ? new Date(form.scheduledEnd).toISOString() : undefined,
        }),
      })
      setForm(EMPTY)
      await load()
    } catch (err) {
      setError(err.message || 'Could not create class')
    } finally {
      setSaving(false)
    }
  }

  const act = async (cls, action) => {
    const verb = action === 'end' ? 'End this class for everyone?' : 'Cancel this scheduled class?'
    if (!confirm(verb)) return
    setBusyId(cls._id)
    try { await apiFetch(`/api/live-classes/manage/${cls._id}/${action}`, { method: 'POST' }); await load() }
    catch (err) { setError(err.message || 'Action failed') }
    finally { setBusyId(null) }
  }

  const openAttendance = async (cls) => {
    setAttendance({ title: cls.title, roster: null, class: null })
    try {
      const d = await apiFetch(`/api/live-classes/manage/${cls._id}/attendance`)
      setAttendance({ title: cls.title, roster: d.roster || [], class: d.class || null })
    } catch {
      setAttendance({ title: cls.title, roster: [], class: null })
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Live Classes</h1>
      <p className="text-gray-500 text-sm mb-6">Schedule live classes and assign a mentor or admin to host them.</p>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {/* Schedule form */}
      <form onSubmit={create} className="bg-white rounded-2xl shadow-sm p-5 mb-6 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Class title</label>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Taxation — Capital Gains marathon"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Host</label>
            <select value={form.hostUserId} onChange={e => setForm({ ...form, hostUserId: e.target.value })}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-indigo-400">
              <option value="">Select a host…</option>
              {hosts.map(h => <option key={h.id} value={h.id}>{h.name} ({h.role})</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Description (optional)</label>
          <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Starts at</label>
            <input type="datetime-local" value={form.scheduledStart}
              onChange={e => setForm({ ...form, scheduledStart: e.target.value })}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Ends at (optional)</label>
            <input type="datetime-local" value={form.scheduledEnd}
              onChange={e => setForm({ ...form, scheduledEnd: e.target.value })}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
        </div>
        <button type="submit" disabled={saving}
          className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:bg-gray-300">
          {saving ? 'Scheduling…' : 'Schedule class'}
        </button>
      </form>

      {/* List */}
      {classes === null ? (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400 text-sm">Loading…</div>
      ) : !classes.length ? (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400 text-sm">No classes scheduled yet.</div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold">Class</th>
                <th className="text-left px-4 py-2.5 font-semibold">Host</th>
                <th className="text-left px-4 py-2.5 font-semibold">Starts</th>
                <th className="text-left px-4 py-2.5 font-semibold">Ran</th>
                <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                <th className="text-right px-4 py-2.5 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {classes.map((c) => (
                <tr key={c._id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{c.title}</p>
                    {c.description && <p className="text-xs text-gray-400 truncate max-w-xs">{c.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{c.host?.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtWhen(c.scheduledStart)}</td>
                  <td className="px-4 py-3 text-gray-600">{runDuration(c) || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${STATUS_STYLE[c.status] || ''}`}>
                      {c.status === 'live' ? '● live' : c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                    {c.status === 'scheduled' && (
                      <button onClick={() => act(c, 'cancel')} disabled={busyId === c._id}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 text-xs font-semibold hover:bg-gray-50">
                        Cancel
                      </button>
                    )}
                    {c.status === 'live' && (
                      <button onClick={() => act(c, 'end')} disabled={busyId === c._id}
                        className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50">
                        End
                      </button>
                    )}
                    {(c.status === 'live' || c.status === 'ended') && (
                      <button onClick={() => openAttendance(c)}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50">
                        Attendance
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {attendance && (
        <AttendanceModal title={attendance.title} roster={attendance.roster} classInfo={attendance.class} onClose={() => setAttendance(null)} />
      )}
    </div>
  )
}
