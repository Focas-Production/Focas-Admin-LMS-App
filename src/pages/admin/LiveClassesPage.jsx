import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../../api'
import AttendanceModal from '../../components/AttendanceModal'
import SchedulerBoard from '../../components/SchedulerBoard'

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

// Each track has one permanent join URL. It names the track, not a class, so it
// never expires — share it once with a batch and it works for every class that
// track ever runs.
const STUDENT_APP = import.meta.env.VITE_STUDENT_APP_URL || 'http://localhost:5173'
const trackUrl = (roomKey, trackKey) => `${STUDENT_APP}/live/${roomKey}/${trackKey}`

export default function LiveClassesPage() {
  const [classes, setClasses] = useState(null)
  const [hosts, setHosts]     = useState([])
  const [rooms, setRooms]     = useState([])   // fixed room/track topology + occupancy
  const [tab, setTab]         = useState('board')  // 'board' | 'list'
  const [stagedCount, setStagedCount] = useState(0) // drops staged in the board, not yet saved
  const [busyId, setBusyId]   = useState(null)
  const [error, setError]     = useState('')
  const [attendance, setAttendance] = useState(null)  // { title, roster, class } modal
  const [copied, setCopied]   = useState('')          // "roomKey/trackKey" just copied
  const [allot, setAllot]     = useState(null)        // { cls, students, loading, saving } edit modal

  const copyTrackLink = async (roomKey, trackKey) => {
    const url = trackUrl(roomKey, trackKey)
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Clipboard API needs a secure context; fall back to a prompt the admin can copy from.
      window.prompt('Copy this link', url)
    }
    setCopied(`${roomKey}/${trackKey}`)
    setTimeout(() => setCopied(''), 2000)
  }

  const load = useCallback(async () => {
    try {
      const d = await apiFetch('/api/live-classes/manage')
      setClasses(d.classes || [])
    } catch {
      setClasses([])
    }
  }, [])

  const loadTopology = useCallback(async () => {
    try {
      const d = await apiFetch('/api/live-classes/manage/topology')
      setRooms(d.rooms || [])
    } catch {
      setRooms([])
    }
  }, [])

  useEffect(() => {
    load()
    loadTopology()
    apiFetch('/api/live-classes/manage/hosts')
      .then(d => setHosts(d.hosts || []))
      .catch(() => {})
  }, [load, loadTopology])

  const act = async (cls, action) => {
    const verb = action === 'end' ? 'End this class for everyone?' : 'Cancel this scheduled class?'
    if (!confirm(verb)) return
    setBusyId(cls._id)
    try {
      await apiFetch(`/api/live-classes/manage/${cls._id}/${action}`, { method: 'POST' })
      await Promise.all([load(), loadTopology()])
    }
    catch (err) { setError(err.message || 'Action failed') }
    finally { setBusyId(null) }
  }

  // Edit who may join a scheduled/live class.
  const openAllotment = async (cls) => {
    setAllot({ cls, students: null, saving: false })
    try {
      const d = await apiFetch(`/api/live-classes/manage/${cls._id}/students`)
      setAllot({ cls, students: d.students || [], saving: false })
    } catch (err) {
      setError(err.message || 'Could not load the student list')
      setAllot(null)
    }
  }

  const saveAllotment = async () => {
    if (!allot || allot.saving) return
    setAllot(a => ({ ...a, saving: true }))
    try {
      await apiFetch(`/api/live-classes/manage/${allot.cls._id}/students`, {
        method: 'PUT',
        body: JSON.stringify({ studentIds: allot.students.map(s => s.id) }),
      })
      setAllot(null)
      await load()
    } catch (err) {
      setError(err.message || 'Could not save the student list')
      setAllot(a => ({ ...a, saving: false }))
    }
  }

  const openAttendance = async (cls) => {
    setAttendance({ id: cls._id, title: cls.title, roster: null, class: null, meta: null })
    try {
      const d = await apiFetch(`/api/live-classes/manage/${cls._id}/attendance`)
      setAttendance({ id: cls._id, title: cls.title, roster: d.roster || [], class: d.class || null, meta: d.attendance || null })
    } catch {
      setAttendance({ id: cls._id, title: cls.title, roster: [], class: null, meta: null })
    }
  }

  // Override a student's auto verdict (present / chapter completed) and patch the
  // open modal's roster in place with what the server settled on.
  const updateAttendanceRecord = async (userId, patch) => {
    try {
      const d = await apiFetch(`/api/live-classes/manage/${attendance.id}/attendance/${userId}`, {
        method: 'PATCH', body: JSON.stringify(patch),
      })
      const rec = d.record
      setAttendance((a) => a && ({
        ...a,
        roster: a.roster.map((p) => String(p.userId) === String(userId)
          ? { ...p, record: { ...p.record, present: rec.present, presentSource: rec.presentSource, chapterCompleted: rec.chapterCompleted, chapterSource: rec.chapterSource, markedByName: rec.markedBy?.name || '' } }
          : p),
      }))
    } catch (err) {
      setError(err.message || 'Could not update attendance')
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-screen-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Live Classes</h1>
      <p className="text-gray-500 text-sm mb-6">Drag students onto any day's slots, then confirm everything once with Review &amp; save.</p>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {/* Occupancy — what each fixed track is doing right now */}
      {!!rooms.length && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {rooms.map(room => (
            <div key={room.key} className="bg-white rounded-2xl shadow-sm p-4">
              <p className="text-xs font-bold text-gray-500 uppercase mb-2.5">{room.label}</p>
              <div className="space-y-2">
                {room.tracks.map(t => (
                  <div key={t.key} className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.live ? 'bg-red-500' : 'bg-gray-300'}`} />
                    <span className="text-sm font-medium text-gray-700 w-16 flex-shrink-0">{t.label}</span>
                    <span className="text-xs text-gray-400 truncate flex-1">
                      {t.live
                        ? <span className="text-red-600 font-semibold">● {t.live.title}</span>
                        : t.next
                          ? `next: ${t.next.title} — ${fmtWhen(t.next.scheduledStart)}`
                          : 'free'}
                    </span>
                    <button
                      onClick={() => copyTrackLink(room.key, t.key)}
                      title={trackUrl(room.key, t.key)}
                      className="text-[10px] font-semibold px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 flex-shrink-0">
                      {copied === `${room.key}/${t.key}` ? '✓ Copied' : 'Copy link'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Scheduler and the class list live in tabs, so neither buries the other. */}
      <div className="flex gap-1 mb-4">
        {[
          ['board', `📅 Scheduler${stagedCount ? ` · ${stagedCount} staged` : ''}`],
          ['list', `📋 All classes${classes?.length ? ` (${classes.length})` : ''}`],
        ].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === key ? 'bg-indigo-600 text-white'
              : key === 'board' && stagedCount ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
              : 'bg-white text-gray-500 hover:bg-gray-50 border border-gray-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* The board is tall — keep a switcher within reach at the bottom too, so
          the admin never has to scroll back up to reach the other view. Draggable:
          wherever it floats, it covers something, so the admin parks it where it
          doesn't get in the way (position remembered per browser). */}
      <DraggableFab
        label={tab === 'board'
          ? `📋 All classes${classes?.length ? ` (${classes.length})` : ''}`
          : `📅 Scheduler${stagedCount ? ` · ${stagedCount} staged` : ''}`}
        onActivate={() => {
          setTab(tab === 'board' ? 'list' : 'board')
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      />

      {/* Drag-and-drop scheduler: roster on the left, 7-day slot calendar right.
          Kept MOUNTED (just hidden) on the list tab — unmounting would throw away
          any drops the admin staged but hasn't saved yet. */}
      <div className={tab === 'board' ? '' : 'hidden'}>
        <SchedulerBoard
          rooms={rooms}
          hosts={hosts}
          classes={classes || []}
          onChanged={() => Promise.all([load(), loadTopology()])}
          onStagedCount={setStagedCount}
        />
      </div>

      {/* List */}
      {tab === 'list' && (classes === null ? (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400 text-sm">Loading…</div>
      ) : !classes.length ? (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400 text-sm">No classes scheduled yet.</div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold">Class</th>
                <th className="text-left px-4 py-2.5 font-semibold">Where</th>
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
                    {c.chapter?.name && (
                      <p className="text-xs text-indigo-500 truncate max-w-xs">
                        📖 {c.subject?.name ? `${c.subject.name} · ` : ''}{c.chapter.name}{c.unit?.name ? ` · ${c.unit.name}` : ''}
                      </p>
                    )}
                    {c.description && <p className="text-xs text-gray-400 truncate max-w-xs">{c.description}</p>}
                  </td>
                  <td className="px-4 py-3">
                    {c.room?.label ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 whitespace-nowrap">
                        {c.room.label} · {c.track?.label}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
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
                    {(c.status === 'scheduled' || c.status === 'live') && (
                      <button onClick={() => openAllotment(c)}
                        className="px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-600 text-xs font-semibold hover:bg-indigo-50">
                        Students{c.allowedStudents?.length ? ` (${c.allowedStudents.length})` : ': all'}
                      </button>
                    )}
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
      ))}

      {attendance && (
        <AttendanceModal title={attendance.title} roster={attendance.roster} classInfo={attendance.class}
          meta={attendance.meta} onToggleRecord={updateAttendanceRecord} onClose={() => setAttendance(null)} />
      )}

      {/* Edit-allotment modal */}
      {allot && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !allot.saving && setAllot(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-gray-900 mb-0.5">Who can join</h2>
            <p className="text-xs text-gray-400 mb-4 truncate">{allot.cls.title}</p>

            {allot.students === null ? (
              <p className="text-sm text-gray-400 py-6 text-center">Loading…</p>
            ) : (
              <>
                <StudentPicker
                  selected={allot.students}
                  onChange={(students) => setAllot(a => ({ ...a, students }))}
                />
                <p className="text-[11px] text-gray-400 mt-2">
                  {allot.students.length
                    ? `Only these ${allot.students.length} student${allot.students.length > 1 ? 's' : ''} can see and join this class.`
                    : 'Empty list — every logged-in student can join.'}
                </p>
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setAllot(null)} disabled={allot.saving}
                    className="px-4 py-2 rounded-xl border border-gray-200 text-gray-500 text-sm font-semibold hover:bg-gray-50">
                    Cancel
                  </button>
                  <button onClick={saveAllotment} disabled={allot.saving}
                    className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:bg-gray-300">
                    {allot.saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Floating pill button the admin can drag anywhere on screen. A fixed position
// always ends up covering some slot cell, so let them park it; the spot persists
// per browser. A press with <5px of movement counts as a click.
const FAB_POS_KEY = 'liveclasses-fab-pos'

function DraggableFab({ label, onActivate }) {
  const [pos, setPos] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FAB_POS_KEY))
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return saved
    } catch { /* corrupted — fall back to default */ }
    return null   // null → default bottom-centre
  })
  const drag = useRef(null)  // { startX, startY, offsetX, offsetY, moved }

  const clamp = (x, y) => ({
    x: Math.min(Math.max(x, 8), window.innerWidth - 120),
    y: Math.min(Math.max(y, 8), window.innerHeight - 48),
  })

  const onPointerDown = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    drag.current = {
      startX: e.clientX, startY: e.clientY,
      offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
      moved: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 5) d.moved = true
    if (d.moved) setPos(clamp(e.clientX - d.offsetX, e.clientY - d.offsetY))
  }

  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) {
      setPos(p => { try { localStorage.setItem(FAB_POS_KEY, JSON.stringify(p)) } catch { /* private mode */ } return p })
    } else {
      onActivate()
    }
  }

  return (
    <button
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title="Click to switch · drag to move"
      style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto', transform: 'none', touchAction: 'none' } : { touchAction: 'none' }}
      className={`fixed z-40 px-4 py-2.5 rounded-2xl bg-white shadow-xl border border-gray-100 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 cursor-grab active:cursor-grabbing select-none whitespace-nowrap
        ${pos ? '' : 'bottom-5 left-1/2 -translate-x-1/2'}`}>
      {label}
    </button>
  )
}

// Search-and-chip selector over the student roster. Backed by the existing
// /api/admin/users search; results exclude anyone already picked.
// Compact "Inter · G1" / "Inter · 2 subj" tag, same shape the scheduler roster uses.
function enrollmentTag(s) {
  const n = (s.caSubjects || []).length
  const lvl = s.caLevel ? s.caLevel.slice(0, 5) : ''
  if (n) return `${lvl ? `${lvl} · ` : ''}${n} subj`
  if (!lvl) return ''
  const g = s.caGroup === 'group1' ? 'G1' : s.caGroup === 'group2' ? 'G2' : s.caGroup === 'both' ? 'Both' : ''
  return g ? `${lvl} · ${g}` : lvl
}

function StudentPicker({ selected, onChange }) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef(null)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (!query.trim()) return
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const d = await apiFetch(`/api/admin/users?search=${encodeURIComponent(query.trim())}&limit=15`)
        // Students only — mentors and admins are hosts, not audience.
        setResults((d.users || []).filter(u => !u.isAdmin && !u.isMentor))
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  const pickedIds = new Set(selected.map(s => String(s.id)))
  const addable = results.filter(u => !pickedIds.has(String(u._id)))

  const add = (u) => {
    onChange([...selected, { id: u._id, name: u.name || '', phoneNumber: u.phoneNumber || '' }])
    setQuery(''); setResults([])
  }
  const remove = (id) => onChange(selected.filter(s => String(s.id) !== String(id)))

  return (
    <div>
      {!!selected.length && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map(s => (
            <span key={s.id}
              className="inline-flex items-center gap-1 text-xs font-medium bg-indigo-50 text-indigo-700 px-2 py-1 rounded-lg">
              {s.name || s.phoneNumber || 'Student'}
              <button type="button" onClick={() => remove(s.id)}
                className="text-indigo-400 hover:text-indigo-700 font-bold leading-none">×</button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search students by name, phone or email…"
          className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-400" />

        {query.trim() && (
          <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-lg max-h-56 overflow-y-auto">
            {searching ? (
              <p className="text-xs text-gray-400 px-3 py-2.5">Searching…</p>
            ) : !addable.length ? (
              <p className="text-xs text-gray-400 px-3 py-2.5">No matching students</p>
            ) : addable.map(u => (
              <button key={u._id} type="button" onClick={() => add(u)}
                className="w-full text-left px-3 py-2 hover:bg-indigo-50 text-sm">
                <span className="font-medium text-gray-800">{u.name || '—'}</span>
                <span className="text-xs text-gray-400 ml-2">{u.phoneNumber || u.email}</span>
                {/* Enrollment tag makes it obvious when a search hit is from the
                    wrong group before it's added to the class. */}
                {enrollmentTag(u) && (
                  <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded ml-2">
                    {enrollmentTag(u)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
