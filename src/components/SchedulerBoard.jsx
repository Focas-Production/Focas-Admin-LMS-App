import { useState, useEffect, useMemo } from 'react'
import { apiFetch } from '../api'
import {
  FIELD_DEFS, fieldDef, opsFor, newCondition, conditionComplete, conditionReady,
  evalCondition, chapterConditionKey, studiesSubject,
  normalizeCondition, subjectIdsOf, SLOT_OPTIONS, DAY_TYPES,
  availabilityLabel, hasSlotAvailability, isAvailableFor,
} from '../lib/rosterFilter'
import SlotEditorModal from './SlotEditorModal'

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
// The four slots are fixed school periods, not free-form times. Names mirror
// SLOT_OPTIONS in lib/rosterFilter.js — the name is the time range, and it is
// what the default class title ends with ("… — 6–9 AM Slot").
const SLOTS = [
  { key: 'm1', icon: '🌅', name: '6–9 AM Slot',     startHour: 6,  endHour: 9  },
  { key: 'm2', icon: '☀️', name: '10 AM–1 PM Slot', startHour: 10, endHour: 13 },
  { key: 'af', icon: '🌤️', name: '2–5 PM Slot',     startHour: 14, endHour: 17 },
  { key: 'ev', icon: '🌙', name: '7–10 PM Slot',    startHour: 19, endHour: 22 },
]

const fmtHour = (h) => {
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}:00 ${ampm}`
}

const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

// Two-letter initials for the mentor badge ("Pavaharini" → "PA", "Hari Prasath" → "HP").
const initials = (name = '') => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase()
}

// What a cell wears once it knows its class — saved, or still being set up:
//   SUBJECT                                          (small caps, dark)
//   Chapter · Unit                                   (the headline)
//   [PA] Mentor · Room 1 · Track 1 — 6–9 AM Slot     (coords in small print — admins
//                                                     need them, students never see them)
// Module-level so React keeps the same element type across board re-renders.
function CellHead({ subject, chapter, unit, mentor, slotTitle, live, roster }) {
  return (
    <div className="mb-2">
      {/* Subject + live pill. Right padding keeps clear of the copy/paste buttons. */}
      <div className="flex items-center gap-1.5 min-w-0 pr-12">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-indigo-600 truncate min-w-0"
          title={subject || ''}>
          {subject || 'No subject'}
        </span>
        {live && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-red-600 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />live
          </span>
        )}
      </div>
      <p className="mt-0.5 pr-12 text-[13px] font-semibold text-gray-900 leading-snug break-words"
        title={[chapter, unit].filter(Boolean).join(' · ')}>
        {chapter || 'No chapter'}
        {unit ? <span className="text-gray-500 font-medium"> · {unit}</span> : null}
      </p>
      {/* One line carries all three: mentor left, the head-count centred between
          them, room/track/slot coords right. The count rides here rather than on
          a line of its own so a booked cell stays three lines tall. */}
      <div className="mt-1.5 flex items-center gap-1.5 min-w-0">
        <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-indigo-600 text-white text-[8px] font-bold tracking-wide shrink-0 ring-2 ring-indigo-100">
          {initials(mentor)}
        </span>
        {/* Name and coords each take an equal share and truncate, so the count
            sits centred between them and nothing overlaps in the narrow
            both-rooms columns. Full text of either is on hover. */}
        <span className="flex-1 min-w-0 truncate text-[11px] font-semibold text-gray-800" title={mentor || ''}>
          {mentor || '…'}
        </span>
        {roster}
        {slotTitle && (
          <span className="flex-1 min-w-0 flex justify-end">
            <span className="truncate rounded-md bg-gray-100 border border-gray-200 px-1.5 py-0.5 text-[9.5px] font-medium text-gray-500"
              title={slotTitle}>
              {slotTitle}
            </span>
          </span>
        )}
      </div>
    </div>
  )
}

// studiesSubject (enrollment ↔ paper scoping) lives in lib/rosterFilter.js now,
// shared with the advanced filter engine so the two can't drift.

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

// The roster's chapter-status chips. The four rungs are the same ladder the
// Progress pages badge each student's chapters on (not-allotted → allotted →
// attended → done); Pending is everyone short of done, the chip the board
// always had. Same verdicts as the Progress pages, from the same endpoint.
const ROSTER_STATUS_CHIPS = [
  { key: 'all',          label: 'All',          on: 'bg-gray-800 text-white',    title: 'Everyone studying this paper' },
  { key: 'pending',      label: 'Pending',      on: 'bg-amber-500 text-white',   title: 'Everyone who has not completed this chapter/unit' },
  { key: 'not-allotted', label: 'Not allotted', on: 'bg-gray-500 text-white',    title: 'No class for this chapter/unit is assigned to them yet' },
  { key: 'allotted',     label: 'Allotted',     on: 'bg-indigo-500 text-white',  title: 'A class is assigned, or was held and missed — not attended yet' },
  { key: 'attended',     label: 'Attended',     on: 'bg-sky-600 text-white',     title: 'Attended at least one class for it; not completed yet' },
  { key: 'done',         label: '✓ Done',       on: 'bg-emerald-600 text-white', title: 'Completed this chapter/unit' },
]
const ROSTER_BADGE = {
  done:           ['✓ Done',       'text-emerald-600 bg-emerald-50'],
  attended:       ['Attended',     'text-sky-700 bg-sky-50'],
  allotted:       ['Allotted',     'text-indigo-600 bg-indigo-50'],
  'not-allotted': ['Not allotted', 'text-gray-500 bg-gray-100'],
}

export default function SchedulerBoard({ rooms, hosts, classes, onChanged, onStagedCount }) {
  const [students, setStudents] = useState(null)   // full roster for the left panel
  const [search, setSearch]     = useState('')
  const [enrolFilter, setEnrolFilter] = useState('all')   // see ENROLMENT_CHIPS
  const [subjFilter,  setSubjFilter]  = useState('')      // subject id, '' = any
  const [chapFilter,  setChapFilter]  = useState('')      // chapter id, '' = any (needs a subject)
  const [unitFilter,  setUnitFilter]  = useState('')      // unit id, '' = whole chapter
  const [statusFilter, setStatusFilter] = useState('all') // a ROSTER_STATUS_CHIPS key, for the picked chapter
  const [completion, setCompletion]   = useState(null)    // { key, done, attended, allotted: Set } — the picked item's rungs
  const [completionError, setCompletionError] = useState('')

  // ── Zoho-style advanced filters ──
  const [advOpen, setAdvOpen]           = useState(false)  // the drawer
  const [advConditions, setAdvConditions] = useState([])   // condition rows, ANDed (lib/rosterFilter)
  const [chapterSets, setChapterSets]   = useState({})     // condition key → { done, attended, allotted: Set(userIds) } | 'error'
  const [views, setViews]               = useState(null)   // saved filter views (server, shared)
  const [activeViewId, setActiveViewId] = useState('')
  const [slotEditor, setSlotEditor]     = useState(null)   // student whose slot times are being edited
  const [collapsed, setCollapsed] = useState({})   // dayKey → true when folded away
  const [weekCount, setWeekCount] = useState(1)    // 7-day blocks on the board; "+ Add 7 more days" grows it
  const [weekOpen, setWeekOpen]   = useState({})   // extra-week index → false when its dropdown is folded
  const [dragId, setDragId]     = useState(null)   // student id being dragged
  const [overCell, setOverCell] = useState(null)   // cell id under the drag
  const [openCells, setOpenCells] = useState({})   // cellId → true when its saved roster is expanded
  const [staged, setStaged]     = useState({})     // cellId → { day, slot, col, ids: [] }
  const [review, setReview]     = useState(false)  // review-and-save modal open
  const [clipboard, setClipboard] = useState(null) // { ids: [], from: label } — copied roster
  const [newMeta, setNewMeta]   = useState({})     // cellId → { title, hostUserId, subjectId, chapterId, unitId, day, slot, col }
  const [setup, setSetup]       = useState(null)   // cell being configured: { cellId, day, slot, col, hostUserId, subjectId, chapterId, unitId }
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [notice, setNotice]     = useState(null)   // { text, undo } — double-booking toast, auto-dismissed

  const [subjects, setSubjects] = useState([])   // subject → chapters → units tree

  // One room's tracks show at a time so the cells stay big; the admin switches
  // rooms (or expands to all of them) with the segmented control above the grid.
  // Holds a room key, or 'all' for the full x-axis.
  const [roomView, setRoomView] = useState(null)   // null until rooms arrive → first room

  useEffect(() => {
    apiFetch('/api/admin/users?limit=2000')
      .then(d => setStudents((d.users || []).filter(u => !u.isAdmin && !u.isMentor)))
      .catch(() => setStudents([]))
    apiFetch('/api/admin/subjects')
      .then(d => setSubjects((d.subjects || []).filter(s => s.isActive)))
      .catch(() => setSubjects([]))
    apiFetch('/api/admin/filter-views?scope=scheduler-roster')
      .then(d => setViews(d.views || []))
      .catch(() => setViews([]))
  }, [])

  // id → student, for rendering chips from ids.
  const byId = useMemo(
    () => new Map((students || []).map(s => [String(s._id), s])),
    [students],
  )

  const days = useMemo(() => {
    const out = []
    const now = new Date()
    for (let i = 0; i < weekCount * 7; i++) {
      out.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i))
    }
    return out
  }, [weekCount])

  // The horizon split into 7-day blocks: block 0 is the next 7 days (always
  // bare, as before); every block after it renders as a collapsible week card.
  const weekChunks = useMemo(() => {
    const out = []
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7))
    return out
  }, [days])

  // All four tracks in display order, with their parent room label.
  const trackCols = useMemo(() =>
    (rooms || []).flatMap(r => r.tracks.map(t => ({
      roomKey: r.key, roomLabel: r.label,
      trackKey: t.key, trackLabel: t.label,
      roomName: t.roomName,
    }))), [rooms])

  // The columns actually rendered — a single room's tracks, or everything.
  const activeRoom = roomView || (rooms || [])[0]?.key || 'all'
  const visibleCols = useMemo(() => {
    if (activeRoom === 'all') return trackCols
    const cols = trackCols.filter(c => c.roomKey === activeRoom)
    return cols.length ? cols : trackCols
  }, [trackCols, activeRoom])

  const active = useMemo(
    () => (classes || []).filter(c => c.status === 'scheduled' || c.status === 'live'),
    [classes],
  )

  // Which track a class sits on. Keyed by the room/track KEYS, never the LiveKit
  // room name: that name carries LIVEKIT_ROOM_PREFIX as it was when the class was
  // booked, so a class booked by one environment and read by another (prod DB,
  // dev prefix) would read as an empty slot and invite a double booking. Same
  // rule the server uses in listLiveHostableTracks. Older classes saved before
  // the keys existed fall back to the room name.
  const trackKeyOf = (c) =>
    (c?.room?.key && c?.track?.key) ? `${c.room.key}/${c.track.key}` : c?.roomName
  const colKey = (col) => `${col.roomKey}/${col.trackKey}`

  // The class occupying one (day, slot, track) cell, if any.
  const cellClass = (day, slot, col) => {
    const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.startHour)
    const e = new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.endHour)
    const want = colKey(col)
    return active.find(c =>
      (trackKeyOf(c) === want || c.roomName === col.roomName) &&
      new Date(c.scheduledStart) < e && new Date(c.scheduledEnd) > s,
    ) || null
  }

  // Roster filters, ANDed and drilling down: free-text, how they're enrolled,
  // which paper they study, then which chapter/unit of it they've completed or
  // still owe — so "G1 students who haven't finished Accounting chapter 2" is a
  // few clicks before a drag.
  const pickedSubject = useMemo(
    () => (subjects || []).find(s => String(s._id) === subjFilter) || null,
    [subjects, subjFilter],
  )
  const pickedChapter = useMemo(
    () => (pickedSubject?.chapters || []).find(c => String(c._id) === chapFilter) || null,
    [pickedSubject, chapFilter],
  )

  // Where every student stands on the picked chapter/unit — the same ladder the
  // Progress pages show (completed: manual override wins, else taught-to-them +
  // attended enough; attended: present in a session; allotted: on a class
  // roster). The stale flag stops an older, slower response from landing after
  // a newer one and lying about the current selection.
  const completionKey = `${subjFilter}|${chapFilter}|${unitFilter}`
  useEffect(() => {
    if (!subjFilter || !chapFilter) { setCompletion(null); setCompletionError(''); return }
    let stale = false
    setCompletionError('')
    const key = `${subjFilter}|${chapFilter}|${unitFilter}`
    apiFetch(`/api/admin/syllabus-completion?subjectId=${subjFilter}&chapterId=${chapFilter}${unitFilter ? `&unitId=${unitFilter}` : ''}`)
      .then(d => {
        if (stale) return
        setCompletion({
          key,
          done:     new Set(d.completedIds || []),
          attended: new Set(d.attendedIds || []),
          allotted: new Set(d.allottedIds || []),
        })
      })
      .catch(err => { if (!stale) { setCompletion(null); setCompletionError(err.message || 'Could not check completion') } })
    return () => { stale = true }
  }, [subjFilter, chapFilter, unitFilter])
  const completionReady = !!completion && completion.key === completionKey

  // Advanced chapter-status conditions each need their own buckets (who has
  // completed / attended / been allotted the item). Fetched once per distinct
  // (subject, chapter, unit) and kept for the board's lifetime; 'error' marks a
  // failed fetch so the condition passes everyone rather than silently hiding
  // students.
  useEffect(() => {
    const need = [...new Set(
      advConditions
        .filter(c => c.field === 'chapter' && c.value?.subjectId && c.value?.chapterId)
        .map(chapterConditionKey),
    )].filter(k => !(k in chapterSets))
    if (!need.length) return
    let stale = false
    for (const key of need) {
      const [sub, ch, un] = key.split('|')
      apiFetch(`/api/admin/syllabus-completion?subjectId=${sub}&chapterId=${ch}${un ? `&unitId=${un}` : ''}`)
        .then(d => {
          if (stale) return
          setChapterSets(prev => ({
            ...prev,
            [key]: {
              done:     new Set(d.completedIds || []),
              attended: new Set(d.attendedIds || []),
              allotted: new Set(d.allottedIds || []),
            },
          }))
        })
        .catch(() => { if (!stale) setChapterSets(prev => ({ ...prev, [key]: 'error' })) })
    }
    return () => { stale = true }
  }, [advConditions, chapterSets])

  const subjectsById = useMemo(
    () => new Map((subjects || []).map(s => [String(s._id), s])),
    [subjects],
  )
  const filterCtx = { subjectsById, chapterSets }
  const activeConditions = advConditions.filter(conditionComplete)
  const advChecking = activeConditions.some(c =>
    !conditionReady(c, filterCtx) && chapterSets[chapterConditionKey(c)] !== 'error')
  const advCheckFailed = activeConditions.some(c =>
    c.field === 'chapter' && chapterSets[chapterConditionKey(c)] === 'error')

  // Enrollment + paper + advanced conditions narrow the pool; search and the
  // status chips slice it. Chip counts come from the pool so typing a search
  // doesn't change them.
  const scoped = (students || []).filter(s => {
    if (enrolFilter === 'subjects' && !(s.caSubjects || []).length) return false
    if (enrolFilter === 'unset' && (s.caLevel || (s.caSubjects || []).length)) return false
    if (['group1', 'group2', 'both'].includes(enrolFilter) && s.caGroup !== enrolFilter) return false
    if (pickedSubject && !studiesSubject(s, pickedSubject)) return false
    if (!advConditions.every(c => evalCondition(s, c, filterCtx))) return false
    return true
  })
  // One student's rung on the picked item, from the exclusive buckets the
  // server sends; anyone in none of them has no class for it yet.
  const rosterStatus = (s) => {
    const id = String(s._id)
    return completion.done.has(id) ? 'done'
      : completion.attended.has(id) ? 'attended'
      : completion.allotted.has(id) ? 'allotted'
      : 'not-allotted'
  }
  const statusCounts = completionReady
    ? scoped.reduce((c, s) => { const k = rosterStatus(s); c[k] = (c[k] || 0) + 1; return c }, { all: scoped.length })
    : null
  if (statusCounts) statusCounts.pending = scoped.length - (statusCounts.done || 0)

  const filtered = scoped.filter(s => {
    const q = search.trim().toLowerCase()
    if (q && !((s.name || '').toLowerCase().includes(q) || (s.phoneNumber || '').includes(q))) return false
    // Until the verdicts arrive the status chips don't hide anyone — better a
    // beat of "everyone" than a flash of an empty roster.
    if (chapFilter && statusFilter !== 'all' && completionReady) {
      const st = rosterStatus(s)
      if (statusFilter === 'pending' ? st === 'done' : st !== statusFilter) return false
    }
    return true
  })

  // ── saved views (server-stored, shared by every admin) ──
  // A view captures the WHOLE filter state: the quick controls above plus the
  // advanced condition rows, so "G1 evening-slot, chapter 2 pending" is one click.
  const currentFilters = () => ({
    quick: { enrolFilter, subjFilter, chapFilter, unitFilter, statusFilter },
    conditions: advConditions,
  })
  const applyView = (v) => {
    const q = v.filters?.quick || {}
    setEnrolFilter(q.enrolFilter || 'all')
    setSubjFilter(q.subjFilter || '')
    setChapFilter(q.chapFilter || '')
    setUnitFilter(q.unitFilter || '')
    setStatusFilter(q.statusFilter || 'all')
    setAdvConditions(Array.isArray(v.filters?.conditions) ? v.filters.conditions.map(normalizeCondition) : [])
    setActiveViewId(String(v._id))
  }
  const clearAllFilters = () => {
    setEnrolFilter('all'); setSubjFilter(''); setChapFilter(''); setUnitFilter('')
    setStatusFilter('all'); setAdvConditions([]); setActiveViewId('')
  }

  const stagedCount = Object.values(staged).reduce((n, c) => n + c.ids.length, 0)

  // Let the page show "N staged" on its tab bar while the board is hidden.
  useEffect(() => { onStagedCount?.(stagedCount) }, [stagedCount, onStagedCount])

  // ── per-cell class setup ──
  // An empty cell is configured FIRST (mentor + subject/chapter, unit optional);
  // the cell then wears that setup so the admin knows exactly what they're
  // dragging students into. Stored in newMeta, same place Review & save reads.

  const cellMetaReady = (cellId) => {
    const m = newMeta[cellId]
    return !!(m?.hostUserId && m?.subjectId && m?.chapterId)
  }

  const hostName = (id) =>
    (hosts || []).find(h => String(h.id) === String(id))?.name || '…'

  const openSetup = (day, slot, col) => {
    const cellId = `${dayKey(day)}/${slot.key}/${col.roomName}`
    const m = newMeta[cellId] || {}
    setSetup({
      cellId, day, slot, col,
      hostUserId: m.hostUserId || '',
      subjectId: m.subjectId || '', chapterId: m.chapterId || '', unitId: m.unitId || '',
    })
  }

  const saveSetup = () => {
    if (!setup) return
    const locked = roomLockedHost(setup.cellId, setup)
    const hostUserId = locked ? locked.id : setup.hostUserId
    if (!hostUserId || !setup.subjectId || !setup.chapterId) return
    const { cellId, day, slot, col, subjectId, chapterId, unitId } = setup
    setNewMeta(m => ({ ...m, [cellId]: {
      ...(m[cellId] || {}),
      title: m[cellId]?.title || `${col.roomLabel} · ${col.trackLabel} — ${slot.name}`,
      hostUserId, subjectId, chapterId, unitId,
      day, slot, col,   // coords let sibling cells see this pick for mentor locking
    } }))
    setSetup(null)
  }

  const clearSetup = () => {
    if (!setup) return
    setNewMeta(m => { const next = { ...m }; delete next[setup.cellId]; return next })
    setSetup(null)
  }

  // ── double-booking inside a room ──
  // A student can sit in only ONE track of a room per slot — both tracks run
  // in the same space with the same mentor at the same time, so putting the
  // same student in Track 1 and Track 2 books them twice. The drop still
  // lands (the admin may be mid-move), but it is flagged at once: a toast with
  // Undo, a red chip in the grid, and a banner in Review & save.

  // The sibling tracks (same room, other track, same day/slot) where this
  // student is already on the saved class or staged.
  const roomClashesFor = (day, slot, col, id) => {
    const sid = String(id)
    const out = []
    for (const sib of trackCols) {
      if (sib.roomKey !== col.roomKey || sib.roomName === col.roomName) continue
      const cls = cellClass(day, slot, sib)
      const saved = !!cls && (cls.allowedStudents || []).map(String).includes(sid)
      const parked = (staged[`${dayKey(day)}/${slot.key}/${sib.roomName}`]?.ids || []).includes(sid)
      if (saved || parked) out.push({ trackLabel: sib.trackLabel, saved })
    }
    return out
  }

  // Every staged (cell, student) pair that clashes with a sibling track.
  // `byChip` ("cellId|studentId" → sibling tracks) marks the chips; `groups`
  // folds a clash down to one line per (day, slot, room, student) for the
  // banners, since every clash touches at least two cells.
  const clashes = (() => {
    const byChip = new Map()
    const groups = new Map()
    const trackOrder = (label) => trackCols.findIndex(c => c.trackLabel === label)
    for (const [cellId, cell] of Object.entries(staged)) {
      for (const id of cell.ids) {
        const others = roomClashesFor(cell.day, cell.slot, cell.col, id)
        if (!others.length) continue
        byChip.set(`${cellId}|${id}`, others)
        const gk = `${dayKey(cell.day)}/${cell.slot.key}/${cell.col.roomKey}|${id}`
        const g = groups.get(gk) || { day: cell.day, slot: cell.slot, roomLabel: cell.col.roomLabel, id, tracks: new Set() }
        g.tracks.add(cell.col.trackLabel)
        for (const o of others) g.tracks.add(o.trackLabel)
        groups.set(gk, g)
      }
    }
    return {
      byChip,
      groups: [...groups.values()].map(g => ({
        ...g, tracks: [...g.tracks].sort((a, b) => trackOrder(a) - trackOrder(b)),
      })),
    }
  })()

  // The toast fired at the drop/paste that caused a clash: who, which sibling
  // track, and a one-click Undo that lifts them back out of THIS cell.
  const warnRoomClashes = (day, slot, col, ids) => {
    const hits = ids
      .map(id => ({ id, others: roomClashesFor(day, slot, col, id) }))
      .filter(h => h.others.length)
    if (!hits.length) return
    const cellId = `${dayKey(day)}/${slot.key}/${col.roomName}`
    const tracks = [...new Set(hits.flatMap(h => h.others.map(o => o.trackLabel)))].join(' & ')
    setNotice({
      text: `${hits.map(h => chipName(h.id)).join(', ')} ${hits.length > 1 ? 'are' : 'is'} already in ${col.roomLabel} · ${tracks} for ${whenLabel(day, slot)} — a student can attend only one track of a room.`,
      undo: () => hits.forEach(h => unstage(cellId, h.id)),
    })
  }

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 9000)
    return () => clearTimeout(t)
  }, [notice])

  // ── staging ──

  const stageDrop = (day, slot, col, studentId) => {
    setOverCell(null); setDragId(null)
    const id = String(studentId)
    if (!byId.get(id)) return
    const cellId = `${dayKey(day)}/${slot.key}/${col.roomName}`
    const existing = cellClass(day, slot, col)
    // Already allotted on the saved class, or already staged → nothing to do.
    if (existing && (existing.allowedStudents || []).map(String).includes(id)) return
    const alreadyStaged = (staged[cellId]?.ids || []).includes(id)
    setStaged(prev => {
      const cell = prev[cellId] || { day, slot, col, ids: [] }
      if (cell.ids.includes(id)) return prev
      return { ...prev, [cellId]: { ...cell, ids: [...cell.ids, id] } }
    })
    // A fresh drop into a second track of this room → say so right away.
    if (!alreadyStaged) warnRoomClashes(day, slot, col, [id])
    // Dropped into a cell that hasn't been set up yet → ask for mentor and
    // chapter right away instead of waiting for Review & save to complain.
    if (!existing && !cellMetaReady(cellId)) openSetup(day, slot, col)
  }

  // ── copy & paste a slot's roster ──
  // Copy grabs everyone in a cell (saved class students + staged chips) AND the
  // cell's mentor + subject, whether from the saved class or a staged config.
  // The chapter is deliberately NOT copied — every slot teaches its own — so a
  // paste into an empty cell opens the setup form pre-seeded with the mentor
  // and subject, asking only for the chapter. Nothing is booked until
  // Review & save, same as a drag.

  const copyCell = (day, slot, col) => {
    const cellId = `${dayKey(day)}/${slot.key}/${col.roomName}`
    const existing = cellClass(day, slot, col)
    const ids = [...new Set([
      ...(existing?.allowedStudents || []).map(String),
      ...(staged[cellId]?.ids || []),
    ])].filter(id => byId.get(id))
    const src = existing
      ? { hostUserId: existing.host?.userId, subjectId: existing.subject?.subjectId }
      : newMeta[cellId] || {}
    const meta = (src.hostUserId && src.subjectId)
      ? { hostUserId: String(src.hostUserId), subjectId: String(src.subjectId) }
      : null
    if (!ids.length && !meta) return
    setClipboard({ ids, meta, from: `${col.roomLabel} ${col.trackLabel} · ${slot.name}` })
  }

  const pasteCell = (day, slot, col) => {
    if (!clipboard?.ids?.length && !clipboard?.meta) return
    const cellId = `${dayKey(day)}/${slot.key}/${col.roomName}`
    const existing = cellClass(day, slot, col)
    const already = new Set((existing?.allowedStudents || []).map(String))
    if (clipboard.ids?.length) {
      const cur = staged[cellId]?.ids || []
      const toAdd = clipboard.ids.filter(id => !already.has(id) && !cur.includes(id))
      if (toAdd.length) {
        setStaged(prev => {
          const cell = prev[cellId] || { day, slot, col, ids: [] }
          const merged = [...cell.ids]
          for (const id of toAdd) if (!merged.includes(id)) merged.push(id)
          return { ...prev, [cellId]: { ...cell, ids: merged } }
        })
        warnRoomClashes(day, slot, col, toAdd)
      }
    }
    if (existing || cellMetaReady(cellId)) return
    if (clipboard.meta) {
      // Setup form, pre-seeded with the copied mentor + subject; the chapter is
      // blank on purpose — the admin picks what THIS slot teaches. The form's
      // own room-mentor lock still applies over the copied mentor.
      setSetup({
        cellId, day, slot, col,
        hostUserId: clipboard.meta.hostUserId,
        subjectId: clipboard.meta.subjectId,
        chapterId: '', unitId: '',
      })
    } else {
      openSetup(day, slot, col)
    }
  }

  // "3 students + mentor & subject" / "3 students" — for the pill and buttons.
  const clipLabel = (clip) => [
    clip.ids.length ? `${clip.ids.length} student${clip.ids.length > 1 ? 's' : ''}` : '',
    clip.meta ? 'mentor & subject' : '',
  ].filter(Boolean).join(' + ')

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

  // One mentor per room per slot: a room is a single physical space, so both of
  // its tracks must be run by the same person at the same time. A cell's mentor
  // is locked when the sibling track already has a saved class in this slot, or
  // when an earlier staged cell in the same room/slot picked a mentor first.
  const roomLockedHost = (cellId, cell) => {
    const siblings = trackCols.filter(c =>
      c.roomKey === cell.col.roomKey && c.roomName !== cell.col.roomName)
    for (const sib of siblings) {
      const cls = cellClass(cell.day, cell.slot, sib)
      if (cls?.host?.userId) {
        return { id: String(cls.host.userId), name: cls.host.name || 'assigned mentor', from: `${sib.trackLabel} · ${cls.title}` }
      }
    }
    for (const [otherId, other] of Object.entries(staged)) {
      if (otherId === cellId) break   // only cells listed before this one lock it
      if (dayKey(other.day) !== dayKey(cell.day) || other.slot.key !== cell.slot.key) continue
      if (other.col.roomKey !== cell.col.roomKey || other.col.roomName === cell.col.roomName) continue
      if (cellClass(other.day, other.slot, other.col)) continue   // saved class → caught above
      const h = newMeta[otherId]?.hostUserId
      if (h) {
        const host = (hosts || []).find(x => String(x.id) === String(h))
        return { id: String(h), name: host?.name || 'same mentor', from: other.col.trackLabel }
      }
    }
    // Cells configured through the setup form but with no students staged yet
    // also lock the room — the pick is just as real, it only lacks drops so far.
    for (const [otherId, other] of Object.entries(newMeta)) {
      if (otherId === cellId || !other?.col || !other?.hostUserId) continue
      if (dayKey(other.day) !== dayKey(cell.day) || other.slot.key !== cell.slot.key) continue
      if (other.col.roomKey !== cell.col.roomKey || other.col.roomName === cell.col.roomName) continue
      if (cellClass(other.day, other.slot, other.col)) continue   // saved class → caught above
      const host = (hosts || []).find(x => String(x.id) === String(other.hostUserId))
      return { id: String(other.hostUserId), name: host?.name || 'same mentor', from: other.col.trackLabel }
    }
    return null
  }

  const openReview = () => {
    // Prefill title + host for every cell that will become a NEW class.
    const meta = {}
    for (const [cellId, cell] of Object.entries(staged)) {
      if (!cellClass(cell.day, cell.slot, cell.col)) {
        const locked = roomLockedHost(cellId, cell)
        meta[cellId] = newMeta[cellId] || {
          title: `${cell.col.roomLabel} · ${cell.col.trackLabel} — ${cell.slot.name}`,
          hostUserId: locked ? locked.id : (hosts?.[0]?.id ? String(hosts[0].id) : ''),
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
      const existing = cellClass(day, slot, col)
      try {
        if (existing) {
          const merged = [...new Set([...(existing.allowedStudents || []).map(String), ...ids])]
          await apiFetch(`/api/live-classes/manage/${existing._id}/students`, {
            method: 'PUT', body: JSON.stringify({ studentIds: merged }),
          })
        } else {
          const meta = newMeta[cellId] || {}
          const locked = roomLockedHost(cellId, cell)
          const hostUserId = locked ? locked.id : meta.hostUserId
          if (!hostUserId) throw new Error('Pick a host')
          if (!meta.subjectId || !meta.chapterId) throw new Error('Pick a subject and chapter')
          const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.startHour)
          const end   = new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.endHour)
          await apiFetch('/api/live-classes/manage', {
            method: 'POST',
            body: JSON.stringify({
              title: (meta.title || '').trim() || `${col.roomLabel} · ${col.trackLabel}`,
              roomKey: col.roomKey, trackKey: col.trackKey,
              scheduledStart: start.toISOString(), scheduledEnd: end.toISOString(),
              hostUserId, studentIds: ids,
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

  const whenLabel = (day, slot) =>
    `${day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${slot.name}`
  const cellLabel = (cell) =>
    `${whenLabel(cell.day, cell.slot)} · ${cell.col.roomLabel} ${cell.col.trackLabel}`

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

            <select value={subjFilter}
              onChange={e => { setSubjFilter(e.target.value); setChapFilter(''); setUnitFilter(''); setStatusFilter('all') }}
              className="w-full mt-2 px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 bg-white text-gray-600">
              <option value="">Any subject</option>
              {(subjects || []).map(s => (
                <option key={s._id} value={String(s._id)}>
                  {s.name} · {s.level}{s.group ? ` ${s.group === 'group1' ? 'G1' : 'G2'}` : ''}
                </option>
              ))}
            </select>

            {/* Drill into the picked paper: chapter → unit → done/pending. The ✓
                prefixes are the cohort state (taught to every enrolled student);
                the chips split the roster by each student's own completion. */}
            {pickedSubject && (
              <select value={chapFilter}
                onChange={e => { setChapFilter(e.target.value); setUnitFilter(''); if (!e.target.value) setStatusFilter('all') }}
                className="w-full mt-2 px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 bg-white text-gray-600">
                <option value="">Any chapter</option>
                {(pickedSubject.chapters || []).map(c => (
                  <option key={c._id} value={String(c._id)}>{c.completed ? '✓ ' : ''}{c.name}</option>
                ))}
              </select>
            )}
            {pickedChapter && (pickedChapter.units || []).length > 0 && (
              <select value={unitFilter} onChange={e => setUnitFilter(e.target.value)}
                className="w-full mt-2 px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 bg-white text-gray-600">
                <option value="">Whole chapter</option>
                {pickedChapter.units.map(u => (
                  <option key={u._id} value={String(u._id)}>{u.completed ? '✓ ' : ''}{u.name}</option>
                ))}
              </select>
            )}
            {pickedChapter && (
              <>
                <div className="flex flex-wrap gap-1 mt-2">
                  {ROSTER_STATUS_CHIPS.map(c => (
                    <button key={c.key} onClick={() => setStatusFilter(c.key)} title={c.title}
                      className={`text-[10px] font-bold px-2 py-1 rounded-md transition-colors ${
                        statusFilter === c.key ? c.on : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                      {c.label}{statusCounts ? ` (${statusCounts[c.key] || 0})` : ''}
                    </button>
                  ))}
                </div>
                {!completionReady && !completionError && (
                  <p className="text-[10px] text-gray-400 mt-1">Checking completion…</p>
                )}
                {completionError && <p className="text-[10px] text-red-500 mt-1">{completionError}</p>}
              </>
            )}

            <div className="flex items-center gap-2 mt-2">
              <button onClick={() => setAdvOpen(true)}
                title="Stack conditions on any field — joining date, last login, slot availability, chapter completion…"
                className={`text-[10px] font-bold px-2 py-1 rounded-md transition-colors ${
                  activeConditions.length ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                ⚙ Advanced{activeConditions.length ? ` · ${activeConditions.length}` : ''}
              </button>
              {activeViewId && (views || []).some(v => String(v._id) === activeViewId) && (
                <span className="text-[10px] font-semibold text-indigo-500 truncate">
                  {(views || []).find(v => String(v._id) === activeViewId)?.name}
                </span>
              )}
            </div>
            {advChecking && <p className="text-[10px] text-gray-400 mt-1">Checking chapter completion…</p>}
            {advCheckFailed && (
              <p className="text-[10px] text-red-500 mt-1">Some completion checks failed — those conditions are ignored.</p>
            )}

            {(enrolFilter !== 'all' || subjFilter || advConditions.length > 0) && (
              <button onClick={clearAllFilters}
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
                className={`group px-2.5 py-2 rounded-lg cursor-grab active:cursor-grabbing select-none mb-0.5
                  border border-transparent hover:border-indigo-200 hover:bg-indigo-50
                  ${dragId === String(s._id) ? 'opacity-40' : ''}`}>
                <div className="flex items-center gap-1">
                  <p className="text-sm font-medium text-gray-800 truncate flex-1 min-w-0">{s.name || '—'}</p>
                  {/* Which slots they can attend, by day type ("All days 1,4",
                      "Wkdy 1,4 · Wknd 2"), and the editor to change it —
                      admins re-set these any time. */}
                  {availabilityLabel(s) && (
                    <span className="text-[9px] font-bold text-sky-600 bg-sky-50 px-1.5 py-0.5 rounded flex-shrink-0 max-w-[110px] truncate"
                      title={`Slot availability: ${availabilityLabel(s)}`}>
                      🕐 {availabilityLabel(s)}
                    </span>
                  )}
                  <button onClick={e => { e.stopPropagation(); setSlotEditor(s) }}
                    title="Set this student's slot availability"
                    className={`text-[10px] flex-shrink-0 px-1 rounded hover:bg-sky-100 ${
                      hasSlotAvailability(s) ? 'text-sky-500' : 'text-gray-300 opacity-0 group-hover:opacity-100'}`}>
                    🕐
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="text-[11px] text-gray-400 truncate">{s.phoneNumber || s.email || ''}</p>
                  {enrollmentLabel(s) && (
                    <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded flex-shrink-0">
                      {enrollmentLabel(s)}
                    </span>
                  )}
                  {chapFilter && completionReady && (() => {
                    const [label, cls] = ROSTER_BADGE[rosterStatus(s)]
                    return <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${cls}`}>{label}</span>
                  })()}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-300 px-3 py-2 border-t border-gray-100">
            Drag onto any slot — nothing is saved until you press <b>Review&nbsp;&amp;&nbsp;save</b>
          </p>
        </div>

        {/* ── Right: the schedule horizon — the next 7 days open, plus any
            extra weeks the admin unfolded with "+ Add 7 more days" ── */}
        <div className="flex-1 min-w-0 space-y-3">
          {(rooms || []).length > 1 && (
            <div className="flex justify-end">
              <div className="inline-flex bg-white border border-gray-200 rounded-xl p-0.5 shadow-sm">
                {[...(rooms || []).map(r => ({ key: r.key, label: r.label })), { key: 'all', label: 'Both rooms' }].map(opt => {
                  // Staged students waiting inside this room, so a hidden room
                  // with pending drops is never forgotten.
                  const stagedHere = opt.key === 'all' ? 0 : Object.values(staged)
                    .filter(c => c.col.roomKey === opt.key)
                    .reduce((n, c) => n + c.ids.length, 0)
                  const on = activeRoom === opt.key
                  return (
                    <button key={opt.key} type="button" onClick={() => setRoomView(opt.key)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-colors
                        ${on ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-indigo-600'}`}>
                      {opt.label}
                      {!on && stagedHere > 0 && (
                        <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1 py-0.5 rounded"
                          title="Students staged in this room">
                          {stagedHere}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {weekChunks.map((weekDays, wi) => {
            const renderDay = (day) => {
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
                    <table className="w-full border-separate table-fixed" style={{ borderSpacing: 6, minWidth: visibleCols.length > 2 ? 760 : 460 }}>
                      <thead>
                        <tr>
                          <th className="text-left text-[10px] font-bold text-gray-400 uppercase px-2 w-32">Slot</th>
                          {visibleCols.map(col => (
                            <th key={col.roomName} className="text-[10px] font-bold text-gray-500 uppercase px-2 pb-1">
                              {col.roomLabel} <span className="text-indigo-500">{col.trackLabel}</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {SLOTS.map(slot => {
                          // A slot closes for NEW classes the moment it STARTS, not
                          // when it ends — the server rejects a start in the past
                          // (validateSchedule, 5-minute grace), so an already-started
                          // slot could only ever fail at Review & save. Once closed
                          // with nothing in any room/track, the whole row goes.
                          // A row keeps its place if it still holds a class or a
                          // staged drop, so neither is hidden behind the cut.
                          const slotPast =
                            new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.startHour).getTime()
                              < Date.now() - 5 * 60 * 1000
                          const rowHasClass = visibleCols.some(col => cellClass(day, slot, col))
                          const rowHasStaged = visibleCols.some(col =>
                            (staged[`${k}/${slot.key}/${col.roomName}`]?.ids || []).length > 0)
                          if (slotPast && !rowHasClass && !rowHasStaged) return null
                          return (
                          <tr key={slot.key}>
                            <td className="align-top px-2 py-1.5">
                              <p className="text-xs font-semibold text-gray-700 whitespace-nowrap">
                                {slot.icon} {fmtHour(slot.startHour)} – {fmtHour(slot.endHour)}
                              </p>
                              <p className="text-[10px] text-gray-400 whitespace-nowrap">{slot.name}</p>
                            </td>
                            {visibleCols.map(col => {
                              const cls = cellClass(day, slot, col)
                              const cellId = `${k}/${slot.key}/${col.roomName}`
                              const cellStaged = staged[cellId]?.ids || []
                              const cfgReady = !cls && cellMetaReady(cellId)
                              const hovered = overCell === cellId
                              // Same cut-off as the row above: a started slot can no
                              // longer take a NEW class, so it refuses drops. Adding
                              // students to a class already saved here still works.
                              const past = !cls && slotPast
                              // A saved roster stays folded until the card is clicked.
                              // Staged chips are NEVER folded away — they're unconfirmed
                              // work the admin still has to see and confirm or discard.
                              const savedIds = cls?.allowedStudents || []
                              const rosterOpen = !!openCells[cellId]
                              // A double booking must never hide behind the fold — the
                              // head-count goes red so the warning survives collapsing.
                              const savedClash =
                                savedIds.some(id => roomClashesFor(day, slot, col, id).length > 0)
                              // While a student is being dragged, the cells
                              // outside their slot availability fade so the
                              // right ones stand out. The drop still works —
                              // whether to book them anyway is the admin's call.
                              const dragged = dragId ? byId.get(dragId) : null
                              const offSlot = !!dragged && !past && !isAvailableFor(dragged, day, slot.key)
                              // Dropping here would put them in a second track
                              // of this room for the slot → the target goes red.
                              const clashDrop = !!dragged && !past && roomClashesFor(day, slot, col, dragId).length > 0
                              return (
                                <td key={col.roomName} className="align-top"
                                  onDragOver={e => { if (past) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOverCell(cellId) }}
                                  onDragLeave={() => setOverCell(o => (o === cellId ? null : o))}
                                  onDrop={e => { if (past) return; e.preventDefault(); stageDrop(day, slot, col, e.dataTransfer.getData('text/plain')) }}>
                                  <div className={past && !cls
                                    // An empty, already-over slot never got a class — nothing to
                                    // show or act on, so it collapses to a quiet sliver instead of
                                    // a full card wasting the same space as a real one.
                                    ? 'min-h-[18px]'
                                    : `relative rounded-xl border px-2.5 py-2 transition-colors ${cfgReady ? 'min-h-[92px]' : 'min-h-[52px]'}
                                    ${hovered ? (clashDrop ? 'border-red-400 bg-red-50' : offSlot ? 'border-amber-400 bg-amber-50' : 'border-indigo-400 bg-indigo-50')
                                      : cellStaged.length ? 'border-amber-300 bg-amber-50/60'
                                      : cls ? 'border-gray-200 bg-white shadow-sm'
                                      : cfgReady ? 'border-gray-200 bg-white'
                                      : 'border-dashed border-gray-200'}
                                    ${offSlot && !hovered ? 'opacity-40' : ''}`}>
                                    {past && !cls ? null : (
                                      <>
                                        {/* Accent stripe: indigo once saved, amber while still being set up. */}
                                        {(cls || cfgReady) && (
                                          <span className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full ${cls ? 'bg-indigo-500' : 'bg-amber-400'}`} />
                                        )}
                                        {/* copy the roster + setup here / paste the copied one */}
                                        <div className="absolute top-1.5 right-1.5 flex gap-0.5">
                                          {(cls || cellStaged.length > 0 || cfgReady) && (
                                            <button type="button" onClick={() => copyCell(day, slot, col)}
                                              title="Copy this slot's students, mentor & subject (chapter is picked fresh on paste)"
                                              className="w-5 h-5 flex items-center justify-center rounded-md bg-white/90 border border-gray-200 text-gray-400 hover:text-indigo-600 hover:border-indigo-300 text-[11px] leading-none">
                                              ⧉
                                            </button>
                                          )}
                                          {clipboard && (
                                            <button type="button" onClick={() => pasteCell(day, slot, col)}
                                              title={`Paste ${clipLabel(clipboard)} here`}
                                              className="w-5 h-5 flex items-center justify-center rounded-md bg-white/90 border border-amber-200 text-amber-500 hover:text-amber-700 hover:border-amber-400 text-[10px] leading-none">
                                              📋
                                            </button>
                                          )}
                                        </div>
                                        {cls && (
                                          // Saved classes wear the same block as configured cells:
                                          // Subject / Chapter · Unit / Mentor, then the room-track-slot
                                          // coords in small print. Clicking the head folds the roster
                                          // open or shut — a booked class is a headline first, its
                                          // 15-odd student chips only when you ask for them.
                                          <button type="button"
                                            onClick={() => setOpenCells(o => ({ ...o, [cellId]: !o[cellId] }))}
                                            title={rosterOpen ? 'Hide students' : 'Show students'}
                                            className="block w-full text-left">
                                            <CellHead
                                              subject={cls.subject?.name} chapter={cls.chapter?.name} unit={cls.unit?.name}
                                              mentor={cls.host?.name} slotTitle={cls.title} live={cls.status === 'live'}
                                              roster={savedIds.length > 0 ? (
                                                // A span, not a button — the whole head is already
                                                // the toggle, and a button inside a button is invalid.
                                                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border shrink-0 ${
                                                  savedClash
                                                    ? 'bg-red-100 border-red-300'
                                                    : 'bg-indigo-50 border-indigo-200'}`}>
                                                  <span className="text-[10px] leading-none">{savedClash ? '⚠' : '👥'}</span>
                                                  <span className={`text-[13px] font-bold leading-none ${
                                                    savedClash ? 'text-red-700' : 'text-indigo-700'}`}>
                                                    {savedIds.length}
                                                  </span>
                                                  <span className="text-[9px] leading-none text-gray-400">{rosterOpen ? '▾' : '▸'}</span>
                                                </span>
                                              ) : null} />
                                          </button>
                                        )}
                                        {/* Setup worn by a not-yet-saved cell: who teaches it and
                                            what — so drops land somewhere with a face and a topic. */}
                                        {cfgReady && (() => {
                                          const m = newMeta[cellId]
                                          const subj = subjects.find(s => String(s._id) === String(m.subjectId))
                                          const chap = (subj?.chapters || []).find(x => String(x._id) === String(m.chapterId))
                                          const unit = (chap?.units || []).find(u => String(u._id) === String(m.unitId))
                                          return (
                                            <button type="button" onClick={() => openSetup(day, slot, col)}
                                              title="Change mentor / subject / chapter"
                                              className="block w-full text-left">
                                              <CellHead
                                                subject={subj?.name} chapter={chap?.name} unit={unit?.name}
                                                mentor={hostName(m.hostUserId)}
                                                slotTitle={m.title || `${col.roomLabel} · ${col.trackLabel} — ${slot.name}`} />
                                            </button>
                                          )
                                        })()}
                                        <div className="flex flex-wrap gap-1">
                                          {(rosterOpen ? savedIds : []).map(id => {
                                            // Saved students are checked too, so an old
                                            // double booking (or a staged sibling drop)
                                            // shows up on both chips, not just the new one.
                                            const dup = roomClashesFor(day, slot, col, id)
                                            const dupTitle = dup.length
                                              ? `Also in ${dup.map(d => d.trackLabel).join(' & ')} of ${col.roomLabel} in this slot — a student can attend only one track`
                                              : undefined
                                            return (
                                              <span key={String(id)} title={dupTitle}
                                                className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md ${
                                                  dup.length ? 'bg-red-100 text-red-800 border border-red-300' : 'bg-indigo-100 text-indigo-700'}`}>
                                                {dup.length > 0 && <span className="text-red-600">⚠</span>}{chipName(id)}
                                                <button type="button" onClick={() => removeSaved(cls, id)}
                                                  className={`font-bold leading-none ${dup.length ? 'text-red-400 hover:text-red-900' : 'text-indigo-400 hover:text-indigo-800'}`}>×</button>
                                              </span>
                                            )
                                          })}
                                          {cls && !savedIds.length && !cellStaged.length && (
                                            <span className="text-[10px] text-gray-400 italic">open to all</span>
                                          )}
                                          {cellStaged.map(id => {
                                            // ⚠ marks a student parked outside their slot
                                            // availability (amber) or booked into a sibling
                                            // track of this room for the same slot (red).
                                            const st = byId.get(id)
                                            const off = !!st && !isAvailableFor(st, day, slot.key)
                                            const dup = clashes.byChip.get(`${cellId}|${id}`) || []
                                            const title = dup.length
                                              ? `Also in ${dup.map(d => d.trackLabel).join(' & ')} of ${col.roomLabel} in this slot — a student can attend only one track`
                                              : off ? "Outside this student's slot availability" : undefined
                                            return (
                                              <span key={id} title={title}
                                                className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md border ${
                                                  dup.length ? 'bg-red-100 text-red-800 border-red-300' : 'bg-amber-100 text-amber-800 border-amber-200'}`}>
                                                {(off || dup.length > 0) && <span className={dup.length ? 'text-red-600' : 'text-red-500'}>⚠</span>}{chipName(id)}
                                                <button type="button" onClick={() => unstage(cellId, id)}
                                                  className={`font-bold leading-none ${dup.length ? 'text-red-400 hover:text-red-900' : 'text-amber-500 hover:text-amber-900'}`}>×</button>
                                              </span>
                                            )
                                          })}
                                          {!cls && !cellStaged.length && (
                                            !cfgReady ? (
                                              // Setup comes first — the cell only invites drops
                                              // once it knows its mentor and chapter.
                                              <button type="button" onClick={() => openSetup(day, slot, col)}
                                                className="text-[10px] text-indigo-400 hover:text-indigo-600 font-semibold w-full pt-2 text-center">
                                                ＋ Set mentor &amp; chapter
                                              </button>
                                            ) : clipboard ? (
                                              <button type="button" onClick={() => pasteCell(day, slot, col)}
                                                className="text-[11px] text-amber-500 hover:text-amber-700 font-semibold w-full py-4 text-center border-2 border-dashed border-amber-200 rounded-lg mt-1">
                                                📋 paste {clipLabel(clipboard)}
                                              </button>
                                            ) : (
                                              // Configured cell: a roomy dashed target, so the drag
                                              // has somewhere obvious (and easy) to land.
                                              <span className="text-[11px] text-gray-400 w-full py-4 text-center border-2 border-dashed border-indigo-200 rounded-lg mt-1">
                                                ⬇ drop student here
                                              </span>
                                            )
                                          )}
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </td>
                              )
                            })}
                          </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
            }

            // The first 7 days stay bare, exactly as before. Every added block
            // is a dropdown week card, so a long horizon folds out of the way.
            if (wi === 0) return weekDays.map(renderDay)

            const open = weekOpen[wi] !== false
            const fmtD = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
            // Drops staged inside a folded week must stay visible, or they'd be
            // forgotten — same rule the room switcher follows.
            const weekKeys = new Set(weekDays.map(dayKey))
            const stagedHere = Object.values(staged)
              .filter(c => weekKeys.has(dayKey(c.day)))
              .reduce((n, c) => n + c.ids.length, 0)
            return (
              <div key={`week-${wi}`} className="bg-white rounded-2xl shadow-sm overflow-hidden border border-indigo-100">
                <button type="button" onClick={() => setWeekOpen(o => ({ ...o, [wi]: !open }))}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-indigo-50/40">
                  <span className="text-sm font-bold text-indigo-900">
                    📅 {fmtD(weekDays[0])} – {fmtD(weekDays[weekDays.length - 1])}
                    <span className="ml-2 text-[10px] font-semibold text-indigo-400 uppercase">
                      days {wi * 7 + 1}–{wi * 7 + weekDays.length}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {!open && stagedHere > 0 && (
                      <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded"
                        title="Students staged in this week">
                        {stagedHere}
                      </span>
                    )}
                    <span className="text-gray-300 text-xs">{open ? '▾' : '▸'}</span>
                  </span>
                </button>
                {open && (
                  <div className="border-t border-indigo-100 bg-indigo-50/20 p-3 space-y-3">
                    {weekDays.map(renderDay)}
                  </div>
                )}
              </div>
            )
          })}

          {/* Scheduling isn't capped at 7 days — extend the horizon a week at a time. */}
          <button type="button"
            onClick={() => { setWeekOpen(o => ({ ...o, [weekCount]: true })); setWeekCount(weekCount + 1) }}
            className="w-full py-3 rounded-2xl border-2 border-dashed border-indigo-200 text-indigo-500 text-sm font-semibold hover:bg-indigo-50 hover:border-indigo-300 transition-colors">
            ＋ Add 7 more days
          </button>
        </div>
      </div>

      {/* ── Floating clipboard pill — visible while a roster is copied ── */}
      {clipboard && (
        <div className="fixed bottom-5 left-6 z-40 bg-white rounded-2xl shadow-xl border border-amber-200 px-4 py-3 flex items-center gap-3">
          <span className="text-xs text-gray-700">
            ⧉ <b>{clipLabel(clipboard)}</b> copied
            <span className="text-gray-400"> from {clipboard.from}</span> — click 📋 on any slot to paste
          </span>
          <button onClick={() => setClipboard(null)}
            className="px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 text-xs font-semibold hover:bg-gray-50">
            ✕ Clear
          </button>
        </div>
      )}

      {/* ── Double-booking notice — fires at the drop/paste that caused it ── */}
      {notice && (
        <div role="alert"
          className="fixed top-4 right-4 z-50 max-w-md bg-white rounded-2xl shadow-xl border border-red-200 px-4 py-3 flex items-start gap-3">
          <span className="text-red-500 text-base leading-none pt-0.5">⚠</span>
          <p className="text-xs text-red-800 flex-1 leading-snug">{notice.text}</p>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {notice.undo && (
              <button type="button" onClick={() => { notice.undo(); setNotice(null) }}
                className="px-2.5 py-1 rounded-lg bg-red-600 text-white text-[11px] font-semibold hover:bg-red-700">
                Undo
              </button>
            )}
            <button type="button" onClick={() => setNotice(null)}
              className="text-gray-300 hover:text-gray-500 text-sm leading-none px-1">✕</button>
          </div>
        </div>
      )}

      {/* ── Floating action bar — appears once anything is staged ── */}
      {stagedCount > 0 && !review && (
        <div className="fixed bottom-5 right-6 z-40 bg-white rounded-2xl shadow-xl border border-gray-100 px-4 py-3 flex items-center gap-3">
          <span className="text-sm text-gray-700">
            <b>{stagedCount}</b> student{stagedCount > 1 ? 's' : ''} staged in <b>{Object.keys(staged).length}</b> slot{Object.keys(staged).length > 1 ? 's' : ''}
          </span>
          {clashes.groups.length > 0 && (
            <span className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded-lg"
              title={clashes.groups.map(g => `${chipName(g.id)} · ${whenLabel(g.day, g.slot)} · ${g.roomLabel} ${g.tracks.join(' & ')}`).join('\n')}>
              ⚠ {clashes.groups.length} in two tracks of one room
            </span>
          )}
          <button onClick={() => { setStaged({}); setNotice(null) }}
            className="px-3 py-1.5 rounded-xl border border-gray-200 text-gray-500 text-xs font-semibold hover:bg-gray-50">
            Discard
          </button>
          <button onClick={openReview}
            className="px-4 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700">
            Review &amp; save
          </button>
        </div>
      )}

      {/* ── Per-slot setup: mentor + subject/chapter (unit optional) ── */}
      {setup && (() => {
        const locked = roomLockedHost(setup.cellId, setup)
        const subj = subjects.find(s => String(s._id) === setup.subjectId)
        const chap = (subj?.chapters || []).find(c => String(c._id) === setup.chapterId)
        const ready = (locked || setup.hostUserId) && setup.subjectId && setup.chapterId
        const patch = (p) => setSetup(s => s && ({ ...s, ...p }))
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
            onClick={() => setSetup(null)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
              <h2 className="text-base font-bold text-gray-900 mb-0.5">Set up this class</h2>
              <p className="text-xs text-gray-400 mb-4">
                {setup.slot.icon} {cellLabel(setup)} — pick who teaches and what, then drag students in.
              </p>

              <div className="space-y-2">
                <select value={locked ? locked.id : (setup.hostUserId || '')} disabled={!!locked}
                  onChange={e => patch({ hostUserId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-50 disabled:text-gray-500">
                  <option value="">Select a mentor…</option>
                  {(hosts || []).map(h => <option key={h.id} value={String(h.id)}>{h.name} ({h.role})</option>)}
                  {locked && !(hosts || []).some(h => String(h.id) === locked.id) && (
                    <option value={locked.id}>{locked.name}</option>
                  )}
                </select>
                {locked && (
                  <p className="text-[10px] text-amber-600">
                    🔒 {setup.col.roomLabel} already has <b>{locked.name}</b> in this slot ({locked.from}) — one room uses one mentor.
                  </p>
                )}

                <select value={setup.subjectId}
                  onChange={e => patch({ subjectId: e.target.value, chapterId: '', unitId: '' })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400">
                  <option value="">Subject…</option>
                  {subjects.map(s => <option key={s._id} value={String(s._id)}>{s.name} ({s.level})</option>)}
                </select>
                <select value={setup.chapterId} disabled={!subj}
                  onChange={e => patch({ chapterId: e.target.value, unitId: '' })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-50 disabled:text-gray-400">
                  <option value="">{subj ? (subj.chapters?.length ? 'Chapter…' : 'No chapters in subject') : 'Pick subject first'}</option>
                  {/* ✓ = already taught — helps pick what comes next */}
                  {(subj?.chapters || []).map(c => (
                    <option key={c._id} value={String(c._id)}>{c.completed ? '✓ ' : ''}{c.name}</option>
                  ))}
                </select>
                {/* Unit only shows up when the chapter actually has units */}
                {!!chap?.units?.length && (
                  <select value={setup.unitId}
                    onChange={e => patch({ unitId: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400">
                    <option value="">Unit (optional)…</option>
                    {(chap.units || []).map(u => (
                      <option key={u._id} value={String(u._id)}>{u.completed ? '✓ ' : ''}{u.name}</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex items-center justify-between mt-4">
                {newMeta[setup.cellId] ? (
                  <button onClick={clearSetup}
                    className="text-xs font-semibold text-gray-400 hover:text-red-500">
                    Remove setup
                  </button>
                ) : <span />}
                <div className="flex gap-2">
                  <button onClick={() => setSetup(null)}
                    className="px-4 py-2 rounded-xl border border-gray-200 text-gray-500 text-sm font-semibold hover:bg-gray-50">
                    Cancel
                  </button>
                  <button onClick={saveSetup} disabled={!ready}
                    className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:bg-gray-300">
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

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

            {/* Same student, two tracks of one room, same slot — listed up top
                so it can't be missed, with the cells below carrying the detail. */}
            {clashes.groups.length > 0 && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
                <p className="text-xs font-bold text-red-700 mb-1">
                  ⚠ {clashes.groups.length} student{clashes.groups.length > 1 ? 's' : ''} booked into two tracks of the same room
                </p>
                <ul className="text-[11px] text-red-700 space-y-0.5">
                  {clashes.groups.map((g, i) => (
                    <li key={i}>
                      <b>{chipName(g.id)}</b> · {whenLabel(g.day, g.slot)} · {g.roomLabel} {g.tracks.join(' & ')}
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-red-600 mt-1.5">
                  A student can attend only one track of a room. Go Back and remove them from one track (×), or confirm anyway.
                </p>
              </div>
            )}

            <div className="space-y-3">
              {Object.entries(staged).map(([cellId, cell]) => {
                const existing = cellClass(cell.day, cell.slot, cell.col)
                const meta = newMeta[cellId] || {}
                return (
                  <div key={cellId} className="border border-gray-100 rounded-xl p-3">
                    <p className="text-xs font-bold text-gray-700 mb-1">
                      {cell.slot.icon} {cellLabel(cell)}
                    </p>
                    <p className="text-[11px] text-gray-500 mb-2">
                      {cell.ids.map(chipName).join(', ')}
                    </p>
                    {(() => {
                      const dup = cell.ids.filter(id => clashes.byChip.has(`${cellId}|${id}`))
                      if (!dup.length) return null
                      const tracks = [...new Set(dup.flatMap(id => clashes.byChip.get(`${cellId}|${id}`).map(d => d.trackLabel)))]
                      return (
                        <p className="text-[10px] text-red-600 mb-2">
                          ⚠ Also in {cell.col.roomLabel} · {tracks.join(' & ')} this slot: {dup.map(chipName).join(', ')} — one student, one track.
                        </p>
                      )
                    })()}
                    {(() => {
                      const off = cell.ids.filter(id => {
                        const st = byId.get(id)
                        return !!st && !isAvailableFor(st, cell.day, cell.slot.key)
                      })
                      return off.length > 0 && (
                        <p className="text-[10px] text-amber-600 mb-2">
                          ⚠ Outside their slot availability: {off.map(chipName).join(', ')} — booking them anyway is your call.
                        </p>
                      )
                    })()}
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
                      const locked = roomLockedHost(cellId, cell)
                      return (
                        <div className="space-y-2">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input value={meta.title || ''}
                              onChange={e => setMeta({ title: e.target.value })}
                              placeholder="Class title"
                              className="px-3 py-2 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
                            <select value={locked ? locked.id : (meta.hostUserId || '')}
                              disabled={!!locked}
                              onChange={e => setMeta({ hostUserId: e.target.value })}
                              className="px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-50 disabled:text-gray-500">
                              <option value="">Select a host…</option>
                              {(hosts || []).map(h => <option key={h.id} value={h.id}>{h.name} ({h.role})</option>)}
                              {locked && !(hosts || []).some(h => String(h.id) === locked.id) && (
                                <option value={locked.id}>{locked.name}</option>
                              )}
                            </select>
                          </div>
                          {locked && (
                            <p className="text-[10px] text-amber-600">
                              🔒 {cell.col.roomLabel} already has <b>{locked.name}</b> in this slot ({locked.from}) — one room uses one mentor.
                            </p>
                          )}
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

      {/* ── Zoho-style advanced filter drawer ── */}
      {advOpen && (
        <AdvancedFilterPanel
          conditions={advConditions} setConditions={setAdvConditions}
          subjects={subjects}
          views={views} setViews={setViews}
          activeViewId={activeViewId} setActiveViewId={setActiveViewId}
          currentFilters={currentFilters} onApplyView={applyView}
          onClearAll={clearAllFilters}
          matchCount={filtered.length}
          onClose={() => setAdvOpen(false)}
        />
      )}

      {/* ── Per-student slot availability editor ── */}
      {slotEditor && (
        <SlotEditorModal
          student={slotEditor}
          onSaved={u => {
            setStudents(list => (list || []).map(s => String(s._id) === String(u._id)
              ? { ...s, slotAvailability: u.slotAvailability } : s))
            setSlotEditor(null)
          }}
          onClose={() => setSlotEditor(null)}
        />
      )}
    </div>
  )
}

// ─────────────────────────── Advanced filter drawer ───────────────────────────
// The Zoho-style condition builder: stack rows on any field (joining date, last
// login, slot time, chapter completion, …), each with is/isn't-style operators;
// rows apply live, ANDed with the quick filters above the roster. Saved views
// live on the server and are shared by every admin.

function AdvancedFilterPanel({
  conditions, setConditions, subjects, views, setViews,
  activeViewId, setActiveViewId, currentFilters, onApplyView, onClearAll,
  matchCount, onClose,
}) {
  const [viewName, setViewName] = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')

  const activeView = (views || []).find(v => String(v._id) === activeViewId) || null

  const patchCondition = (id, patch) =>
    setConditions(conditions.map(c => (c.id === id ? { ...c, ...patch } : c)))
  const removeCondition = (id) => setConditions(conditions.filter(c => c.id !== id))

  const saveAsNew = async () => {
    const name = viewName.trim()
    if (!name) { setError('Give the view a name first'); return }
    setBusy(true); setError('')
    try {
      const d = await apiFetch('/api/admin/filter-views', {
        method: 'POST',
        body: JSON.stringify({ scope: 'scheduler-roster', name, filters: currentFilters() }),
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
        body: JSON.stringify({ filters: currentFilters() }),
      })
      setViews((views || []).map(v => (String(v._id) === String(d.view._id) ? d.view : v)))
      setActiveViewId(String(d.view._id))
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
      <div className="fixed inset-y-0 left-0 z-50 w-[380px] max-w-full bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Filter students</h2>
            <p className="text-[11px] text-gray-400">{matchCount} match{matchCount === 1 ? 'es' : ''} · conditions apply live, all must hold</p>
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
                placeholder="Save current filters as…"
                className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
              <button onClick={saveAsNew} disabled={busy}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-300">
                Save
              </button>
            </div>
            {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
          </div>

          {/* Condition rows */}
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">Conditions</p>
            {!conditions.length && (
              <p className="text-xs text-gray-400 mb-2">No conditions yet — add one below. The quick filters above the roster still apply.</p>
            )}
            <div className="space-y-2">
              {conditions.map(c => (
                <ConditionRow key={c.id} cond={c} subjects={subjects}
                  onChange={patch => patchCondition(c.id, patch)}
                  onRemove={() => removeCondition(c.id)} />
              ))}
            </div>
            <button onClick={() => setConditions([...conditions, newCondition('name')])}
              className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800">
              + Add condition
            </button>
          </div>
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

// One condition row: field → operator → value editor, the editor's shape driven
// by the field's kind (see lib/rosterFilter.js). Changing the field resets the
// row so a stale value can never leak across kinds.
function ConditionRow({ cond, subjects, onChange, onRemove }) {
  const def = fieldDef(cond.field)
  if (!def) return null
  const ops = opsFor(def)
  const inputCls = 'px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 bg-white text-gray-700'

  const chapterSubject = def.kind === 'chapter'
    ? (subjects || []).find(s => String(s._id) === String(cond.value?.subjectId)) || null
    : null
  const chapterChapter = chapterSubject
    ? (chapterSubject.chapters || []).find(c => String(c._id) === String(cond.value?.chapterId)) || null
    : null

  return (
    <div className="border border-gray-100 rounded-xl p-2 bg-gray-50/50">
      <div className="flex items-center gap-1.5">
        <select value={cond.field}
          onChange={e => onChange({ ...newCondition(e.target.value), id: cond.id })}
          className={`${inputCls} flex-1 min-w-0`}>
          {FIELD_DEFS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <select value={cond.op}
          onChange={e => onChange({ op: e.target.value })}
          className={`${inputCls} flex-1 min-w-0`}>
          {ops.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <button onClick={onRemove} className="text-gray-300 hover:text-red-500 flex-shrink-0 px-1">✕</button>
      </div>

      {/* value editor */}
      <div className="mt-1.5">
        {def.kind === 'text' && !['empty', 'not_empty'].includes(cond.op) && (
          <input value={cond.value || ''} onChange={e => onChange({ value: e.target.value })}
            placeholder={`${def.label}…`} className={`${inputCls} w-full`} />
        )}

        {def.kind === 'date' && cond.op === 'last' && (
          <div className="flex items-center gap-1.5">
            <input type="number" min="1" value={cond.value?.days || ''}
              onChange={e => onChange({ value: { days: e.target.value } })}
              className={`${inputCls} w-20`} />
            <span className="text-xs text-gray-500">days</span>
          </div>
        )}
        {def.kind === 'date' && ['before', 'after'].includes(cond.op) && (
          <input type="date" value={cond.value?.date || ''}
            onChange={e => onChange({ value: { date: e.target.value } })}
            className={`${inputCls} w-full`} />
        )}
        {def.kind === 'date' && cond.op === 'between' && (
          <div className="flex items-center gap-1.5">
            <input type="date" value={cond.value?.from || ''}
              onChange={e => onChange({ value: { ...cond.value, from: e.target.value } })}
              className={`${inputCls} flex-1 min-w-0`} />
            <span className="text-xs text-gray-400">–</span>
            <input type="date" value={cond.value?.to || ''}
              onChange={e => onChange({ value: { ...cond.value, to: e.target.value } })}
              className={`${inputCls} flex-1 min-w-0`} />
          </div>
        )}

        {def.kind === 'enum' && cond.op !== 'not_set' && (
          <div className="flex flex-wrap gap-1">
            {def.options.map(o => {
              const on = (cond.value || []).includes(o.key)
              return (
                <button key={o.key}
                  onClick={() => onChange({ value: on ? cond.value.filter(v => v !== o.key) : [...(cond.value || []), o.key] })}
                  className={`text-[10px] font-bold px-2 py-1 rounded-md ${
                    on ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  {o.label}
                </button>
              )
            })}
          </div>
        )}

        {def.kind === 'subject' && (() => {
          const picked = subjectIdsOf(cond)
          return (
            <div className="space-y-1 max-h-44 overflow-y-auto pr-0.5">
              {(subjects || []).map(s => {
                const id = String(s._id)
                const on = picked.includes(id)
                return (
                  <button key={id}
                    onClick={() => onChange({ value: on ? picked.filter(v => v !== id) : [...picked, id] })}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border text-left text-xs ${
                      on ? 'border-indigo-300 bg-indigo-50 text-indigo-800 font-medium' : 'border-gray-100 text-gray-600 hover:bg-gray-50'}`}>
                    <span className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${
                      on ? 'bg-indigo-600 text-white' : 'border border-gray-300 text-transparent'}`}>✓</span>
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="text-[9px] text-gray-400 flex-shrink-0">
                      {s.level}{s.group ? ` · ${s.group === 'group1' ? 'G1' : 'G2'}` : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })()}

        {def.kind === 'slot' && (
          <div className="space-y-1.5">
            {cond.op !== 'not_set' && (
              <select value={cond.value?.slot || ''}
                onChange={e => onChange({ value: { ...cond.value, slot: e.target.value } })}
                className={`${inputCls} w-full`}>
                <option value="">Pick a slot…</option>
                {SLOT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            )}
            <select value={cond.value?.days || ''}
              onChange={e => onChange({ value: { ...cond.value, days: e.target.value } })}
              className={`${inputCls} w-full`}>
              <option value="">On any day</option>
              {DAY_TYPES.map(d => <option key={d.key} value={d.key}>On {d.long.toLowerCase()}</option>)}
            </select>
          </div>
        )}

        {def.kind === 'chapter' && (
          <div className="space-y-1.5">
            <select value={cond.value?.subjectId || ''}
              onChange={e => onChange({ value: { subjectId: e.target.value, chapterId: '', unitId: '' } })}
              className={`${inputCls} w-full`}>
              <option value="">Subject…</option>
              {(subjects || []).map(s => <option key={s._id} value={String(s._id)}>{s.name} ({s.level})</option>)}
            </select>
            <select value={cond.value?.chapterId || ''} disabled={!chapterSubject}
              onChange={e => onChange({ value: { ...cond.value, chapterId: e.target.value, unitId: '' } })}
              className={`${inputCls} w-full disabled:bg-gray-50 disabled:text-gray-400`}>
              <option value="">{chapterSubject ? 'Chapter…' : 'Pick subject first'}</option>
              {(chapterSubject?.chapters || []).map(c => (
                <option key={c._id} value={String(c._id)}>{c.completed ? '✓ ' : ''}{c.name}</option>
              ))}
            </select>
            {(chapterChapter?.units || []).length > 0 && (
              <select value={cond.value?.unitId || ''}
                onChange={e => onChange({ value: { ...cond.value, unitId: e.target.value } })}
                className={`${inputCls} w-full`}>
                <option value="">Whole chapter</option>
                {chapterChapter.units.map(u => (
                  <option key={u._id} value={String(u._id)}>{u.completed ? '✓ ' : ''}{u.name}</option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// The slot time editor lives in components/SlotEditorModal.jsx — shared with
// the Users page so both places edit the same thing the same way.
