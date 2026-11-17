import { useState, useEffect, useMemo } from 'react'
import { apiFetch, saveWithClashCheck } from '../api'
import {
  FIELD_DEFS, conditionComplete, conditionReady, withSittingOptions,
  matchesConditions, describeFilter, chapterConditionKey, studiesSubject,
  normalizeCondition,
  availabilityLabel, hasSlotAvailability, isAvailableFor,
} from '../lib/rosterFilter'
import ConditionList from './ConditionList'
import SlotEditorModal from './SlotEditorModal'
import { usePrograms, programNames, programFilterOptions, matchesProgram } from '../lib/programs'
import SubjectOptions from './SubjectOptions'
import PlannedItemsPicker from './PlannedItemsPicker'
import { plannedItemsError, plannedPayload, plannedNames, savedPlannedNames } from '../lib/plannedItems'

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

// FOCAS Hall sessions keep their own clock times — "HH:MM" / "YYYY-MM-DD" in
// the shape the Hall form's inputs take.
const pad2 = (n) => String(n).padStart(2, '0')
const toDateInput = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const toTimeInput = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
const fmtClock = (d) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

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
function CellHead({ subject, chapter, unit, more = [], mentor, mentorWarn, slotTitle, live, roster }) {
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
      {/* Extra chapters/units planned for the same session */}
      {more.length > 0 && (
        <p className="pr-12 text-[11px] font-medium text-indigo-500 leading-snug break-words" title={more.join(', ')}>
          ＋ {more.join(', ')}
        </p>
      )}
      {/* One line carries all three: mentor left, the head-count centred between
          them, room/track/slot coords right. The count rides here rather than on
          a line of its own so a booked cell stays three lines tall. */}
      <div className="mt-1.5 flex items-center gap-1.5 min-w-0">
        <span className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-white text-[8px] font-bold tracking-wide shrink-0 ring-2 ${
          mentorWarn ? 'bg-red-600 ring-red-100' : 'bg-indigo-600 ring-indigo-100'}`}>
          {initials(mentor)}
        </span>
        {/* Name and coords each take an equal share and truncate, so the count
            sits centred between them and nothing overlaps in the narrow
            both-rooms columns. Full text of either is on hover. */}
        {/* Mentor booked in another room at the same time → red ⚠ name. */}
        <span className={`flex-1 min-w-0 truncate text-[11px] font-semibold ${mentorWarn ? 'text-red-700' : 'text-gray-800'}`}
          title={mentorWarn || mentor || ''}>
          {mentorWarn && <span className="text-red-600">⚠ </span>}{mentor || '…'}
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

export default function SchedulerBoard({ rooms, hallRooms, hosts, classes, onChanged, onStagedCount, onBookHall, onEditClass }) {
  // Only mentors can be picked to teach — an admin login lands on the admin
  // panel, which has no meeting room, so an admin-hosted class could never
  // start. The full `hosts` list stays for showing names on old classes.
  const mentorHosts = useMemo(() => (hosts || []).filter(h => h.role === 'mentor'), [hosts])
  const [students, setStudents] = useState(null)   // full roster for the left panel
  const [search, setSearch]     = useState('')
  const [enrolFilter, setEnrolFilter] = useState('all')   // see ENROLMENT_CHIPS
  const [progFilter,  setProgFilter]  = useState('')      // program key | 'none' | '' = any (lib/programs.js)
  const programs = usePrograms()
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
  const [subjectProgress, setSubjectProgress] = useState({}) // subjectId → Map(userId → { done, total, percent }) | 'error'
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
  const [hallClip, setHallClip] = useState(null)   // copied FOCAS Hall session — Hall form fields + from
  const [hallSaving, setHallSaving] = useState(null) // Hall session id while a dropped student is being saved
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

  // Every classroom track in display order, with its parent room label.
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

  // Advanced "Subject progress" rows need each student's % on that paper —
  // the report's number, worked out on the server (/api/admin/subject-progress).
  // Fetched once per paper, as soon as the paper is picked, and kept for the
  // board's lifetime (reload the page for fresh numbers); 'error' = the row
  // passes everyone rather than silently hiding students.
  useEffect(() => {
    const need = [...new Set(
      advConditions
        .filter(c => c.field === 'subjectProgress' && c.value?.subjectId)
        .map(c => String(c.value.subjectId).toLowerCase()),
    )].filter(k => !(k in subjectProgress))
    if (!need.length) return
    let stale = false
    for (const sid of need) {
      apiFetch(`/api/admin/subject-progress?subjectId=${sid}`)
        .then(d => { if (!stale) setSubjectProgress(prev => ({ ...prev, [sid]: new Map(Object.entries(d.students || {})) })) })
        .catch(() => { if (!stale) setSubjectProgress(prev => ({ ...prev, [sid]: 'error' })) })
    }
    return () => { stale = true }
  }, [advConditions, subjectProgress])

  // Every exam sitting a roster student has — the Advanced Batch choices.
  const sittings = useMemo(
    () => [...new Set((students || []).map(s => (typeof s.caAttempt === 'string' ? s.caAttempt.trim() : '')).filter(Boolean))],
    [students],
  )

  const subjectsById = useMemo(
    () => new Map((subjects || []).map(s => [String(s._id), s])),
    [subjects],
  )
  const filterCtx = { subjectsById, chapterSets, programs, subjectProgress }
  const activeConditions = advConditions.filter(c => conditionComplete(c))
  const failedFetch = (c) => c.field === 'chapter' ? chapterSets[chapterConditionKey(c)] === 'error'
    : c.field === 'subjectProgress' ? subjectProgress[String(c.value?.subjectId || '').toLowerCase()] === 'error'
    : false
  const advChecking = activeConditions.some(c => !conditionReady(c, filterCtx) && !failedFetch(c))
  const advCheckFailed = activeConditions.some(failedFetch)
  // Papers whose % the roster cards show (one badge per active row's paper).
  const progressBadges = [...new Set(activeConditions
    .filter(c => c.field === 'subjectProgress' && conditionReady(c, filterCtx))
    .map(c => String(c.value.subjectId).toLowerCase()))]
    .map(sid => ({ sid, short: (subjectsById.get(sid)?.name || 'Subject').split(/\s+/).map(w => w[0]).join('').slice(0, 4).toUpperCase(), name: subjectsById.get(sid)?.name || 'Subject' }))

  // Enrollment + paper + advanced conditions narrow the pool; search and the
  // status chips slice it. Chip counts come from the pool so typing a search
  // doesn't change them.
  const scoped = (students || []).filter(s => {
    if (enrolFilter === 'subjects' && !(s.caSubjects || []).length) return false
    if (enrolFilter === 'unset' && (s.caLevel || (s.caSubjects || []).length)) return false
    if (['group1', 'group2', 'both'].includes(enrolFilter) && s.caGroup !== enrolFilter) return false
    if (!matchesProgram(s, progFilter)) return false
    if (pickedSubject && !studiesSubject(s, pickedSubject)) return false
    // AND / OR between rows; rows whose data failed to load are ignored.
    if (!matchesConditions(s, advConditions, filterCtx, failedFetch)) return false
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
    quick: { enrolFilter, progFilter, subjFilter, chapFilter, unitFilter, statusFilter },
    conditions: advConditions,
  })
  const applyView = (v) => {
    const q = v.filters?.quick || {}
    setEnrolFilter(q.enrolFilter || 'all')
    setProgFilter(q.progFilter || '')
    setSubjFilter(q.subjFilter || '')
    setChapFilter(q.chapFilter || '')
    setUnitFilter(q.unitFilter || '')
    setStatusFilter(q.statusFilter || 'all')
    setAdvConditions(Array.isArray(v.filters?.conditions) ? v.filters.conditions.map(c => normalizeCondition(c)) : [])
    setActiveViewId(String(v._id))
  }
  const clearAllFilters = () => {
    setEnrolFilter('all'); setProgFilter(''); setSubjFilter(''); setChapFilter(''); setUnitFilter('')
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
      planned: m.planned || [],
    })
  }

  const saveSetup = () => {
    if (!setup) return
    const locked = roomLockedHost(setup.cellId, setup)
    const hostUserId = locked ? locked.id : setup.hostUserId
    if (!hostUserId || !setup.subjectId || !setup.chapterId) return
    const { cellId, day, slot, col, subjectId, chapterId, unitId } = setup
    const planned = (setup.planned || []).filter(x => x.chapterId)
    setNewMeta(m => ({ ...m, [cellId]: {
      ...(m[cellId] || {}),
      title: m[cellId]?.title || `${col.roomLabel} · ${col.trackLabel} — ${slot.name}`,
      hostUserId, subjectId, chapterId, unitId, planned,
      day, slot, col,   // coords let sibling cells see this pick for mentor locking
    } }))
    setSetup(null)
  }

  const clearSetup = () => {
    if (!setup) return
    setNewMeta(m => { const next = { ...m }; delete next[setup.cellId]; return next })
    setSetup(null)
  }

  // ── one person, two places at once ──
  // A student sits in ONE class per slot — another track of the same room or a
  // class in a different room at the same time both book them twice. A mentor
  // may run both tracks of ONE room (they switch tracks), but not two rooms at
  // once. Drops still land (the admin may be mid-move), but every clash is
  // flagged at once: a toast with Undo, red chips / mentor name in the grid,
  // and a banner in Review & save. The server asks again on save.

  const slotWindow = (day, slot) => [
    new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.startHour),
    new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.endHour),
  ]
  const overlaps = (c, s, e) => new Date(c.scheduledStart) < e && new Date(c.scheduledEnd) > s
  const colWhere = (col) => `${col.roomLabel} · ${col.trackLabel}`
  const classWhere = (c) => [c.room?.label, c.track?.label].filter(Boolean).join(' · ') || c.title
  const sameSlot = (a, day, slot) => dayKey(a.day) === dayKey(day) && a.slot.key === slot.key
  const wheres = (list) => list.map(o => o.where).join(' & ')

  // The other classes (saved or staged) this student is in at the same time.
  const studentClashesFor = (day, slot, col, id) => {
    const sid = String(id)
    const [s, e] = slotWindow(day, slot)
    const here = colKey(col)
    const out = []
    const seen = new Set()
    for (const c of active) {
      const k = trackKeyOf(c)
      if (k === here || c.roomName === col.roomName || !overlaps(c, s, e)) continue
      if (!(c.allowedStudents || []).some(x => String(x) === sid)) continue
      if (!seen.has(k)) { seen.add(k); out.push({ where: classWhere(c), saved: true }) }
    }
    for (const cell of Object.values(staged)) {
      const k = colKey(cell.col)
      if (k === here || !sameSlot(cell, day, slot) || !cell.ids.includes(sid)) continue
      if (!seen.has(k)) { seen.add(k); out.push({ where: colWhere(cell.col), saved: false }) }
    }
    return out
  }

  // Every staged (cell, student) pair that is double-booked. `byChip`
  // ("cellId|studentId" → other places) marks the chips; `groups` folds a clash
  // down to one line per (day, slot, student) for the banners, since every
  // clash touches at least two cells.
  const clashes = (() => {
    const byChip = new Map()
    const groups = new Map()
    for (const [cellId, cell] of Object.entries(staged)) {
      for (const id of cell.ids) {
        const others = studentClashesFor(cell.day, cell.slot, cell.col, id)
        if (!others.length) continue
        byChip.set(`${cellId}|${id}`, others)
        const gk = `${dayKey(cell.day)}/${cell.slot.key}|${id}`
        const g = groups.get(gk) || { day: cell.day, slot: cell.slot, id, places: new Set() }
        g.places.add(colWhere(cell.col))
        for (const o of others) g.places.add(o.where)
        groups.set(gk, g)
      }
    }
    return { byChip, groups: [...groups.values()].map(g => ({ ...g, places: [...g.places].sort() })) }
  })()

  // The toast fired at the drop/paste that caused a clash: who, where else, and
  // a one-click Undo that lifts them back out of THIS cell.
  const warnStudentClashes = (day, slot, col, ids) => {
    const hits = ids
      .map(id => ({ id, others: studentClashesFor(day, slot, col, id) }))
      .filter(h => h.others.length)
    if (!hits.length) return
    const cellId = `${dayKey(day)}/${slot.key}/${col.roomName}`
    const places = [...new Set(hits.flatMap(h => h.others.map(o => o.where)))].join(' & ')
    setNotice({
      text: `${hits.map(h => chipName(h.id)).join(', ')} ${hits.length > 1 ? 'are' : 'is'} already in ${places} for ${whenLabel(day, slot)} — a student can attend only one class at a time.`,
      undo: () => hits.forEach(h => unstage(cellId, h.id)),
    })
  }

  const mentorClashesFor = (day, slot, col, hostId, cellId) => {
    if (!hostId) return []
    const hid = String(hostId)
    const [s, e] = slotWindow(day, slot)
    const out = []
    const seen = new Set()
    for (const c of active) {
      if (String(c.host?.userId || '') !== hid || c.room?.key === col.roomKey || !overlaps(c, s, e)) continue
      const k = trackKeyOf(c)
      if (!seen.has(k)) { seen.add(k); out.push({ where: classWhere(c) }) }
    }
    for (const p of pendingCells) {
      if (p.cellId === cellId || p.hostUserId !== hid || p.col.roomKey === col.roomKey) continue
      if (!sameSlot(p, day, slot)) continue
      const k = colKey(p.col)
      if (!seen.has(k)) { seen.add(k); out.push({ where: colWhere(p.col) }) }
    }
    return out
  }
  const mentorClashText = (name, list) =>
    `${name || 'This mentor'} is also teaching ${wheres(list)} at this time — a mentor can be in only one room.`

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
    if (!alreadyStaged) warnStudentClashes(day, slot, col, [id])
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
    setHallClip(null)
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
        warnStudentClashes(day, slot, col, toAdd)
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
        chapterId: '', unitId: '', planned: [],
      })
    } else {
      openSetup(day, slot, col)
    }
  }

  // ── FOCAS Hall ──
  // Hall sessions run at any time, not in the fixed slots, so the Hall view
  // lists only what is booked each day — no empty slot rows. Booking and
  // editing go through the page's Hall forms. Paste re-opens the booking form
  // pre-filled for another day, and the copy stays until cleared, so one
  // session can be pasted onto as many days as needed.
  const hallKeys = useMemo(() => new Set((hallRooms || []).map(r => r.key)), [hallRooms])
  const hallSessionsOn = (day) => active
    .filter(c => hallKeys.has(c.room?.key) && dayKey(new Date(c.scheduledStart)) === dayKey(day))
    .sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart))

  const copyHall = (c) => {
    const start = new Date(c.scheduledStart)
    setClipboard(null)
    setHallClip({
      from: `${c.track?.label || 'Hall'} · ${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${fmtClock(start)}`,
      fields: {
        title: c.title || '', description: c.description || '',
        sessionType: c.sessionType && c.sessionType !== 'class' ? c.sessionType : '',
        record: c.recordingWanted === true,
        hostUserId: c.host?.userId ? String(c.host.userId) : '',
        ...(c.room?.key && c.track?.key ? { trackSel: `${c.room.key}|${c.track.key}` } : {}),
        startTime: toTimeInput(start), endTime: toTimeInput(new Date(c.scheduledEnd)),
        students: (c.allowedStudents || []).map(String).map(id => {
          const s = byId.get(id)
          return { id, name: s?.name || '', phoneNumber: s?.phoneNumber || '' }
        }),
      },
    })
  }

  const pasteHall = (day) => {
    if (hallClip) onBookHall?.({ ...hallClip.fields, date: toDateInput(day) })
  }

  // Drop a student onto a Hall session — saved at once (Hall sessions skip the
  // staged Review & save, like the Who-can-join form). An empty list means the
  // session is open to everyone, so narrowing it to one student is confirmed.
  const dropOnHall = async (c, studentId) => {
    setOverCell(null); setDragId(null)
    if (!studentId || c.status !== 'scheduled' || hallSaving) return
    const current = (c.allowedStudents || []).map(String)
    if (current.includes(String(studentId))) return
    const name = byId.get(String(studentId))?.name || 'this student'
    if (!current.length && !window.confirm(
      `"${c.title}" is open to every student right now.\n\nAdd ${name} and limit it to the listed students only?`)) return
    setHallSaving(c._id); setError('')
    try {
      await saveWithClashCheck((extra) => apiFetch(`/api/live-classes/manage/${c._id}/students`, {
        method: 'PUT', body: JSON.stringify({ studentIds: [...current, String(studentId)], ...extra }),
      }))
      setOpenCells(o => ({ ...o, [`hall:${c._id}`]: true }))   // show who was just added
      await onChanged()
    } catch (err) {
      setError(err.message || 'Could not add the student')
    } finally {
      setHallSaving(null)
    }
  }

  // Taking the last student off a Hall session opens it to everyone — confirm that.
  const removeHallStudent = (c, studentId) => {
    if ((c.allowedStudents || []).length === 1 && !window.confirm(
      `${chipName(studentId)} is the only student on "${c.title}".\n\nRemove them and open the session to every student?`)) return
    removeSaved(c, studentId)
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

  // Cells that will become NEW classes on save, with the mentor each will get
  // (its own pick, or the room's locked mentor). Configured-but-empty cells
  // count too — the pick is just as real.
  const pendingCells = (() => {
    const out = []
    for (const cellId of new Set([...Object.keys(staged), ...Object.keys(newMeta)])) {
      const c = staged[cellId] || newMeta[cellId]
      if (!c?.col || !c?.day || !c?.slot) continue
      if (cellClass(c.day, c.slot, c.col)) continue
      const hostUserId = roomLockedHost(cellId, c)?.id || newMeta[cellId]?.hostUserId
      if (hostUserId) out.push({ cellId, day: c.day, slot: c.slot, col: c.col, hostUserId: String(hostUserId) })
    }
    return out
  })()

  // The classes in OTHER rooms (saved, or about to be) this mentor already has
  // at the same time. Both tracks of one classroom are fine — that's how
  // classrooms work.
  // One banner line per (day, slot, mentor) among the classes about to be made.
  const mentorGroups = (() => {
    const groups = new Map()
    for (const p of pendingCells) {
      const others = mentorClashesFor(p.day, p.slot, p.col, p.hostUserId, p.cellId)
      if (!others.length) continue
      const gk = `${dayKey(p.day)}/${p.slot.key}|${p.hostUserId}`
      const g = groups.get(gk) || { day: p.day, slot: p.slot, hostUserId: p.hostUserId, places: new Set() }
      g.places.add(colWhere(p.col))
      for (const o of others) g.places.add(o.where)
      groups.set(gk, g)
    }
    return [...groups.values()].map(g => ({ ...g, places: [...g.places].sort() }))
  })()

  const openReview = () => {
    // Prefill title + host for every cell that will become a NEW class.
    const meta = {}
    for (const [cellId, cell] of Object.entries(staged)) {
      if (!cellClass(cell.day, cell.slot, cell.col)) {
        const locked = roomLockedHost(cellId, cell)
        meta[cellId] = newMeta[cellId] || {
          title: `${cell.col.roomLabel} · ${cell.col.trackLabel} — ${cell.slot.name}`,
          hostUserId: locked ? locked.id : (mentorHosts[0]?.id ? String(mentorHosts[0].id) : ''),
        }
      }
    }
    setNewMeta(meta)
    setError('')
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
          await saveWithClashCheck((extra) => apiFetch(`/api/live-classes/manage/${existing._id}/students`, {
            method: 'PUT', body: JSON.stringify({ studentIds: merged, ...extra }),
          }), cellLabel(cell))
        } else {
          const meta = newMeta[cellId] || {}
          const locked = roomLockedHost(cellId, cell)
          const hostUserId = locked ? locked.id : meta.hostUserId
          if (!hostUserId) throw new Error('Pick a host')
          if (!meta.subjectId || !meta.chapterId) throw new Error('Pick a subject and chapter')
          const plannedErr = plannedItemsError(null, meta, meta.planned)
          if (plannedErr) throw new Error(plannedErr)
          const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.startHour)
          const end   = new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.endHour)
          await saveWithClashCheck((extra) => apiFetch('/api/live-classes/manage', {
            method: 'POST',
            body: JSON.stringify({
              title: (meta.title || '').trim() || `${col.roomLabel} · ${col.trackLabel}`,
              roomKey: col.roomKey, trackKey: col.trackKey,
              scheduledStart: start.toISOString(), scheduledEnd: end.toISOString(),
              hostUserId, studentIds: ids,
              subjectId: meta.subjectId, chapterId: meta.chapterId,
              unitId: meta.unitId || undefined,
              plannedItems: plannedPayload(meta.planned),
              ...extra,
            }),
          }), cellLabel(cell))
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

            {/* Program — Class / Workout Batch / … Combine with the paper,
                chapter and status pickers below for "Workout students who
                haven't finished chapter 2". */}
            <select value={progFilter} onChange={e => setProgFilter(e.target.value)}
              className={`w-full mt-2 px-2 py-1.5 text-xs border rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 ${
                progFilter ? 'border-indigo-400 bg-indigo-50 text-indigo-700 font-semibold' : 'border-gray-200 bg-white text-gray-600'}`}>
              <option value="">Any program</option>
              {programFilterOptions(programs).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            <select value={subjFilter}
              onChange={e => { setSubjFilter(e.target.value); setChapFilter(''); setUnitFilter(''); setStatusFilter('all') }}
              className="w-full mt-2 px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 bg-white text-gray-600">
              <option value="">Any subject</option>
              <SubjectOptions subjects={subjects} showGroup />
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
                ⚙ Advanced{activeConditions.length
                  ? ` · ${activeConditions.length > 1 ? describeFilter(advConditions, c => conditionComplete(c)) : 1}` : ''}
              </button>
              {activeViewId && (views || []).some(v => String(v._id) === activeViewId) && (
                <span className="text-[10px] font-semibold text-indigo-500 truncate">
                  {(views || []).find(v => String(v._id) === activeViewId)?.name}
                </span>
              )}
            </div>
            {advChecking && <p className="text-[10px] text-gray-400 mt-1">Checking chapter / subject progress…</p>}
            {advCheckFailed && (
              <p className="text-[10px] text-red-500 mt-1">Some completion checks failed — those conditions are ignored.</p>
            )}

            {(enrolFilter !== 'all' || progFilter || subjFilter || advConditions.length > 0) && (
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
                No students match this filter{(enrolFilter !== 'all' || progFilter || subjFilter) ? ' — try Clear filters' : ''}
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
                  {/* % topics done on each paper an Advanced "Subject
                      progress" row names — the number to schedule by. */}
                  {progressBadges.map(b => {
                    const p = subjectProgress[b.sid] instanceof Map ? subjectProgress[b.sid].get(String(s._id)) : null
                    if (!p) return null
                    const tone = p.percent >= 75 ? 'text-emerald-700 bg-emerald-50' : p.percent >= 50 ? 'text-amber-700 bg-amber-50' : 'text-rose-700 bg-rose-50'
                    return (
                      <span key={b.sid} className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${tone}`}
                        title={`${b.name}: ${p.done} of ${p.total} topics done (${p.percent}%)`}>
                        {b.short} {p.percent}%
                      </span>
                    )
                  })}
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
                  {programNames(s.programs, programs) && (
                    <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded flex-shrink-0 max-w-[80px] truncate"
                      title={`Program: ${programNames(s.programs, programs)}`}>
                      {programNames(s.programs, programs)}
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
                {[
                  ...(rooms || []).map(r => ({ key: r.key, label: r.label })),
                  ...((hallRooms || []).length ? [{ key: 'hall', label: hallRooms[0].label || 'FOCAS Hall' }] : []),
                  { key: 'all', label: (rooms || []).length > 2 ? 'All rooms' : 'Both rooms' },
                ].map(opt => {
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

                {!folded && activeRoom !== 'hall' && (
                  <div className="border-t border-gray-100 px-3 pb-3 pt-1 overflow-x-auto">
                    <table className="w-full border-separate table-fixed" style={{ borderSpacing: 6, minWidth: Math.max(460, 120 + visibleCols.length * 170) }}>
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
                                savedIds.some(id => studentClashesFor(day, slot, col, id).length > 0)
                              // While a student is being dragged, the cells
                              // outside their slot availability fade so the
                              // right ones stand out. The drop still works —
                              // whether to book them anyway is the admin's call.
                              const dragged = dragId ? byId.get(dragId) : null
                              const offSlot = !!dragged && !past && !isAvailableFor(dragged, day, slot.key)
                              // Dropping here would put them in a second class
                              // at the same time → the target goes red.
                              const clashDrop = !!dragged && !past && studentClashesFor(day, slot, col, dragId).length > 0
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
                                              more={savedPlannedNames(cls)}
                                              mentor={cls.host?.name} slotTitle={cls.title} live={cls.status === 'live'}
                                              mentorWarn={(() => {
                                                const mc = mentorClashesFor(day, slot, col, cls.host?.userId, cellId)
                                                return mc.length ? mentorClashText(cls.host?.name, mc) : ''
                                              })()}
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
                                                more={plannedNames(subj, m.planned)}
                                                mentor={hostName(m.hostUserId)}
                                                mentorWarn={(() => {
                                                  const mc = mentorClashesFor(day, slot, col, m.hostUserId, cellId)
                                                  return mc.length ? mentorClashText(hostName(m.hostUserId), mc) : ''
                                                })()}
                                                slotTitle={m.title || `${col.roomLabel} · ${col.trackLabel} — ${slot.name}`} />
                                            </button>
                                          )
                                        })()}
                                        <div className="flex flex-wrap gap-1">
                                          {(rosterOpen ? savedIds : []).map(id => {
                                            // Saved students are checked too, so an old
                                            // double booking (or a staged sibling drop)
                                            // shows up on both chips, not just the new one.
                                            const dup = studentClashesFor(day, slot, col, id)
                                            const dupTitle = dup.length
                                              ? `Also in ${wheres(dup)} at this time — a student can attend only one class at a time`
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
                                              ? `Also in ${wheres(dup)} at this time — a student can attend only one class at a time`
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

                {/* FOCAS Hall: only the sessions booked this day, in time order.
                    Its own view always shows the strip; All rooms shows it only
                    when there is something booked or a session to paste. */}
                {!folded && (() => {
                  const hallList = hallSessionsOn(day)
                  const hallView = activeRoom === 'hall'
                  if (!hallKeys.size || !(hallView || (activeRoom === 'all' && (hallList.length || hallClip)))) return null
                  const dayOver = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1) <= new Date()
                  return (
                    <div className="border-t border-gray-100 px-4 pb-3 pt-2">
                      {!hallView && (
                        <p className="text-[10px] font-bold text-violet-600 uppercase mb-1.5">📣 {hallRooms[0]?.label || 'FOCAS Hall'}</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {hallList.map(c => {
                          const n = (c.allowedStudents || []).length
                          const dropId = `hall:${c._id}`
                          const canDrop = c.status === 'scheduled'
                          return (
                            <div key={c._id}
                              onDragOver={e => { if (!canDrop) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOverCell(dropId) }}
                              onDragLeave={() => setOverCell(o => (o === dropId ? null : o))}
                              onDrop={e => { if (!canDrop) return; e.preventDefault(); dropOnHall(c, e.dataTransfer.getData('text/plain')) }}
                              className={`relative w-64 rounded-xl border shadow-sm pl-3 pr-2.5 py-2 transition-colors
                                ${overCell === dropId ? 'border-violet-500 bg-violet-50' : 'border-violet-200 bg-white'}
                                ${hallSaving === c._id ? 'opacity-60' : ''}`}>
                              <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-violet-500" />
                              <button type="button" onClick={() => copyHall(c)}
                                title="Copy this session — then paste it onto any other day"
                                className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center rounded-md bg-white/90 border border-gray-200 text-gray-400 hover:text-violet-600 hover:border-violet-300 text-[11px] leading-none">
                                ⧉
                              </button>
                              <button type="button" disabled={c.status !== 'scheduled'}
                                onClick={() => onEditClass?.(c)}
                                title={c.status === 'scheduled' ? 'Edit this session' : undefined}
                                className="block w-full text-left pr-6 disabled:cursor-default">
                                <p className="flex items-center gap-1.5 text-[11px] font-bold text-violet-700">
                                  {fmtClock(c.scheduledStart)} – {fmtClock(c.scheduledEnd)}
                                  {c.status === 'live' && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-1.5 py-px text-[9px] font-bold uppercase text-red-600">
                                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />live
                                    </span>
                                  )}
                                </p>
                                <p className="mt-0.5 text-[13px] font-semibold text-gray-900 leading-snug break-words">{c.title}</p>
                                <p className="mt-0.5 text-[11px] text-gray-500 truncate"
                                  title={`${c.track?.label || ''} · ${c.host?.name || ''}`}>
                                  {c.track?.label} · {c.host?.name || '—'}{c.recordingWanted ? ' · ⏺ rec' : ''}
                                </p>
                              </button>
                              {/* Who can join — same 👥 toggle + chips as a room slot. */}
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                {n ? (
                                  <button type="button"
                                    onClick={() => setOpenCells(o => ({ ...o, [dropId]: !o[dropId] }))}
                                    title={openCells[dropId] ? 'Hide students' : 'Show who can join'}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border bg-violet-50 border-violet-200 shrink-0">
                                    <span className="text-[10px] leading-none">👥</span>
                                    <span className="text-[13px] font-bold leading-none text-violet-700">{n}</span>
                                    <span className="text-[9px] leading-none text-gray-400">{openCells[dropId] ? '▾' : '▸'}</span>
                                  </button>
                                ) : (
                                  <span className="text-[10px] text-gray-400 italic">open to all</span>
                                )}
                                {(openCells[dropId] ? c.allowedStudents || [] : []).map(id => (
                                  <span key={String(id)}
                                    className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-700">
                                    {chipName(id)}
                                    {canDrop && (
                                      <button type="button" onClick={() => removeHallStudent(c, id)}
                                        title="Remove from this session"
                                        className="font-bold leading-none text-violet-400 hover:text-violet-800">×</button>
                                    )}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                        {!hallList.length && (
                          <p className="text-[11px] text-gray-400 italic py-1">No Hall sessions booked.</p>
                        )}
                      </div>
                      {!dayOver && (hallView || hallClip) && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {hallView && (
                            <button type="button" onClick={() => onBookHall?.({ date: toDateInput(day) })}
                              className="text-[11px] font-semibold text-violet-600 hover:text-violet-800 px-2.5 py-1 rounded-lg border border-dashed border-violet-200 hover:bg-violet-50">
                              ＋ Book Hall session
                            </button>
                          )}
                          {hallClip && (
                            <button type="button" onClick={() => pasteHall(day)}
                              title={`Paste "${hallClip.fields.title}" onto this day`}
                              className="text-[11px] font-semibold text-amber-600 hover:text-amber-800 px-2.5 py-1 rounded-lg border border-dashed border-amber-300 hover:bg-amber-50">
                              📋 Paste “{hallClip.fields.title || 'Hall session'}” here
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()}
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
      {hallClip && (
        <div className="fixed bottom-5 left-6 z-40 bg-white rounded-2xl shadow-xl border border-violet-200 px-4 py-3 flex items-center gap-3">
          <span className="text-xs text-gray-700">
            ⧉ Hall session <b>“{hallClip.fields.title || 'untitled'}”</b> copied
            <span className="text-gray-400"> from {hallClip.from}</span> — click 📋 on any day to paste
          </span>
          <button onClick={() => setHallClip(null)}
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
              title={clashes.groups.map(g => `${chipName(g.id)} · ${whenLabel(g.day, g.slot)} · ${g.places.join(' & ')}`).join('\n')}>
              ⚠ {clashes.groups.length} student{clashes.groups.length > 1 ? 's' : ''} in two classes at once
            </span>
          )}
          {mentorGroups.length > 0 && (
            <span className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded-lg"
              title={mentorGroups.map(g => `${hostName(g.hostUserId)} · ${whenLabel(g.day, g.slot)} · ${g.places.join(' & ')}`).join('\n')}>
              ⚠ {mentorGroups.length} mentor{mentorGroups.length > 1 ? 's' : ''} in two rooms at once
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
        const plannedErr = plannedItemsError(subj, setup, setup.planned)
        const ready = (locked || setup.hostUserId) && setup.subjectId && setup.chapterId && !plannedErr
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
                  {mentorHosts.map(h => <option key={h.id} value={String(h.id)}>{h.name}</option>)}
                  {locked && !(hosts || []).some(h => String(h.id) === locked.id) && (
                    <option value={locked.id}>{locked.name}</option>
                  )}
                </select>
                {locked && (
                  <p className="text-[10px] text-amber-600">
                    🔒 {setup.col.roomLabel} already has <b>{locked.name}</b> in this slot ({locked.from}) — one room uses one mentor.
                  </p>
                )}
                {(() => {
                  const hid = locked ? locked.id : setup.hostUserId
                  const mc = mentorClashesFor(setup.day, setup.slot, setup.col, hid, setup.cellId)
                  return mc.length > 0 && (
                    <p className="text-[11px] font-semibold text-red-600">⚠ {mentorClashText(hostName(hid), mc)}</p>
                  )
                })()}

                <select value={setup.subjectId}
                  onChange={e => patch({ subjectId: e.target.value, chapterId: '', unitId: '', planned: [] })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400">
                  <option value="">Subject…</option>
                  <SubjectOptions subjects={subjects} />
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
                <PlannedItemsPicker subject={subj} primary={setup}
                  value={setup.planned} onChange={planned => patch({ planned })} />
                {plannedErr && setup.planned?.length > 0 && (
                  <p className="text-[11px] font-semibold text-red-600">{plannedErr}</p>
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

            {/* Same student in two classes at once, or a mentor in two rooms at
                once — listed up top so it can't be missed, with the cells below
                carrying the detail. */}
            {clashes.groups.length > 0 && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
                <p className="text-xs font-bold text-red-700 mb-1">
                  ⚠ {clashes.groups.length} student{clashes.groups.length > 1 ? 's' : ''} booked into two classes at the same time
                </p>
                <ul className="text-[11px] text-red-700 space-y-0.5">
                  {clashes.groups.map((g, i) => (
                    <li key={i}>
                      <b>{chipName(g.id)}</b> · {whenLabel(g.day, g.slot)} · {g.places.join(' & ')}
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-red-600 mt-1.5">
                  A student can attend only one class at a time. Go Back and remove them from one (×), or confirm anyway.
                </p>
              </div>
            )}
            {mentorGroups.length > 0 && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
                <p className="text-xs font-bold text-red-700 mb-1">
                  ⚠ {mentorGroups.length} mentor{mentorGroups.length > 1 ? 's' : ''} booked in two rooms at the same time
                </p>
                <ul className="text-[11px] text-red-700 space-y-0.5">
                  {mentorGroups.map((g, i) => (
                    <li key={i}>
                      <b>{hostName(g.hostUserId)}</b> · {whenLabel(g.day, g.slot)} · {g.places.join(' & ')}
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-red-600 mt-1.5">
                  A mentor can switch between the two tracks of one room, but can't be in two rooms. Pick another mentor, or confirm anyway.
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
                      const places = [...new Set(dup.flatMap(id => clashes.byChip.get(`${cellId}|${id}`).map(d => d.where)))]
                      return (
                        <p className="text-[10px] text-red-600 mb-2">
                          ⚠ Also in {places.join(' & ')} at this time: {dup.map(chipName).join(', ')} — one student, one class.
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
                              <option value="">Select a mentor…</option>
                              {mentorHosts.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
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
                          {(() => {
                            const hid = locked ? locked.id : meta.hostUserId
                            const mc = mentorClashesFor(cell.day, cell.slot, cell.col, hid, cellId)
                            return mc.length > 0 && (
                              <p className="text-[10px] font-semibold text-red-600">⚠ {mentorClashText(hostName(hid), mc)}</p>
                            )
                          })()}
                          {/* What this class teaches: subject → chapter, unit optional */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <select value={meta.subjectId || ''}
                              onChange={e => setMeta({ subjectId: e.target.value, chapterId: '', unitId: '', planned: [] })}
                              className="px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400">
                              <option value="">Subject…</option>
                              <SubjectOptions subjects={subjects} />
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
                          <PlannedItemsPicker compact subject={subj} primary={meta}
                            value={meta.planned} onChange={planned => setMeta({ planned })} />
                          {(() => {
                            const err = plannedItemsError(subj, meta, meta.planned)
                            return err && <p className="text-[10px] font-semibold text-red-600">{err}</p>
                          })()}
                        </div>
                      )
                    })()}
                  </div>
                )
              })}
            </div>

            {/* A failed or declined save must show HERE — the page-level error
                line sits behind this window's overlay. */}
            {error && !saving && (
              <p role="status" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                ⚠ {error}
              </p>
            )}
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
          subjects={subjects} programs={programs} sittings={sittings}
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
  conditions, setConditions, subjects, programs, sittings, views, setViews,
  activeViewId, setActiveViewId, currentFilters, onApplyView, onClearAll,
  matchCount, onClose,
}) {
  const [viewName, setViewName] = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')

  const activeView = (views || []).find(v => String(v._id) === activeViewId) || null
  // Batch (exam sitting) choices: every sitting the roster's students have.
  const fields = withSittingOptions(FIELD_DEFS, 'attempt', sittings, conditions)


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
            <p className="text-[11px] text-gray-400">{matchCount} {matchCount === 1 ? 'match' : 'matches'} · conditions apply live</p>
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

          {/* Condition rows — AND / OR at every gap (components/ConditionList) */}
          <ConditionList conditions={conditions} setConditions={setConditions} fields={fields}
            subjects={subjects} programs={programs}
            isComplete={c => conditionComplete(c)} showProblems newFieldKey="name" />
          {!conditions.length && (
            <p className="text-[10px] text-gray-400">The quick filters above the roster still apply.</p>
          )}
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

// The slot time editor lives in components/SlotEditorModal.jsx — shared with
// the Users page so both places edit the same thing the same way.
