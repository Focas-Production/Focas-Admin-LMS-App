import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { apiFetch, saveWithClashCheck } from '../../api'
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

// FOCAS Hall: announcements, inductions, introductions. Its tracks are separate
// sessions (any host, any times), so they are booked from their own form, not
// the slot board. Session types come from the server's topology.
const isHall = (room) => room?.kind === 'hall'
const sessionTypeLabel = (types, key) => (types || []).find(t => t.key === key)?.label || ''

// Local "YYYY-MM-DD" / "HH:MM" for date/time inputs, and back to a Date.
const pad2 = (n) => String(n).padStart(2, '0')
const toDateInput = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const toTimeInput = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
const fromInputs = (date, time) => (date && time ? new Date(`${date}T${time}`) : null)

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
  const [listHost, setListHost] = useState('all')     // mentor filter over the whole list
  const [listStatus, setListStatus] = useState('all') // 'all' | 'upcoming' | 'ended' | 'cancelled'
  const [filterCounts, setFilterCounts] = useState(null) // { total, hosts[] } from the server, room-scoped
  // Ended/cancelled classes come from the server page by page: the main list is
  // capped at the newest 200, so filtering history from it would drop old classes.
  const [history, setHistory] = useState({ key: '', items: [], total: 0, page: 0, pages: 1, loading: false, error: '' })
  const historySeq = useRef(0)                        // drops replies to superseded filters
  const [classTotal, setClassTotal] = useState(null)  // every class ever, for the tab label (the list itself is capped)
  const [sessionTypes, setSessionTypes] = useState([]) // FOCAS Hall session types, from topology
  const [hallForm, setHallForm] = useState(null)      // "Schedule Hall session" modal state

  // The slot board is for classrooms only; FOCAS Hall gets its own form.
  const classRooms = useMemo(() => (rooms || []).filter(r => !isHall(r)), [rooms])
  const hallRooms  = useMemo(() => (rooms || []).filter(isHall), [rooms])
  const hallKeys   = useMemo(() => new Set(hallRooms.map(r => r.key)), [hallRooms])

  // "All rooms" leads because it is the default — the selected option should be
  // the first thing read, then the ways to narrow it.
  const roomChoices = useMemo(
    () => [{ key: 'all', label: 'All rooms' }, ...(rooms || []).map(r => ({ key: r.key, label: r.label }))],
    [rooms],
  )

  // The list reads in the order an admin actually works it: what is running
  // right now, then what is coming next (soonest first, broken by day), and
  // finished/cancelled classes parked in their own section at the bottom.
  // The server's own order is not relied on — the sort is explicit here.
  // Mentor picker: everyone who has hosted or will host a class in the chosen
  // room, with their counts. A picked mentor with nothing in this room stays
  // listed (at zero) so the selection never silently vanishes.
  const hostChoices = useMemo(() => {
    const list = filterCounts?.hosts || []
    if (listHost === 'all' || list.some(h => String(h.id) === listHost)) return list
    const known = hosts.find(h => String(h.id) === listHost)
    return [...list, { id: listHost, name: known?.name || 'Selected mentor', upcoming: 0, ended: 0, cancelled: 0 }]
  }, [filterCounts, hosts, listHost])

  // Counts on the status chips — for the picked mentor, or everyone.
  const statusCounts = useMemo(() => {
    if (!filterCounts) return null
    if (listHost === 'all') return filterCounts.total
    return hostChoices.find(h => String(h.id) === listHost) || { upcoming: 0, ended: 0, cancelled: 0 }
  }, [filterCounts, hostChoices, listHost])

  const showAhead = listStatus === 'all' || listStatus === 'upcoming'
  const showHistory = listStatus !== 'upcoming'
  // Picking Ended or Cancelled is asking to see them — no fold in the way.
  const historyOpen = listStatus === 'ended' || listStatus === 'cancelled' || pastOpen
  const historyStatus = listStatus === 'ended' || listStatus === 'cancelled' ? listStatus : 'past'
  const historyKey = `${historyStatus}|${listHost}|${listRoom}`
  const filtersActive = listRoom !== 'all' || listHost !== 'all' || listStatus !== 'all'

  const loadHistory = useCallback(async (page) => {
    const seq = ++historySeq.current
    // Same filters → keep the rows on screen while refreshing; new filters → start clean.
    setHistory(h => h.key === historyKey
      ? { ...h, loading: true, error: '' }
      : { key: historyKey, items: [], total: 0, page: 0, pages: 1, loading: true, error: '' })
    const qs = new URLSearchParams({ status: historyStatus, page: String(page), limit: '50' })
    if (listHost !== 'all') qs.set('hostId', listHost)
    if (listRoom !== 'all') qs.set('room', listRoom)
    try {
      const d = await apiFetch(`/api/live-classes/manage/history?${qs}`)
      if (seq !== historySeq.current) return
      setHistory(h => {
        // A refresh of page 1 replaces; "Show more" appends without duplicating
        // a class that shifted pages while the admin was reading.
        const seen = new Set(page === 1 ? [] : h.items.map(c => c._id))
        const items = page === 1 ? d.classes : [...h.items, ...d.classes.filter(c => !seen.has(c._id))]
        return { key: historyKey, items, total: d.total, page: d.page, pages: d.pages, loading: false, error: '' }
      })
    } catch (err) {
      if (seq !== historySeq.current) return
      setHistory(h => ({ ...h, loading: false, error: err.message || 'Could not load past classes' }))
    }
  }, [historyKey, historyStatus, listHost, listRoom])

  const loadFilterCounts = useCallback(async () => {
    try {
      const qs = listRoom !== 'all' ? `?room=${encodeURIComponent(listRoom)}` : ''
      const d = await apiFetch(`/api/live-classes/manage/filter-counts${qs}`)
      setFilterCounts(d)
      if (listRoom === 'all') setClassTotal(d.total.upcoming + d.total.ended + d.total.cancelled)
    } catch {
      setFilterCounts(null)   // chips fall back to no numbers; the list still works
    }
  }, [listRoom])

  // Counts follow the room filter and every change to the classes (cancel, end, edit).
  useEffect(() => {
    if (classes === null) return
    loadFilterCounts()
  }, [classes, loadFilterCounts])

  // History reloads from page 1 whenever its filters change, it is unfolded, or
  // the classes change underneath it — only while it is actually on screen.
  useEffect(() => {
    if (tab !== 'list' || classes === null || !showHistory || !historyOpen) return
    loadHistory(1)
  }, [tab, classes, showHistory, historyOpen, loadHistory])

  const listGroups = useMemo(() => {
    // Room and mentor filters govern EVERY section, not just upcoming — asking
    // for Room 2 and still being shown Room 1's live class would be a lie.
    const all = (classes || []).filter(c =>
      (listRoom === 'all' || c.room?.key === listRoom) &&
      (listHost === 'all' || String(c.host?.userId) === listHost))
    const byStart = (a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart)

    const live = showAhead ? all.filter(c => c.status === 'live').sort(byStart) : []
    const upcoming = showAhead ? all.filter(c => c.status === 'scheduled').sort(byStart) : []
    // History is server-paged, newest first; ignore a reply for older filters.
    const past = history.key === historyKey ? history.items : []

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
  }, [classes, listRoom, listHost, showAhead, history, historyKey])

  // Flattened into section headers + rows so one table keeps every column aligned.
  const listRows = useMemo(() => {
    const { live, upcoming, upcomingDays, past } = listGroups
    const rows = []
    if (showAhead) {
      if (live.length) {
        rows.push({ kind: 'section', key: 'sec-live', label: 'Happening now', count: live.length, tone: 'live' })
        live.forEach(c => rows.push({ kind: 'class', cls: c }))
      }
      // Always rendered, even at zero, so an emptied filter reads as "nothing" rather than broken.
      rows.push({ kind: 'section', key: 'sec-up', label: 'Upcoming', count: upcoming.length })
      upcomingDays.forEach(d => {
        rows.push({ kind: 'day', key: `day-${d.key}`, label: d.label, count: d.items.length })
        d.items.forEach(c => rows.push({ kind: 'class', cls: c }))
      })
      if (!upcoming.length) rows.push({ kind: 'empty', key: 'up-none', text: 'Nothing scheduled ahead' })
    }
    if (showHistory) {
      const label = historyStatus === 'ended' ? 'Ended' : historyStatus === 'cancelled' ? 'Cancelled' : 'Ended & cancelled'
      // Before the first page arrives (or while folded) the count comes from the
      // counts endpoint, so the number is right without loading every row.
      const loaded = history.key === historyKey && history.page > 0
      const count = loaded ? history.total
        : statusCounts ? (historyStatus === 'ended' ? statusCounts.ended
          : historyStatus === 'cancelled' ? statusCounts.cancelled
          : statusCounts.ended + statusCounts.cancelled)
        : null
      rows.push({ kind: 'section', key: 'sec-past', label, count, fold: historyStatus === 'past' })
      if (historyOpen) {
        past.forEach(c => rows.push({ kind: 'class', cls: c }))
        if (history.error && history.key === historyKey) rows.push({ kind: 'history-error', key: 'past-err' })
        else if (history.loading && !past.length) rows.push({ kind: 'note', key: 'past-loading', text: 'Loading…' })
        else if (loaded && !past.length) rows.push({ kind: 'empty', key: 'past-none', text: `No ${label.toLowerCase()} classes` })
        if (loaded && !history.error && history.page < history.pages) rows.push({ kind: 'more', key: 'past-more' })
      }
    }
    return rows
  }, [listGroups, showAhead, showHistory, historyOpen, historyStatus, history, historyKey, statusCounts])

  const hostLabel = listHost === 'all' ? '' : (hostChoices.find(h => String(h.id) === listHost)?.name || 'this mentor')
  const roomLabel = listRoom === 'all' ? '' : (roomChoices.find(r => r.key === listRoom)?.label || 'this room')
  // "Nothing scheduled ahead for Keerthana in Room 2."
  const emptySuffix = `${hostLabel ? ` for ${hostLabel}` : ''}${roomLabel ? ` in ${roomLabel}` : ''}.`
  const clearFilters = () => { setListRoom('all'); setListHost('all'); setListStatus('all') }

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
      setSessionTypes(d.sessionTypes || [])
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
      .then(d => setSubCounts(s => ({ ...s, ...(d.counts || {}) })))
      .catch(() => {})
  }, [classes])

  // …and for history pages, which can reach past the main list's 200 classes.
  useEffect(() => {
    const ids = history.items.map(c => c._id)
    if (!ids.length) return
    apiFetch(`/api/live-classes/manage/submission-counts?ids=${ids.join(',')}`)
      .then(d => setSubCounts(s => ({ ...s, ...(d.counts || {}) })))
      .catch(() => {})
  }, [history.items])

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
      await saveWithClashCheck((extra) => apiFetch(`/api/live-classes/manage/${allot.cls._id}/students`, {
        method: 'PUT',
        body: JSON.stringify({ studentIds: allot.students.map(s => s.id), ...extra }),
      }))
      setAllot(null)
      await load()
    } catch (err) {
      setError(err.message || 'Could not save the student list')
      setAllot(a => ({ ...a, saving: false }))
    }
  }

  // Edit a scheduled class before it starts: who teaches it and what it teaches.
  // A FOCAS Hall session edits its type, recording and times instead (it has no
  // chapter, and no slot board to move it on).
  const openEdit = (cls) => {
    const hall = hallKeys.has(cls.room?.key)
    const start = new Date(cls.scheduledStart), end = new Date(cls.scheduledEnd)
    setEdit({
      cls,
      hall,
      hostUserId: cls.host?.userId ? String(cls.host.userId) : '',
      subjectId:  cls.subject?.subjectId ? String(cls.subject.subjectId) : '',
      chapterId:  cls.chapter?.chapterId ? String(cls.chapter.chapterId) : '',
      unitId:     cls.unit?.unitId ? String(cls.unit.unitId) : '',
      sessionType: cls.sessionType && cls.sessionType !== 'class' ? cls.sessionType : '',
      record: cls.recordingWanted === true,
      date: toDateInput(start), startTime: toTimeInput(start), endTime: toTimeInput(end),
      saving: false, error: '',
    })
  }

  const saveEdit = async () => {
    if (!edit || edit.saving) return
    let body
    if (edit.hall) {
      const start = fromInputs(edit.date, edit.startTime)
      const end   = fromInputs(edit.date, edit.endTime)
      if (!edit.sessionType) return setEdit(e => ({ ...e, error: 'Pick a session type' }))
      if (!start || !end || end <= start) return setEdit(e => ({ ...e, error: 'End time must be after the start time' }))
      body = {
        hostUserId: edit.hostUserId || undefined,
        sessionType: edit.sessionType, record: edit.record,
        // Only sent when moved, so an untouched session that has drifted into
        // the start grace window isn't refused as "in the past".
        ...(start.getTime() !== new Date(edit.cls.scheduledStart).getTime() ? { scheduledStart: start.toISOString() } : {}),
        ...(end.getTime() !== new Date(edit.cls.scheduledEnd).getTime() ? { scheduledEnd: end.toISOString() } : {}),
      }
    } else {
      body = {
        // JSON drops undefined — an empty host means "leave the host alone",
        // while the curriculum ids always travel together as one pick.
        hostUserId: edit.hostUserId || undefined,
        subjectId: edit.subjectId, chapterId: edit.chapterId, unitId: edit.unitId,
      }
    }
    setEdit(e => ({ ...e, saving: true, error: '' }))
    try {
      await saveWithClashCheck((extra) => apiFetch(`/api/live-classes/manage/${edit.cls._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...body, ...extra }),
      }))
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
    // Extra bottom room so the floating switcher never sits on the list's last
    // row ("Show more", the final class's actions) once scrolled to the end.
    <div className="p-6 md:p-8 pb-24 md:pb-24 max-w-screen-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Live Classes</h1>
      <p className="text-gray-500 text-sm mb-6">Set a slot's mentor &amp; chapter, drag students into it, then confirm everything once with Review &amp; save.</p>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {/* Occupancy — what each fixed track is doing right now */}
      {!!rooms.length && (
        <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-3 mb-6">
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

      <CameraRuleSettings />

      {/* Scheduler and the class list live in tabs, so neither buries the other. */}
      <div className="flex flex-wrap gap-1 mb-4">
        {[
          ['board', `📅 Scheduler${stagedCount ? ` · ${stagedCount} staged` : ''}`],
          ['list', `📋 All classes${classTotal != null ? ` (${classTotal})` : ''}`],
        ].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === key ? 'bg-indigo-600 text-white'
              : key === 'board' && stagedCount ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
              : 'bg-white text-gray-500 hover:bg-gray-50 border border-gray-200'}`}>
            {label}
          </button>
        ))}
        {!!hallRooms.length && (
          <button onClick={() => setHallForm(newHallForm(hallRooms))}
            className="ml-auto px-4 py-2 rounded-xl text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700">
            📣 FOCAS Schedule Hall Session
          </button>
        )}
      </div>

      {/* The board is tall — keep a switcher within reach at the bottom too, so
          the admin never has to scroll back up to reach the other view. Draggable:
          wherever it floats, it covers something, so the admin parks it where it
          doesn't get in the way (position remembered per browser). */}
      <DraggableFab
        label={tab === 'board'
          ? `📋 All classes${classTotal != null ? ` (${classTotal})` : ''}`
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
          rooms={classRooms}
          hallRooms={hallRooms}
          hosts={hosts}
          classes={classes || []}
          onChanged={() => Promise.all([load(), loadTopology()])}
          onStagedCount={setStagedCount}
          // Booked/pasted from the board's FOCAS Hall view → stay on the board
          // after saving, so the same copy can be pasted onto the next day.
          onBookHall={(prefill) => setHallForm({ ...newHallForm(hallRooms), ...prefill, fromBoard: true })}
          onEditClass={openEdit}
        />
      </div>

      {/* List */}
      {tab === 'list' && (classes === null ? (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400 text-sm">Loading…</div>
      ) : !classes.length ? (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400 text-sm">No classes scheduled yet.</div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          {/* Filters — mentor, status and room narrow every section below. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b border-gray-100">
            <label className="flex items-center gap-2 text-xs font-semibold text-gray-500">
              Mentor
              <select value={listHost} onChange={e => setListHost(e.target.value)}
                className={`text-sm rounded-lg border px-2.5 py-1.5 bg-white max-w-[16rem] ${
                  listHost !== 'all' ? 'border-indigo-400 text-indigo-700 font-semibold' : 'border-gray-200 text-gray-700'}`}>
                <option value="all">All mentors</option>
                {hostChoices.map(h => (
                  <option key={h.id} value={String(h.id)}>
                    {h.name || 'Unnamed'} ({h.upcoming + h.ended + h.cancelled})
                  </option>
                ))}
              </select>
            </label>

            <span className="inline-flex flex-wrap bg-gray-50 border border-gray-200 rounded-lg p-0.5" role="group" aria-label="Status">
              {[
                ['all', 'All', statusCounts && statusCounts.upcoming + statusCounts.ended + statusCounts.cancelled],
                ['upcoming', 'Upcoming', statusCounts?.upcoming],
                ['ended', 'Ended', statusCounts?.ended],
                ['cancelled', 'Cancelled', statusCounts?.cancelled],
              ].map(([key, label, n]) => (
                <button key={key} type="button" onClick={() => setListStatus(key)} aria-pressed={listStatus === key}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                    listStatus === key ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-indigo-600'}`}>
                  {label}
                  {n != null && (
                    <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      listStatus === key ? 'bg-white/20 text-white'
                      : key === 'cancelled' ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-600'}`}>
                      {n}
                    </span>
                  )}
                </button>
              ))}
            </span>

            {roomChoices.length > 1 && (
              <span className="inline-flex flex-wrap bg-gray-50 border border-gray-200 rounded-lg p-0.5" role="group" aria-label="Room">
                {roomChoices.map(opt => (
                  <button key={opt.key} type="button" onClick={() => setListRoom(opt.key)} aria-pressed={listRoom === opt.key}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                      listRoom === opt.key ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-indigo-600'}`}>
                    {opt.label}
                  </button>
                ))}
              </span>
            )}

            {filtersActive && (
              <button type="button" onClick={clearFilters}
                className="text-xs font-semibold text-gray-400 hover:text-indigo-600 underline underline-offset-2">
                Clear filters
              </button>
            )}
          </div>
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
                          {row.count != null && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600 normal-case tracking-normal">
                              {row.count}
                            </span>
                          )}
                        </button>
                      ) : (
                        <span className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider ${
                          row.tone === 'live' ? 'text-red-600' : 'text-indigo-600'}`}>
                          {row.tone === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
                          {row.label}
                          {row.count != null && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full normal-case tracking-normal ${
                              row.tone === 'live' ? 'bg-red-100 text-red-700' : 'bg-indigo-100 text-indigo-700'}`}>
                              {row.count}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                )
                if (row.kind === 'empty' || row.kind === 'note') return (
                  <tr key={row.key}>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-400">
                      {row.kind === 'empty' ? `${row.text}${emptySuffix}` : row.text}
                    </td>
                  </tr>
                )
                if (row.kind === 'history-error') return (
                  <tr key={row.key}>
                    <td colSpan={7} className="px-4 py-4 text-center text-sm text-red-500">
                      {history.error}{' '}
                      <button type="button" onClick={() => loadHistory(Math.max(1, history.page + 1))}
                        className="font-semibold underline underline-offset-2 hover:text-red-700">Try again</button>
                    </td>
                  </tr>
                )
                if (row.kind === 'more') return (
                  <tr key={row.key}>
                    <td colSpan={7} className="px-4 py-3 text-center">
                      <button type="button" disabled={history.loading} onClick={() => loadHistory(history.page + 1)}
                        className="px-4 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50">
                        {history.loading ? 'Loading…' : `Show more (${history.items.length} of ${history.total})`}
                      </button>
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
                    <p className="font-medium text-gray-900">
                      {c.title}
                      {c.sessionType && c.sessionType !== 'class' && (
                        <span className="ml-2 align-middle text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                          {sessionTypeLabel(sessionTypes, c.sessionType) || c.sessionType}
                        </span>
                      )}
                      {c.sessionType && c.sessionType !== 'class' && c.recordingWanted && (
                        <span className="ml-1 align-middle text-[10px] font-semibold text-gray-400" title="This session will be recorded">⏺ rec</span>
                      )}
                    </p>
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
              <h2 className="text-base font-bold text-gray-900 mb-0.5">{edit.hall ? 'Edit Hall session' : 'Edit class'}</h2>
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

                {edit.hall ? (
                  <HallSessionFields form={edit} set={set} sessionTypes={sessionTypes} />
                ) : (
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
                )}
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

      {hallForm && (
        <HallSessionModal
          form={hallForm}
          setForm={setHallForm}
          hallRooms={hallRooms}
          hosts={hosts}
          sessionTypes={sessionTypes}
          onSaved={async () => {
            const fromBoard = hallForm.fromBoard
            setHallForm(null)
            if (!fromBoard) setTab('list')
            await Promise.all([load(), loadTopology()])
          }}
        />
      )}

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

// ───────────────────── FOCAS Hall ─────────────────────
// A fresh "Schedule Hall session" form: the next half hour, for an hour, on the
// Hall's first track, recording off.
function newHallForm(hallRooms) {
  const start = new Date(Date.now() + 30 * 60000)
  start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0)
  const end = new Date(start.getTime() + 60 * 60000)
  const room = hallRooms[0]
  return {
    title: '', description: '', sessionType: '', record: false, hostUserId: '',
    trackSel: room?.tracks?.[0] ? `${room.key}|${room.tracks[0].key}` : '',
    date: toDateInput(start), startTime: toTimeInput(start), endTime: toTimeInput(end),
    students: [], saving: false, error: '',
  }
}

// Type, times and recording — shared by the create modal and the edit modal.
function HallSessionFields({ form, set, sessionTypes }) {
  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-violet-400'
  return (
    <>
      <div>
        <p className="text-[11px] font-bold text-gray-500 uppercase mb-1">Session type</p>
        <select value={form.sessionType} onChange={e => set({ sessionType: e.target.value })} className={inp}>
          <option value="">Pick a type…</option>
          {sessionTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <p className="text-[11px] font-bold text-gray-500 uppercase mb-1">Date</p>
          <input type="date" value={form.date} onChange={e => set({ date: e.target.value })} className={inp} />
        </div>
        <div>
          <p className="text-[11px] font-bold text-gray-500 uppercase mb-1">Starts</p>
          <input type="time" value={form.startTime} onChange={e => set({ startTime: e.target.value })} className={inp} />
        </div>
        <div>
          <p className="text-[11px] font-bold text-gray-500 uppercase mb-1">Ends</p>
          <input type="time" value={form.endTime} onChange={e => set({ endTime: e.target.value })} className={inp} />
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
        <input type="checkbox" checked={form.record} onChange={e => set({ record: e.target.checked })}
          className="w-4 h-4 mt-0.5 accent-violet-600" />
        <span>
          <span className="font-semibold">Record this session</span>
          <span className="block text-[11px] text-gray-400">
            Saved to Drive like class recordings. Off by default — recorders are shared with classes, so leave it off unless the recording will be needed.
          </span>
        </span>
      </label>
    </>
  )
}

function HallSessionModal({ form, setForm, hallRooms, hosts, sessionTypes, onSaved }) {
  const set = (patch) => setForm(f => f && ({ ...f, ...patch }))
  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-violet-400'

  const save = async () => {
    if (form.saving) return
    const start = fromInputs(form.date, form.startTime)
    const end   = fromInputs(form.date, form.endTime)
    const [roomKey, trackKey] = (form.trackSel || '').split('|')
    const err = !form.title.trim() ? 'Give the session a title'
      : !form.sessionType ? 'Pick a session type'
      : !roomKey || !trackKey ? 'Pick a Hall track'
      : !start || !end || end <= start ? 'End time must be after the start time'
      : ''
    if (err) return set({ error: err })
    set({ saving: true, error: '' })
    try {
      await saveWithClashCheck((extra) => apiFetch('/api/live-classes/manage', {
        method: 'POST',
        body: JSON.stringify({
          ...extra,
          title: form.title.trim(),
          description: form.description.trim(),
          roomKey, trackKey,
          scheduledStart: start.toISOString(),
          scheduledEnd: end.toISOString(),
          hostUserId: form.hostUserId || undefined,
          sessionType: form.sessionType,
          record: form.record,
          studentIds: form.students.map(s => s.id),
        }),
      }))
      await onSaved()
    } catch (e) {
      set({ saving: false, error: e.message || 'Could not schedule the session' })
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={() => !form.saving && setForm(null)}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-bold text-gray-900 mb-0.5">📣 Schedule a FOCAS Hall session</h2>
        <p className="text-xs text-gray-400 mb-4">Announcements, inductions and introductions. Each Hall track is its own session — two hosts can run the two tracks at the same time.</p>

        {form.error && <p className="text-xs text-red-500 mb-3">{form.error}</p>}

        <div className="space-y-3">
          <div>
            <p className="text-[11px] font-bold text-gray-500 uppercase mb-1">Title</p>
            <input value={form.title} onChange={e => set({ title: e.target.value })} maxLength={120}
              placeholder="e.g. Welcome to CA Inter — Jan 2027 batch" className={inp} />
          </div>
          <HallSessionFields form={form} set={set} sessionTypes={sessionTypes} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <p className="text-[11px] font-bold text-gray-500 uppercase mb-1">Track</p>
              <select value={form.trackSel} onChange={e => set({ trackSel: e.target.value })} className={inp}>
                {hallRooms.flatMap(r => r.tracks.map(t => (
                  <option key={`${r.key}|${t.key}`} value={`${r.key}|${t.key}`}>{r.label} · {t.label}</option>
                )))}
              </select>
            </div>
            <div>
              <p className="text-[11px] font-bold text-gray-500 uppercase mb-1">Host</p>
              <select value={form.hostUserId} onChange={e => set({ hostUserId: e.target.value })} className={inp}>
                <option value="">Me</option>
                {hosts.map(h => <option key={h.id} value={String(h.id)}>{h.name} ({h.role})</option>)}
              </select>
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold text-gray-500 uppercase mb-1">Description (optional)</p>
            <textarea value={form.description} onChange={e => set({ description: e.target.value })} rows={2} className={inp} />
          </div>
          <div>
            <p className="text-[11px] font-bold text-gray-500 uppercase mb-1">Who can join</p>
            <StudentPicker selected={form.students} onChange={(students) => set({ students })} />
            <p className="text-[11px] text-gray-400 mt-1">
              {form.students.length
                ? `Only these ${form.students.length} student${form.students.length > 1 ? 's' : ''} can see and join.`
                : 'Empty list — every logged-in student can see and join.'}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={() => setForm(null)} disabled={form.saving}
            className="px-4 py-2 rounded-xl border border-gray-200 text-gray-500 text-sm font-semibold hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={save} disabled={form.saving}
            className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:bg-gray-300">
            {form.saving ? 'Scheduling…' : 'Schedule session'}
          </button>
        </div>
      </div>
    </div>
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


// ───────────────────── "camera must be on" defaults ─────────────────────
// The rule: while a mentor has it switched ON inside their class, a student
// whose camera is off gets a countdown and is then removed from the room. The
// numbers here are the DEFAULTS every class picks up the moment its host
// switches the rule on — editing them never changes a class already running,
// and the on/off switch inside the meeting always belongs to the mentor.
// Server: utils/cameraRule.js + services/cameraRuleService.js.
function CameraRuleSettings() {
  const [open, setOpen] = useState(false)
  const [defaultEnabled, setDefaultEnabled] = useState(false)
  const [minutes, setMinutes] = useState('2')
  const [strikes, setStrikes] = useState('3')
  const [orig, setOrig] = useState(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const apply = (s) => {
    const c = s?.liveClassCamera || {}
    const next = {
      defaultEnabled: !!c.defaultEnabled,
      minutes: String(Math.round(((c.graceSeconds ?? 120) / 60) * 100) / 100),
      strikes: String(c.maxStrikes ?? 3),
    }
    setDefaultEnabled(next.defaultEnabled); setMinutes(next.minutes); setStrikes(next.strikes)
    setOrig(next)
  }
  useEffect(() => { apiFetch('/api/admin/settings').then(apply).catch(() => {}) }, [])

  const mins = Number(minutes)
  const seconds = Math.round(mins * 60)
  const minutesValid = Number.isFinite(mins) && seconds >= 15 && seconds <= 1800
  const strikesValid = /^\d+$/.test(strikes) && Number(strikes) >= 0 && Number(strikes) <= 10
  const dirty = !!orig && (defaultEnabled !== orig.defaultEnabled || minutes !== orig.minutes || strikes !== orig.strikes)

  const save = async () => {
    if (!minutesValid || !strikesValid) return
    setSaving(true); setMsg('')
    try {
      const s = await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ liveClassCamera: { defaultEnabled, graceSeconds: seconds, maxStrikes: Number(strikes) } }),
      })
      apply(s)
      setMsg('Saved')
    } catch (e) { setMsg(e.message || 'Could not save') } finally { setSaving(false) }
  }

  const inp = 'w-24 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400'

  return (
    <section className="bg-white rounded-2xl shadow-sm mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-5 py-3 text-left">
        <span className="font-bold text-gray-900 text-sm">📷 Camera rule for live classes</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
          defaultEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
          {defaultEnabled ? 'ON by default' : 'OFF by default'}
        </span>
        <span className="text-xs text-gray-400">
          {minutesValid ? `${fmtGrace(seconds)} to turn the camera on` : ''}
        </span>
        <span className="ml-auto text-gray-400 text-sm">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="px-5 pb-5">
          <p className="text-xs text-gray-400 mb-4">
            When a mentor switches this on inside a class, every student whose camera is off gets the countdown below to
            turn it on — then they are <strong>removed from the room</strong>. These are only the defaults each class starts
            from: the on/off switch during the class is the <strong>mentor&rsquo;s</strong>, in their Participants panel, and so is
            excusing a student who genuinely can&rsquo;t be on video. Changing anything here leaves classes already running
            exactly as they are.
          </p>

          <label className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700 cursor-pointer mb-4">
            <input type="checkbox" checked={defaultEnabled} onChange={e => setDefaultEnabled(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
            Start every class with the rule ON
            <span className="text-xs font-normal text-gray-400">(mentors can still switch it off)</span>
          </label>

          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Time to turn the camera on (minutes)</label>
              <input type="number" min="0.25" max="30" step="0.25" value={minutes} onChange={e => setMinutes(e.target.value)} className={inp} />
              {!minutesValid && <p className="text-[10px] text-red-500 mt-1">15 seconds to 30 minutes</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Removals before the mentor must let them back in</label>
              <input type="number" min="0" max="10" value={strikes} onChange={e => setStrikes(e.target.value)} className={inp} />
              {!strikesValid
                ? <p className="text-[10px] text-red-500 mt-1">0 to 10</p>
                : <p className="text-[10px] text-gray-400 mt-1">{Number(strikes) === 0 ? 'Always free to rejoin' : 'Then they need the mentor to re-admit them'}</p>}
            </div>
            <button onClick={save} disabled={!dirty || saving || !minutesValid || !strikesValid}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:bg-gray-300">
              {saving ? 'Saving…' : 'Save camera rule'}
            </button>
            {dirty && <span className="text-xs text-amber-600 pb-3">Unsaved changes</span>}
            {msg && <span className="text-xs text-gray-500 pb-3">{msg}</span>}
          </div>
        </div>
      )}
    </section>
  )
}

function fmtGrace(seconds) {
  const s = Number(seconds) || 0
  if (s % 60 === 0) return `${s / 60} minute${s === 60 ? '' : 's'}`
  return `${s} seconds`
}
