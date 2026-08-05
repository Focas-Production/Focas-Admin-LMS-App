import { useState, useEffect, useMemo } from 'react'
import { apiFetch } from '../api'

// Drag-and-drop class scheduler.
//
//   ┌─ roster ──────┐  ┌─ calendar ─────────────────────────────┐
//   │ students       │  │ all 7 days open at once, each day is a │
//   │ (name, number) │  │ grid of 4 fixed slots × 4 tracks       │
//   └────────────────┘  └────────────────────────────────────────┘
//
// Drops don't commit anything — they STAGE. The admin can rain students across
// any day/slot/track with zero dialogs; staged students show as amber chips.
// One "Review & save" at the end confirms everything in a single modal: new
// classes get a title + host there, and every change is committed together.
//
// The four slots are fixed school periods, not free-form times:
const SLOTS = [
  { key: 'm1', icon: '🌅', name: 'Morning Slot 1', startHour: 6,  endHour: 9  },
  { key: 'm2', icon: '☀️', name: 'Morning Slot 2', startHour: 10, endHour: 13 },
  { key: 'af', icon: '🌤️', name: 'Afternoon Slot', startHour: 14, endHour: 17 },
  { key: 'ev', icon: '🌙', name: 'Evening Slot',   startHour: 19, endHour: 22 },
]

const fmtHour = (h) => {
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}:00 ${ampm}`
}

const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

// Does this student's enrollment cover this paper? Mirrors the server's scoping
// in getStudentChapterProgress: an explicit paper list is exact, otherwise level
// + group decide, and a paper with no group assigned yet counts for everyone in
// the level. Students with nothing set match no subject — they're unconfigured,
// not universally enrolled.
function studiesSubject(student, subject) {
  const picked = (student.caSubjects || []).map(String)
  if (picked.length) return picked.includes(String(subject._id))
  if (!student.caLevel || student.caLevel !== subject.level) return false
  if (!student.caGroup || student.caGroup === 'both') return true
  return !subject.group || subject.group === student.caGroup
}

// Compact "Inter · G1" / "Inter · 2 subj" tag for the roster rows.
function enrollmentLabel(s) {
  const n = (s.caSubjects || []).length
  const lvl = s.caLevel ? s.caLevel.slice(0, 5) : ''
  if (n) return `${lvl ? `${lvl} · ` : ''}${n} subj`
  if (!lvl) return ''
  const g = s.caGroup === 'group1' ? 'G1' : s.caGroup === 'group2' ? 'G2' : s.caGroup === 'both' ? 'Both' : ''
  return g ? `${lvl} · ${g}` : lvl
}

const ENROLMENT_CHIPS = [
  { value: 'all',      label: 'All' },
  { value: 'group1',   label: 'G1' },
  { value: 'group2',   label: 'G2' },
  { value: 'both',     label: 'Both' },
  { value: 'subjects', label: 'Custom' },
  { value: 'unset',    label: 'Not set' },
]

export default function SchedulerBoard({ rooms, hosts, classes, onChanged, onStagedCount }) {
  const [students, setStudents] = useState(null)   // full roster for the left panel
  const [search, setSearch]     = useState('')
  const [enrolFilter, setEnrolFilter] = useState('all')   // see ENROLMENT_CHIPS
  const [subjFilter,  setSubjFilter]  = useState('')      // subject id, '' = any
  const [collapsed, setCollapsed] = useState({})   // dayKey → true when folded away
  const [dragId, setDragId]     = useState(null)   // student id being dragged
  const [overCell, setOverCell] = useState(null)   // cell id under the drag
  const [staged, setStaged]     = useState({})     // cellId → { day, slot, col, ids: [] }
  const [review, setReview]     = useState(false)  // review-and-save modal open
  const [newMeta, setNewMeta]   = useState({})     // cellId → { title, hostUserId } for new classes
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  const [subjects, setSubjects] = useState([])   // subject → chapters → units tree

  useEffect(() => {
    apiFetch('/api/admin/users?limit=2000')
      .then(d => setStudents((d.users || []).filter(u => !u.isAdmin && !u.isMentor)))
      .catch(() => setStudents([]))
    apiFetch('/api/admin/subjects')
      .then(d => setSubjects((d.subjects || []).filter(s => s.isActive)))
      .catch(() => setSubjects([]))
  }, [])

  // id → student, for rendering chips from ids.
  const byId = useMemo(
    () => new Map((students || []).map(s => [String(s._id), s])),
    [students],
  )

  const days = useMemo(() => {
    const out = []
    const now = new Date()
    for (let i = 0; i < 7; i++) {
      out.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i))
    }
    return out
  }, [])

  // All four tracks in display order, with their parent room label.
  const trackCols = useMemo(() =>
    (rooms || []).flatMap(r => r.tracks.map(t => ({
      roomKey: r.key, roomLabel: r.label,
      trackKey: t.key, trackLabel: t.label,
      roomName: t.roomName,
    }))), [rooms])

  const active = useMemo(
    () => (classes || []).filter(c => c.status === 'scheduled' || c.status === 'live'),
    [classes],
  )

  // The class occupying one (day, slot, track) cell, if any.
  const cellClass = (day, slot, roomName) => {
    const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.startHour)
    const e = new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.endHour)
    return active.find(c =>
      c.roomName === roomName &&
      new Date(c.scheduledStart) < e && new Date(c.scheduledEnd) > s,
    ) || null
  }

  // Roster filters, ANDed: free-text, how they're enrolled, and which paper they
  // study — so "Intermediate G1 students who take FM" is two clicks before a drag.
  const pickedSubject = useMemo(
    () => (subjects || []).find(s => String(s._id) === subjFilter) || null,
    [subjects, subjFilter],
  )

  const filtered = (students || []).filter(s => {
    const q = search.trim().toLowerCase()
    if (q && !((s.name || '').toLowerCase().includes(q) || (s.phoneNumber || '').includes(q))) return false

    if (enrolFilter === 'subjects' && !(s.caSubjects || []).length) return false
    if (enrolFilter === 'unset' && (s.caLevel || (s.caSubjects || []).length)) return false
    if (['group1', 'group2', 'both'].includes(enrolFilter) && s.caGroup !== enrolFilter) return false

    if (pickedSubject && !studiesSubject(s, pickedSubject)) return false
    return true
  })

  const stagedCount = Object.values(staged).reduce((n, c) => n + c.ids.length, 0)

  // Let the page show "N staged" on its tab bar while the board is hidden.
  useEffect(() => { onStagedCount?.(stagedCount) }, [stagedCount, onStagedCount])

  // ── staging ──

  const stageDrop = (day, slot, col, studentId) => {
    setOverCell(null); setDragId(null)
    const id = String(studentId)
    if (!byId.get(id)) return
    const cellId = `${dayKey(day)}/${slot.key}/${col.roomName}`
    const existing = cellClass(day, slot, col.roomName)
    // Already allotted on the saved class, or already staged → nothing to do.
    if (existing && (existing.allowedStudents || []).map(String).includes(id)) return
    setStaged(prev => {
      const cell = prev[cellId] || { day, slot, col, ids: [] }
      if (cell.ids.includes(id)) return prev
      return { ...prev, [cellId]: { ...cell, ids: [...cell.ids, id] } }
    })
  }

  const unstage = (cellId, id) => {
    setStaged(prev => {
      const cell = prev[cellId]
      if (!cell) return prev
      const ids = cell.ids.filter(x => x !== String(id))
      const next = { ...prev }
      if (ids.length) next[cellId] = { ...cell, ids }
      else delete next[cellId]
      return next
    })
  }

  // Remove a student already saved on a class — immediate, but rare.
  const removeSaved = async (cls, studentId) => {
    setError('')
    try {
      const ids = (cls.allowedStudents || []).map(String).filter(id => id !== String(studentId))
      await apiFetch(`/api/live-classes/manage/${cls._id}/students`, {
        method: 'PUT', body: JSON.stringify({ studentIds: ids }),
      })
      await onChanged()
    } catch (err) {
      setError(err.message || 'Could not remove the student')
    }
  }

  // ── review & save ──

  const openReview = () => {
    // Prefill title + host for every cell that will become a NEW class.
    const meta = {}
    for (const [cellId, cell] of Object.entries(staged)) {
      if (!cellClass(cell.day, cell.slot, cell.col.roomName)) {
        meta[cellId] = newMeta[cellId] || {
          title: `${cell.col.roomLabel} · ${cell.col.trackLabel} — ${cell.slot.name}`,
          hostUserId: hosts?.[0]?.id ? String(hosts[0].id) : '',
        }
      }
    }
    setNewMeta(meta)
    setReview(true)
  }

  const saveAll = async () => {
    setSaving(true); setError('')
    const failures = []
    for (const [cellId, cell] of Object.entries(staged)) {
      const { day, slot, col, ids } = cell
      const existing = cellClass(day, slot, col.roomName)
      try {
        if (existing) {
          const merged = [...new Set([...(existing.allowedStudents || []).map(String), ...ids])]
          await apiFetch(`/api/live-classes/manage/${existing._id}/students`, {
            method: 'PUT', body: JSON.stringify({ studentIds: merged }),
          })
        } else {
          const meta = newMeta[cellId] || {}
          if (!meta.hostUserId) throw new Error('Pick a host')
          if (!meta.subjectId || !meta.chapterId) throw new Error('Pick a subject and chapter')
          const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.startHour)
          const end   = new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.endHour)
          await apiFetch('/api/live-classes/manage', {
            method: 'POST',
            body: JSON.stringify({
              title: (meta.title || '').trim() || `${col.roomLabel} · ${col.trackLabel}`,
              roomKey: col.roomKey, trackKey: col.trackKey,
              scheduledStart: start.toISOString(), scheduledEnd: end.toISOString(),
              hostUserId: meta.hostUserId, studentIds: ids,
              subjectId: meta.subjectId, chapterId: meta.chapterId,
              unitId: meta.unitId || undefined,
            }),
          })
        }
        setStaged(prev => { const next = { ...prev }; delete next[cellId]; return next })
      } catch (err) {
        failures.push(`${cellLabel(cell)}: ${err.message}`)
      }
    }
    await onChanged()
    setSaving(false)
    if (failures.length) setError(failures.join(' · '))
    else setReview(false)
  }

  const cellLabel = (cell) =>
    `${cell.day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${cell.slot.name} · ${cell.col.roomLabel} ${cell.col.trackLabel}`

  const chipName = (id) => byId.get(String(id))?.name || byId.get(String(id))?.phoneNumber || '…'

  return (
    <div className="mb-6">
      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

      <div className="flex gap-4 items-start">
        {/* ── Left: student roster (sticky so it follows the long day list) ── */}
        <div className="w-64 flex-shrink-0 bg-white rounded-2xl shadow-sm flex flex-col sticky top-4"
          style={{ maxHeight: 'calc(100vh - 2rem)' }}>
          <div className="p-3 border-b border-gray-100">
            <p className="text-xs font-bold text-gray-500 uppercase mb-2">
              Students {students ? `(${filtered.length}${filtered.length !== (students || []).length ? ` of ${students.length}` : ''})` : ''}
            </p>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search name or number…"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-400" />

            <div className="flex flex-wrap gap-1 mt-2">
              {ENROLMENT_CHIPS.map(c => (
                <button key={c.value} onClick={() => setEnrolFilter(c.value)}
                  title={c.value === 'subjects' ? 'Students enrolled for specific papers'
                    : c.value === 'unset' ? 'Students with no enrollment set yet'
                    : c.value === 'all' ? 'Everyone' : `${c.label} students`}
                  className={`text-[10px] font-bold px-2 py-1 rounded-md transition-colors ${
                    enrolFilter === c.value ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  {c.label}
                </button>
              ))}
            </div>

            <select value={subjFilter} onChange={e => setSubjFilter(e.target.value)}
              className="w-full mt-2 px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 bg-white text-gray-600">
              <option value="">Any subject</option>
              {(subjects || []).map(s => (
                <option key={s._id} value={String(s._id)}>
                  {s.name} · {s.level}{s.group ? ` ${s.group === 'group1' ? 'G1' : 'G2'}` : ''}
                </option>
              ))}
            </select>

            {(enrolFilter !== 'all' || subjFilter) && (
              <button onClick={() => { setEnrolFilter('all'); setSubjFilter('') }}
                className="mt-2 text-[10px] font-semibold text-gray-400 hover:text-indigo-600">
                Clear filters
              </button>
            )}
          </div>
          <div className="overflow-y-auto flex-1 p-2">
            {students === null ? (
              <p className="text-xs text-gray-400 p-2">Loading…</p>
            ) : !filtered.length ? (
              <p className="text-xs text-gray-400 p-2">
                No students match this filter{(enrolFilter !== 'all' || subjFilter) ? ' — try Clear filters' : ''}
              </p>
            ) : filtered.map(s => (
              <div key={s._id}
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData('text/plain', String(s._id))
                  e.dataTransfer.effectAllowed = 'copy'
                  setDragId(String(s._id))
                }}
                onDragEnd={() => { setDragId(null); setOverCell(null) }}
                className={`px-2.5 py-2 rounded-lg cursor-grab active:cursor-grabbing select-none mb-0.5
                  border border-transparent hover:border-indigo-200 hover:bg-indigo-50
                  ${dragId === String(s._id) ? 'opacity-40' : ''}`}>
                <p className="text-sm font-medium text-gray-800 truncate">{s.name || '—'}</p>
                <div className="flex items-center gap-1.5">
                  <p className="text-[11px] text-gray-400 truncate">{s.phoneNumber || s.email || ''}</p>
                  {enrollmentLabel(s) && (
                    <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded flex-shrink-0">
                      {enrollmentLabel(s)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-300 px-3 py-2 border-t border-gray-100">
            Drag onto any slot — nothing is saved until you press <b>Review&nbsp;&amp;&nbsp;save</b>
          </p>
        </div>

        {/* ── Right: all 7 days, open ── */}
        <div className="flex-1 min-w-0 space-y-3">
          {days.map(day => {
            const k = dayKey(day)
            const folded = !!collapsed[k]
            return (
              <div key={k} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <button type="button" onClick={() => setCollapsed(c => ({ ...c, [k]: !folded }))}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50">
                  <span className="text-sm font-bold text-gray-800">
                    {day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
                    {k === dayKey(new Date()) &&
                      <span className="ml-2 text-[10px] font-bold text-indigo-500 uppercase">Today</span>}
                  </span>
                  <span className="text-gray-300 text-xs">{folded ? '▸' : '▾'}</span>
                </button>

                {!folded && (
                  <div className="border-t border-gray-100 px-3 pb-3 pt-1 overflow-x-auto">
                    <table className="w-full border-separate table-fixed" style={{ borderSpacing: 6, minWidth: 760 }}>
                      <thead>
                        <tr>
                          <th className="text-left text-[10px] font-bold text-gray-400 uppercase px-2 w-32">Slot</th>
                          {trackCols.map(col => (
                            <th key={col.roomName} className="text-[10px] font-bold text-gray-500 uppercase px-2 pb-1">
                              {col.roomLabel} <span className="text-indigo-500">{col.trackLabel}</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {SLOTS.map(slot => (
                          <tr key={slot.key}>
                            <td className="align-top px-2 py-1.5">
                              <p className="text-xs font-semibold text-gray-700 whitespace-nowrap">{slot.icon} {slot.name}</p>
                              <p className="text-[10px] text-gray-400 whitespace-nowrap">
                                {fmtHour(slot.startHour)} – {fmtHour(slot.endHour)}
                              </p>
                            </td>
                            {trackCols.map(col => {
                              const cls = cellClass(day, slot, col.roomName)
                              const cellId = `${k}/${slot.key}/${col.roomName}`
                              const cellStaged = staged[cellId]?.ids || []
                              const hovered = overCell === cellId
                              const past = !cls &&
                                new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.endHour) < new Date()
                              return (
                                <td key={col.roomName} className="align-top"
                                  onDragOver={e => { if (past) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOverCell(cellId) }}
                                  onDragLeave={() => setOverCell(o => (o === cellId ? null : o))}
                                  onDrop={e => { if (past) return; e.preventDefault(); stageDrop(day, slot, col, e.dataTransfer.getData('text/plain')) }}>
                                  <div className={`rounded-xl border p-1.5 min-h-[52px] transition-colors
                                    ${hovered ? 'border-indigo-400 bg-indigo-50'
                                      : cellStaged.length ? 'border-amber-300 bg-amber-50/60'
                                      : cls ? 'border-gray-200 bg-gray-50'
                                      : past ? 'border-gray-100 bg-gray-50/50'
                                      : 'border-dashed border-gray-200'}`}>
                                    {past && !cls ? (
                                      <p className="text-[10px] text-gray-300 pt-3 text-center">slot over</p>
                                    ) : (
                                      <>
                                        {cls && (
                                          <>
                                            <p className="text-[11px] font-semibold text-gray-800 truncate" title={cls.title}>
                                              {cls.status === 'live' && <span className="text-red-500">● </span>}{cls.title}
                                            </p>
                                            <p className="text-[10px] text-gray-400 truncate">{cls.host?.name}</p>
                                            {cls.chapter?.name && (
                                              <p className="text-[10px] text-indigo-500 truncate mb-1" title={`${cls.subject?.name || ''} · ${cls.chapter.name}${cls.unit?.name ? ` · ${cls.unit.name}` : ''}`}>
                                                📖 {cls.chapter.name}{cls.unit?.name ? ` · ${cls.unit.name}` : ''}
                                              </p>
                                            )}
                                          </>
                                        )}
                                        <div className="flex flex-wrap gap-1">
                                          {(cls?.allowedStudents || []).map(id => (
                                            <span key={String(id)}
                                              className="inline-flex items-center gap-0.5 text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-md">
                                              {chipName(id)}
                                              <button type="button" onClick={() => removeSaved(cls, id)}
                                                className="text-indigo-400 hover:text-indigo-800 font-bold leading-none">×</button>
                                            </span>
                                          ))}
                                          {cls && !(cls.allowedStudents || []).length && !cellStaged.length && (
                                            <span className="text-[10px] text-gray-400 italic">open to all</span>
                                          )}
                                          {cellStaged.map(id => (
                                            <span key={id}
                                              className="inline-flex items-center gap-0.5 text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-md border border-amber-200">
                                              {chipName(id)}
                                              <button type="button" onClick={() => unstage(cellId, id)}
                                                className="text-amber-500 hover:text-amber-900 font-bold leading-none">×</button>
                                            </span>
                                          ))}
                                          {!cls && !cellStaged.length && (
                                            <span className="text-[10px] text-gray-300 w-full pt-2 text-center">drop student here</span>
                                          )}
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Floating action bar — appears once anything is staged ── */}
      {stagedCount > 0 && !review && (
        <div className="fixed bottom-5 right-6 z-40 bg-white rounded-2xl shadow-xl border border-gray-100 px-4 py-3 flex items-center gap-3">
          <span className="text-sm text-gray-700">
            <b>{stagedCount}</b> student{stagedCount > 1 ? 's' : ''} staged in <b>{Object.keys(staged).length}</b> slot{Object.keys(staged).length > 1 ? 's' : ''}
          </span>
          <button onClick={() => setStaged({})}
            className="px-3 py-1.5 rounded-xl border border-gray-200 text-gray-500 text-xs font-semibold hover:bg-gray-50">
            Discard
          </button>
          <button onClick={openReview}
            className="px-4 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700">
            Review &amp; save
          </button>
        </div>
      )}

      {/* ── One confirmation for everything ── */}
      {review && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !saving && setReview(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl p-5 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-gray-900 mb-1">Confirm schedule</h2>
            <p className="text-xs text-gray-400 mb-4">
              {stagedCount} student{stagedCount > 1 ? 's' : ''} across {Object.keys(staged).length} slot{Object.keys(staged).length > 1 ? 's' : ''} — nothing is booked until you confirm.
            </p>

            <div className="space-y-3">
              {Object.entries(staged).map(([cellId, cell]) => {
                const existing = cellClass(cell.day, cell.slot, cell.col.roomName)
                const meta = newMeta[cellId] || {}
                return (
                  <div key={cellId} className="border border-gray-100 rounded-xl p-3">
                    <p className="text-xs font-bold text-gray-700 mb-1">
                      {cell.slot.icon} {cellLabel(cell)}
                    </p>
                    <p className="text-[11px] text-gray-500 mb-2">
                      {cell.ids.map(chipName).join(', ')}
                    </p>
                    {existing ? (
                      <p className="text-[11px] text-indigo-600">
                        → added to <b>{existing.title}</b>
                        {!(existing.allowedStudents || []).length &&
                          <span className="text-amber-600"> (currently open to all — will become restricted)</span>}
                      </p>
                    ) : (() => {
                      const subj = subjects.find(s => s._id === meta.subjectId)
                      const chap = (subj?.chapters || []).find(c => c._id === meta.chapterId)
                      const setMeta = (patch) => setNewMeta(m => ({ ...m, [cellId]: { ...m[cellId], ...patch } }))
                      return (
                        <div className="space-y-2">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input value={meta.title || ''}
                              onChange={e => setMeta({ title: e.target.value })}
                              placeholder="Class title"
                              className="px-3 py-2 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
                            <select value={meta.hostUserId || ''}
                              onChange={e => setMeta({ hostUserId: e.target.value })}
                              className="px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400">
                              <option value="">Select a host…</option>
                              {(hosts || []).map(h => <option key={h.id} value={h.id}>{h.name} ({h.role})</option>)}
                            </select>
                          </div>
                          {/* What this class teaches: subject → chapter, unit optional */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <select value={meta.subjectId || ''}
                              onChange={e => setMeta({ subjectId: e.target.value, chapterId: '', unitId: '' })}
                              className="px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400">
                              <option value="">Subject…</option>
                              {subjects.map(s => <option key={s._id} value={s._id}>{s.name} ({s.level})</option>)}
                            </select>
                            <select value={meta.chapterId || ''} disabled={!subj}
                              onChange={e => setMeta({ chapterId: e.target.value, unitId: '' })}
                              className="px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-50 disabled:text-gray-400">
                              <option value="">{subj ? (subj.chapters?.length ? 'Chapter…' : 'No chapters in subject') : 'Pick subject first'}</option>
                              {/* ✓ = already taught — helps pick what comes next */}
                              {(subj?.chapters || []).map(c => (
                                <option key={c._id} value={c._id}>{c.completed ? '✓ ' : ''}{c.name}</option>
                              ))}
                            </select>
                            <select value={meta.unitId || ''} disabled={!chap?.units?.length}
                              onChange={e => setMeta({ unitId: e.target.value })}
                              className="px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-50 disabled:text-gray-400">
                              <option value="">{chap?.units?.length ? 'Unit (optional)…' : 'No units'}</option>
                              {(chap?.units || []).map(u => (
                                <option key={u._id} value={u._id}>{u.completed ? '✓ ' : ''}{u.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )
              })}
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setReview(false)} disabled={saving}
                className="px-4 py-2 rounded-xl border border-gray-200 text-gray-500 text-sm font-semibold hover:bg-gray-50">
                Back
              </button>
              <button onClick={saveAll} disabled={saving}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:bg-gray-300">
                {saving ? 'Booking…' : `Confirm ${Object.keys(staged).length > 1 ? 'all' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
