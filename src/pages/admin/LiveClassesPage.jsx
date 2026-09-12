import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { apiFetch } from '../../api'
import AttendanceModal from '../../components/AttendanceModal'
import SubmissionsModal from '../../components/SubmissionsModal'
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

// Day heading for the upcoming list: "Today" / "Tomorrow" for the two that
// matter most at a glance, an explicit date beyond that.
function dayLabel(d) {
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((day - today) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
}

const dayStamp = (d) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`
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
  const [submissions, setSubmissions] = useState(null) // { id, title } review modal
  const [subCounts, setSubCounts] = useState({})       // classId → { total, pending }
  const [copied, setCopied]   = useState('')          // "roomKey/trackKey" just copied
  const [allot, setAllot]     = useState(null)        // { cls, students, loading, saving } edit modal
  const [subjects, setSubjects] = useState([])        // subject → chapters → units tree, for the edit modal
  const [edit, setEdit]       = useState(null)        // { cls, hostUserId, subjectId, chapterId, unitId, saving, error }
  const [pastOpen, setPastOpen] = useState(false)     // history section folded by default
  const [listRoom, setListRoom] = useState('all')     // room filter over the whole list

  // "Both rooms" leads because it is the default — the selected option should be
  // the first thing read, then the two ways to narrow it.
  const roomChoices = useMemo(
    () => [{ key: 'all', label: 'Both rooms' }, ...(rooms || []).map(r => ({ key: r.key, label: r.label }))],
    [rooms],
  )

  // The list reads in the order an admin actually works it: what is running
  // right now, then what is coming next (soonest first, broken by day), and
  // finished/cancelled classes parked in their own section at the bottom.
  // The server's own order is not relied on — the sort is explicit here.
  const listGroups = useMemo(() => {
    // The room filter governs EVERY section, not just upcoming — asking for
    // Room 2 and still being shown Room 1's live class would be a lie.
    const all = (classes || []).filter(c => listRoom === 'all' || c.room?.key === listRoom)
    const byStart = (a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart)

    const live = all.filter(c => c.status === 'live').sort(byStart)
    const upcoming = all.filter(c => c.status === 'scheduled').sort(byStart)
    // History reads newest first — the most recent class is the one being asked about.
    const past = all
      .filter(c => c.status === 'ended' || c.status === 'cancelled')
      .sort((a, b) => new Date(b.scheduledStart) - new Date(a.scheduledStart))

    // Upcoming is split into day runs so "this evening" and "tomorrow" are
    // readable without checking each date.
    const days = []
    for (const c of upcoming) {
      const key = dayStamp(c.scheduledStart)
      if (days[days.length - 1]?.key !== key) {
        days.push({ key, label: dayLabel(c.scheduledStart), items: [] })
      }
      days[days.length - 1].items.push(c)
    }
    return { live, upcoming, upcomingDays: days, past }
  }, [classes, listRoom])

  // Flattened into section headers + rows so one table keeps every column aligned.
  const listRows = useMemo(() => {
    const { live, upcoming, upcomingDays, past } = listGroups
    const rows = []
    if (live.length) {
      rows.push({ kind: 'section', key: 'sec-live', label: 'Happening now', count: live.length, tone: 'live' })
      live.forEach(c => rows.push({ kind: 'class', cls: c }))
    }
    // Always rendered, even at zero — it carries the room filter, which must stay
    // reachable to undo a filter that emptied the list.
    rows.push({ kind: 'section', key: 'sec-up', label: 'Upcoming', count: upcoming.length, filter: true })
    upcomingDays.forEach(d => {
      rows.push({ kind: 'day', key: `day-${d.key}`, label: d.label, count: d.items.length })
      d.items.forEach(c => rows.push({ kind: 'class', cls: c }))
    })
    if (!upcoming.length) rows.push({ kind: 'empty', key: 'up-none' })
    if (past.length) {
      rows.push({ kind: 'section', key: 'sec-past', label: 'Ended & cancelled', count: past.length, fold: true })
      if (pastOpen) past.forEach(c => rows.push({ kind: 'class', cls: c }))
    }
    return rows
  }, [listGroups, pastOpen])

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
    apiFetch('/api/admin/subjects')
      .then(d => setSubjects((d.subjects || []).filter(s => s.isActive)))
      .catch(() => {})
  }, [load, loadTopology])

  // Submission badges for every listed class in one request. Badge-only data, so
  // a failure stays silent rather than raising an error banner over the list.
  useEffect(() => {
    const ids = (classes || []).map(c => c._id)
    if (!ids.length) return
    apiFetch(`/api/live-classes/manage/submission-counts?ids=${ids.join(',')}`)
      .then(d => setSubCounts(d.counts || {}))
      .catch(() => {})
  }, [classes])

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

  // Edit a scheduled class before it starts: who teaches it and what it teaches.
  const openEdit = (cls) => {
    setEdit({
      cls,
      hostUserId: cls.host?.userId ? String(cls.host.userId) : '',
      subjectId:  cls.subject?.subjectId ? String(cls.subject.subjectId) : '',
      chapterId:  cls.chapter?.chapterId ? String(cls.chapter.chapterId) : '',
      unitId:     cls.unit?.unitId ? String(cls.unit.unitId) : '',
      saving: false, error: '',
    })
  }

  const saveEdit = async () => {
    if (!edit || edit.saving) return
    setEdit(e => ({ ...e, saving: true, error: '' }))
    try {
      await apiFetch(`/api/live-classes/manage/${edit.cls._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          // JSON drops undefined — an empty host means "leave the host alone",
          // while the curriculum ids always travel together as one pick.
          hostUserId: edit.hostUserId || undefined,
          subjectId: edit.subjectId, chapterId: edit.chapterId, unitId: edit.unitId,
        }),
      })
      setEdit(null)
      await load()
    } catch (err) {
      setEdit(e => e && ({ ...e, saving: false, error: err.message || 'Could not update the class' }))
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
      <p className="text-gray-500 text-sm mb-6">Set a slot's mentor &amp; chapter, drag students into it, then confirm everything once with Review &amp; save.</p>

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
              {listRows.map((row) => {
                // Section band: "Happening now" / "Upcoming" / the folded history.
                if (row.kind === 'section') return (
                  <tr key={row.key} className="bg-gray-50/80">
                    <td colSpan={7} className="px-4 py-2">
                      {row.fold ? (
                        <button type="button" onClick={() => setPastOpen(o => !o)}
                          className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 hover:text-indigo-600">
                          <span className="text-gray-400">{pastOpen ? '▾' : '▸'}</span>
                          {row.label}
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600 normal-case tracking-normal">
                            {row.count}
                          </span>
                        </button>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <span className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider ${
                            row.tone === 'live' ? 'text-red-600' : 'text-indigo-600'}`}>
                            {row.tone === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
                            {row.label}
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full normal-case tracking-normal ${
                              row.tone === 'live' ? 'bg-red-100 text-red-700' : 'bg-indigo-100 text-indigo-700'}`}>
                              {row.count}
                            </span>
                          </span>
                          {/* Room filter — sits here but governs every section below AND above. */}
                          {row.filter && roomChoices.length > 1 && (
                            <span className="inline-flex bg-white border border-gray-200 rounded-lg p-0.5 shadow-sm">
                              {roomChoices.map(opt => (
                                <button key={opt.key} type="button" onClick={() => setListRoom(opt.key)}
                                  title={`Show ${opt.label} in every section`}
                                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                                    listRoom === opt.key
                                      ? 'bg-indigo-600 text-white'
                                      : 'text-gray-500 hover:text-indigo-600'}`}>
                                  {opt.label}
                                </button>
                              ))}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
                if (row.kind === 'empty') return (
                  <tr key={row.key}>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-400">
                      {listRoom === 'all'
                        ? 'Nothing scheduled ahead.'
                        : `Nothing scheduled ahead in ${roomChoices.find(r => r.key === listRoom)?.label || 'this room'}.`}
                    </td>
                  </tr>
                )
                // Day break inside Upcoming — "Today", "Tomorrow", then the date.
                if (row.kind === 'day') return (
                  <tr key={row.key}>
                    <td colSpan={7} className="px-4 pt-3 pb-1">
                      <span className="text-[11px] font-bold text-gray-700">{row.label}</span>
                      <span className="ml-2 text-[10px] text-gray-400">{row.count} class{row.count > 1 ? 'es' : ''}</span>
                    </td>
                  </tr>
                )
                const c = row.cls
                return (
                <tr key={c._id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{c.title}</p>
                    {/* Same one-line format the scheduler cells use:
                        Mentor - Subject - Chapter - Unit, wrapping when long. */}
                    {(c.host?.name || c.chapter?.name) && (
                      <p className="text-xs font-semibold leading-snug break-words max-w-md">
                        <span className="text-gray-900">🧑‍🏫 {c.host?.name || '—'}</span>
                        <span className="text-indigo-700">
                          {c.subject?.name ? ` - ${c.subject.name}` : ''}{c.chapter?.name ? ` - ${c.chapter.name}` : ''}{c.unit?.name ? ` - ${c.unit.name}` : ''}
                        </span>
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
                    {/* Only before it starts — the server rejects edits once live. */}
                    {c.status === 'scheduled' && (
                      <button onClick={() => openEdit(c)}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50">
                        Edit
                      </button>
                    )}
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
                    {(c.status === 'live' || c.status === 'ended') && (
                      <button onClick={() => setSubmissions({ id: c._id, title: c.title })}
                        title="Student work handed in for this class"
                        className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${
                          subCounts[c._id]?.pending
                            ? 'border-amber-300 text-amber-700 hover:bg-amber-50'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                        Submissions
                        {subCounts[c._id]?.total > 0 && (
                          <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                            subCounts[c._id].pending ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-600'}`}>
                            {subCounts[c._id].pending || subCounts[c._id].total}
                          </span>
                        )}
                      </button>
                    )}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}

      {attendance && (
        <AttendanceModal title={attendance.title} roster={attendance.roster} classInfo={attendance.class}
          meta={attendance.meta} onToggleRecord={updateAttendanceRecord} onClose={() => setAttendance(null)} />
      )}

      {/* Student work handed in for this class */}
      {submissions && (
        <SubmissionsModal
          classId={submissions.id}
          title={submissions.title}
          apiFetch={apiFetch}
          accent="blue"
          onCountsChange={(counts) => setSubCounts(c => ({ ...c, [submissions.id]: counts }))}
          onClose={() => setSubmissions(null)}
        />
      )}

      {/* Edit a scheduled class — host and subject/chapter/unit, before it starts */}
      {edit && (() => {
        const subj = subjects.find(s => String(s._id) === edit.subjectId)
        const chap = (subj?.chapters || []).find(c => String(c._id) === edit.chapterId)
        const set = (patch) => setEdit(e => e && ({ ...e, ...patch }))
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
            onClick={() => !edit.saving && setEdit(null)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
              <h2 className="text-base font-bold text-gray-900 mb-0.5">Edit class</h2>
              <p className="text-xs text-gray-400 mb-4 truncate">
                {edit.cls.title} · {fmtWhen(edit.cls.scheduledStart)}
              </p>

              {edit.error && <p className="text-xs text-red-500 mb-3">{edit.error}</p>}

              <div className="space-y-3">
                <div>
                  <p className="text-[11px] font-bold text-gray-500 uppercase mb-1">Host</p>
                  <select value={edit.hostUserId}
                    onChange={e => set({ hostUserId: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400">
                    <option value="">Keep current host{edit.cls.host?.name ? ` (${edit.cls.host.name})` : ''}</option>
                    {hosts.map(h => <option key={h.id} value={String(h.id)}>{h.name} ({h.role})</option>)}
                  </select>
                </div>

                <div>
                  <p className="text-[11px] font-bold text-gray-500 uppercase mb-1">What this class teaches</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select value={edit.subjectId}
                      onChange={e => set({ subjectId: e.target.value, chapterId: '', unitId: '' })}
                      className="px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400">
                      <option value="">Subject…</option>
                      {subjects.map(s => <option key={s._id} value={String(s._id)}>{s.name} ({s.level})</option>)}
                    </select>
                    <select value={edit.chapterId} disabled={!subj}
                      onChange={e => set({ chapterId: e.target.value, unitId: '' })}
                      className="px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-50 disabled:text-gray-400">
                      <option value="">{subj ? (subj.chapters?.length ? 'Chapter…' : 'No chapters in subject') : 'Pick subject first'}</option>
                      {/* ✓ = already taught — helps pick what comes next */}
                      {(subj?.chapters || []).map(c => (
                        <option key={c._id} value={String(c._id)}>{c.completed ? '✓ ' : ''}{c.name}</option>
                      ))}
                    </select>
                    <select value={edit.unitId} disabled={!chap?.units?.length}
                      onChange={e => set({ unitId: e.target.value })}
                      className="px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-50 disabled:text-gray-400">
                      <option value="">{chap?.units?.length ? 'Unit (optional)…' : 'No units'}</option>
                      {(chap?.units || []).map(u => (
                        <option key={u._id} value={String(u._id)}>{u.completed ? '✓ ' : ''}{u.name}</option>
                      ))}
                    </select>
                  </div>
                  {edit.subjectId && !edit.chapterId && !!(subj?.chapters || []).length && (
                    <p className="text-[10px] text-amber-600 mt-1">Pick a chapter — a subject alone doesn't track progress.</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setEdit(null)} disabled={edit.saving}
                  className="px-4 py-2 rounded-xl border border-gray-200 text-gray-500 text-sm font-semibold hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={saveEdit} disabled={edit.saving}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:bg-gray-300">
                  {edit.saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Edit-allotment modal */}
      {allot && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !allot.saving && setAllot(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
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
                <ChapterStatusPicker
                  cls={allot.cls}
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

// Bulk-add by chapter status. When the class is booked against a chapter, the
// same ladder the scheduler filters on (not allotted → allotted → attended →
// done, from /api/admin/syllabus-completion) lists every enrolled student in
// the paper's scope with where they stand on that chapter — so "add everyone
// who still needs it" is one click instead of a name-by-name search. Renders
// nothing for a class with no chapter.
const PICKER_CHIPS = [
  { key: 'not-allotted', label: 'Not allotted', on: 'bg-gray-500 text-white',    title: 'No class for this chapter is assigned to them yet' },
  { key: 'allotted',     label: 'Allotted',     on: 'bg-indigo-500 text-white',  title: 'A class is assigned, or was held and missed — not attended yet' },
  { key: 'attended',     label: 'Attended',     on: 'bg-sky-600 text-white',     title: 'Attended at least one class for it; not completed yet' },
  { key: 'completed',    label: '✓ Done',       on: 'bg-emerald-600 text-white', title: 'Completed this chapter' },
]

function ChapterStatusPicker({ cls, selected, onChange }) {
  const subjectId = cls.subject?.subjectId ? String(cls.subject.subjectId) : ''
  const chapterId = cls.chapter?.chapterId ? String(cls.chapter.chapterId) : ''
  const unitId    = cls.unit?.unitId ? String(cls.unit.unitId) : ''
  const url = subjectId && chapterId
    ? `/api/admin/syllabus-completion?subjectId=${subjectId}&chapterId=${chapterId}${unitId ? `&unitId=${unitId}` : ''}&withStudents=1`
    : ''
  // `key` is the url the held answer belongs to — anything else means we're
  // still loading, so nothing is set synchronously in the effect.
  const [state, setState]   = useState({ key: null, data: null, error: '' })   // data: { students: [{ id, name, phoneNumber, status, … }], statusCounts }
  const [status, setStatus] = useState('not-allotted')

  useEffect(() => {
    if (!url) return
    let stale = false
    apiFetch(url)
      .then(d => { if (!stale) setState({ key: url, data: d, error: '' }) })
      .catch(err => { if (!stale) setState({ key: url, data: null, error: err.message || 'Could not load chapter status' }) })
    return () => { stale = true }
  }, [url])

  if (!url) return null
  const settled = state.key === url
  const data  = settled ? state.data : null
  const error = settled ? state.error : ''

  const pickedIds = new Set(selected.map(s => String(s.id)))
  const pool = (data?.students || []).filter(s => s.status === status)
  const addable = pool.filter(s => !pickedIds.has(String(s.id)))
  const add = (list) => onChange([...selected, ...list.map(s => ({ id: s.id, name: s.name || '', phoneNumber: s.phoneNumber || '' }))])
  const itemLabel = [cls.subject?.name, cls.chapter?.name, cls.unit?.name].filter(Boolean).join(' · ')
  const chip = PICKER_CHIPS.find(c => c.key === status)

  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <p className="text-xs font-semibold text-gray-700">Add by chapter status</p>
      <p className="text-[11px] text-gray-400 mb-2 truncate" title={itemLabel}>
        Where each student in this paper stands on <span className="text-gray-600">{itemLabel}</span>
      </p>
      {error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : !data ? (
        <p className="text-xs text-gray-400">Checking chapter status…</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 mb-2">
            {PICKER_CHIPS.map(c => (
              <button key={c.key} type="button" onClick={() => setStatus(c.key)} title={c.title}
                className={`text-[10px] font-bold px-2 py-1 rounded-md transition-colors ${
                  status === c.key ? c.on : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                {c.label} ({data.statusCounts?.[c.key] || 0})
              </button>
            ))}
          </div>
          {!pool.length ? (
            <p className="text-xs text-gray-400">Nobody in this paper is "{chip?.label}" for this chapter.</p>
          ) : !addable.length ? (
            <p className="text-xs text-gray-400">All {pool.length} of them are already on the list.</p>
          ) : (
            <>
              <div className="max-h-40 overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-50">
                {addable.map(s => (
                  <button key={s.id} type="button" onClick={() => add([s])}
                    className="w-full text-left px-3 py-1.5 hover:bg-indigo-50 text-sm flex items-center gap-2">
                    <span className="font-medium text-gray-800 truncate">{s.name || '—'}</span>
                    <span className="text-xs text-gray-400 truncate">{s.phoneNumber || s.email}</span>
                    {enrollmentTag(s) && (
                      <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded ml-auto flex-shrink-0">
                        {enrollmentTag(s)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => add(addable)}
                className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                + Add all {addable.length}
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}
