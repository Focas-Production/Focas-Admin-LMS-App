// Zoho-style advanced filtering for the scheduler's student roster.
//
// A filter is a list of condition rows, ANDed:
//   { id, field, op, value }
// The value shape depends on the field's kind:
//   text    → string
//   date    → { days } | { date } | { from, to }        (per operator)
//   enum    → array of option keys
//   subject → array of subjectId strings (any/all/none of them)
//   slot    → { slot, days }        days '' = on any day | 'weekdays' | 'weekends'
//   chapter → { subjectId, chapterId, unitId }   (the operator names the status)
//
// Everything here is pure: the async part (where every student stands on a
// chapter — the /api/admin/syllabus-completion buckets, { done, attended,
// allotted } sets) arrives via ctx.chapterSets, keyed by chapterConditionKey().
// A chapter condition whose buckets haven't landed yet is "not ready" and must
// not hide anyone — the board keeps students visible and shows a "checking…"
// note instead.

import { upcomingAttempts } from './ca'

export const CA_LEVELS = ['Foundation', 'Intermediate', 'Final']

// Every sitting a student could currently be targeting, across all levels,
// in calendar order — the union of the Jan/May/Sep and May/Nov windows. Built
// once per page load, so the list rolls forward with the ICAI calendar.
const ATTEMPT_MONTH_INDEX = { Jan: 0, May: 4, Sep: 8, Nov: 10 }
const ATTEMPT_OPTIONS = [...new Set([...upcomingAttempts('Intermediate'), ...upcomingAttempts('Final')])]
  .sort((a, b) => {
    const [ma, ya] = a.split(' '), [mb, yb] = b.split(' ')
    return (Number(ya) * 12 + ATTEMPT_MONTH_INDEX[ma]) - (Number(yb) * 12 + ATTEMPT_MONTH_INDEX[mb])
  })
  .map(a => ({ key: a, label: a }))

// The scheduler's four fixed periods, numbered 1–4 the way the tutoring sheet
// writes them ("Weekdays 1,4"). Keys mirror SLOTS in SchedulerBoard and the
// User model's enum; the order here is the day's order. Names are the time
// range itself so a class title reads "Room 1 · Track 1 — 6–9 AM Slot".
export const SLOT_OPTIONS = [
  { key: 'm1', num: 1, name: '6–9 AM Slot' },
  { key: 'm2', num: 2, name: '10 AM–1 PM Slot' },
  { key: 'af', num: 3, name: '2–5 PM Slot' },
  { key: 'ev', num: 4, name: '7–10 PM Slot' },
].map(o => ({ ...o, label: `Slot ${o.num} · ${o.name}` }))
export const SLOT_KEYS = SLOT_OPTIONS.map(o => o.key)
export const SLOT_NUM = Object.fromEntries(SLOT_OPTIONS.map(o => [o.key, o.num]))

// Availability is kept per day type — Mon–Fri and Sat–Sun — because a student
// comes on weekdays only, weekends only, or all seven days.
export const DAY_TYPES = [
  { key: 'weekdays', label: 'Weekdays', long: 'Weekdays (Mon–Fri)', short: 'Wkdy' },
  { key: 'weekends', label: 'Weekends', long: 'Weekends (Sat–Sun)', short: 'Wknd' },
]
export const dayTypeOf = (date) => {
  const d = new Date(date).getDay()
  return d === 0 || d === 6 ? 'weekends' : 'weekdays'
}

// The slots this student can attend on one day type, in slot order.
export function availableSlots(student, dayType) {
  const list = student?.slotAvailability?.[dayType] || []
  return SLOT_KEYS.filter(k => list.includes(k))
}
export const hasSlotAvailability = (student) =>
  availableSlots(student, 'weekdays').length > 0 || availableSlots(student, 'weekends').length > 0

// Can this student attend `slotKey` on `date`? Availability nobody has set
// yet is "unknown" rather than "no" — true — so the scheduler only fades cells
// when it actually knows better.
export function isAvailableFor(student, date, slotKey) {
  if (!hasSlotAvailability(student)) return true
  return availableSlots(student, dayTypeOf(date)).includes(slotKey)
}

// Which days the student comes on: 'weekdays' | 'weekends' | 'both' | null.
export function classDaysOf(student) {
  const wd = availableSlots(student, 'weekdays').length > 0
  const we = availableSlots(student, 'weekends').length > 0
  return wd && we ? 'both' : wd ? 'weekdays' : we ? 'weekends' : null
}

// Compact "All days 1,4" / "Wkdy 1,4 · Wknd 2" for chips and tooltips; null
// when nothing is set.
export function availabilityLabel(student) {
  const nums = (dayType) => availableSlots(student, dayType).map(k => SLOT_NUM[k]).join(',')
  const wd = nums('weekdays'), we = nums('weekends')
  if (!wd && !we) return null
  if (wd === we) return `All days ${wd}`
  return [wd && `Wkdy ${wd}`, we && `Wknd ${we}`].filter(Boolean).join(' · ')
}

// Does this student's enrollment cover this paper? Mirrors the server's scoping
// (utils/studentSyllabus.js subjectInScope): an explicit paper list is exact,
// otherwise level + group decide, and a paper with no group assigned yet counts
// for everyone in the level. Students with nothing set match no subject.
export function studiesSubject(student, subject) {
  const picked = (student.caSubjects || []).map(String)
  if (picked.length) return picked.includes(String(subject._id))
  if (!student.caLevel || student.caLevel !== subject.level) return false
  if (!student.caGroup || student.caGroup === 'both') return true
  return !subject.group || subject.group === student.caGroup
}

const TEXT_OPS = [
  { key: 'contains',     label: 'contains' },
  { key: 'not_contains', label: "doesn't contain" },
  { key: 'is',           label: 'is' },
  { key: 'isnt',         label: "isn't" },
  { key: 'starts',       label: 'starts with' },
  { key: 'empty',        label: 'is empty' },
  { key: 'not_empty',    label: 'is not empty' },
]
const DATE_OPS = [
  { key: 'last',    label: 'in the last' },
  { key: 'before',  label: 'before' },
  { key: 'after',   label: 'on or after' },
  { key: 'between', label: 'between' },
]
const ENUM_OPS = [
  { key: 'is',      label: 'is' },
  { key: 'isnt',    label: "isn't" },
  { key: 'not_set', label: 'is not set' },
]

// Ordered picker entries. `get` reads the raw value off the student where the
// field is a straight property; richer kinds evaluate in evalCondition.
export const FIELD_DEFS = [
  { key: 'name',       label: 'Name',            kind: 'text',    get: s => s.name },
  { key: 'phone',      label: 'Phone',           kind: 'text',    get: s => s.phoneNumber },
  { key: 'email',      label: 'Email',           kind: 'text',    get: s => s.email },
  { key: 'joined',     label: 'Joining date',    kind: 'date',    get: s => s.createdAt, ops: DATE_OPS },
  { key: 'lastLogin',  label: 'Last login',      kind: 'date',    get: s => s.activeSession?.lastLoginTime,
    ops: [...DATE_OPS, { key: 'never', label: 'never (no login yet)' }, { key: 'ever', label: 'at least once' }] },
  { key: 'level',      label: 'Level',           kind: 'enum',
    options: CA_LEVELS.map(l => ({ key: l, label: l })), get: s => s.caLevel },
  { key: 'group',      label: 'Group',           kind: 'enum',
    options: [{ key: 'group1', label: 'Group 1' }, { key: 'group2', label: 'Group 2' }, { key: 'both', label: 'Both groups' }],
    get: s => s.caGroup },
  { key: 'attempt',    label: 'Attempt',         kind: 'enum',
    options: ATTEMPT_OPTIONS, get: s => s.caAttempt },
  { key: 'enrolledFor', label: 'Enrolled for',   kind: 'enum',
    options: [{ key: 'group', label: 'Whole group' }, { key: 'subjects', label: 'Specific subjects' }, { key: 'none', label: 'Nothing yet' }],
    ops: ENUM_OPS.filter(o => o.key !== 'not_set'),
    get: s => (s.caSubjects || []).length ? 'subjects' : s.caLevel ? 'group' : 'none' },
  { key: 'subject',    label: 'Studies subject', kind: 'subject',
    ops: [
      { key: 'any',  label: 'includes any of' },
      { key: 'all',  label: 'includes all of' },
      { key: 'none', label: 'includes none of' },
    ] },
  { key: 'slot',       label: 'Slot availability', kind: 'slot',  ops: ENUM_OPS },
  { key: 'classDays',  label: 'Class days',      kind: 'enum',
    options: [{ key: 'weekdays', label: 'Weekdays only' }, { key: 'weekends', label: 'Weekends only' }, { key: 'both', label: 'All 7 days' }],
    get: classDaysOf },
  // One operator per rung of the per-student ladder the Progress pages show
  // (not allotted → allotted → attended → completed), plus the "at least"
  // supersets a scheduler actually asks for ("who still needs a class", "who
  // has sat one"). 'done' / 'not_done' are the original two, kept so saved
  // views keep working.
  { key: 'chapter',    label: 'Chapter status', kind: 'chapter',
    ops: [
      { key: 'not_done',      label: 'is not completed (any of the below)' },
      { key: 'not_allotted',  label: 'is not allotted — no class yet' },
      { key: 'allotted',      label: 'is allotted, not attended' },
      { key: 'attended',      label: 'is attended, not completed' },
      { key: 'done',          label: 'is completed' },
      { key: 'allotted_plus', label: 'has a class (allotted, attended or completed)' },
      { key: 'attended_plus', label: 'has attended (attended or completed)' },
    ] },
  { key: 'source',     label: 'Source',          kind: 'enum',
    options: [{ key: 'shopify', label: 'Shopify' }, { key: 'website', label: 'Website' }, { key: 'combo', label: 'Combo' }, { key: 'custom', label: 'Added by admin' }],
    get: s => s.source },
]

export const fieldDef = (key) => FIELD_DEFS.find(f => f.key === key) || null
export const opsFor = (def) => def.ops || (def.kind === 'text' ? TEXT_OPS : def.kind === 'enum' ? ENUM_OPS : [])

let nextId = 1
export function newCondition(fieldKey = 'name') {
  const def = fieldDef(fieldKey)
  const ops = opsFor(def)
  return {
    id: `c${Date.now()}_${nextId++}`,
    field: fieldKey,
    op: ops[0]?.key || 'is',
    value: def.kind === 'enum' || def.kind === 'subject' ? []
      : def.kind === 'slot' ? { slot: '', days: '' }
      : def.kind === 'chapter' ? { subjectId: '', chapterId: '', unitId: '' }
      : def.kind === 'date' ? {}
      : '',
  }
}

// Saved views from before the multi-pick subject upgrade carry a single id and
// the old operator names — normalise so old views keep working unchanged.
const SUBJECT_OP_ALIAS = { studies: 'any', not_studies: 'none' }
export const subjectIdsOf = (c) =>
  Array.isArray(c.value) ? c.value : c.value ? [String(c.value)] : []
export function normalizeCondition(c) {
  const kind = fieldDef(c.field)?.kind
  if (kind === 'subject') return { ...c, op: SUBJECT_OP_ALIAS[c.op] || c.op, value: subjectIdsOf(c) }
  // Slot rows saved while availability was per paper carried a subjectId;
  // nothing is per paper any more, so they become "that slot, on any day".
  if (kind === 'slot') return { ...c, value: { slot: c.value?.slot || '', days: c.value?.days || '' } }
  return c
}

export const chapterConditionKey = (c) =>
  `${c.value?.subjectId || ''}|${c.value?.chapterId || ''}|${c.value?.unitId || ''}`

// Has the admin filled the row in enough for it to act? Half-built rows are
// ignored rather than silently matching nobody.
export function conditionComplete(c) {
  const def = fieldDef(c.field)
  if (!def) return false
  switch (def.kind) {
    case 'text':
      return ['empty', 'not_empty'].includes(c.op) || !!String(c.value || '').trim()
    case 'date':
      if (['never', 'ever'].includes(c.op)) return true
      if (c.op === 'last') return Number(c.value?.days) > 0
      if (c.op === 'between') return !!c.value?.from && !!c.value?.to
      return !!c.value?.date
    case 'enum':
      return c.op === 'not_set' || (Array.isArray(c.value) && c.value.length > 0)
    case 'subject':
      return subjectIdsOf(c).length > 0
    case 'slot':
      return c.op === 'not_set' ? true : !!c.value?.slot
    case 'chapter':
      return !!c.value?.subjectId && !!c.value?.chapterId
    default:
      return false
  }
}

// The fetched buckets for one chapter/unit: exclusive rungs, as the server
// sends them. Anyone in none of the three is not allotted.
export const isChapterBuckets = (b) =>
  !!b && b.done instanceof Set && b.attended instanceof Set && b.allotted instanceof Set

export function chapterStatusOf(student, buckets) {
  const id = String(student._id)
  return buckets.done.has(id) ? 'done'
    : buckets.attended.has(id) ? 'attended'
    : buckets.allotted.has(id) ? 'allotted'
    : 'not_allotted'
}

// Chapter rows also need their buckets fetched before they may filter.
export function conditionReady(c, ctx) {
  if (fieldDef(c.field)?.kind !== 'chapter') return true
  return isChapterBuckets(ctx.chapterSets?.[chapterConditionKey(c)])
}

const dayStart = (ymd) => {
  const [y, m, d] = String(ymd).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1).getTime()
}
const DAY_MS = 24 * 60 * 60 * 1000

function evalDate(raw, c) {
  if (c.op === 'never') return !raw
  if (c.op === 'ever') return !!raw
  if (!raw) return false
  const t = new Date(raw).getTime()
  switch (c.op) {
    case 'last':    return t >= Date.now() - Number(c.value.days) * DAY_MS
    case 'before':  return t < dayStart(c.value.date)
    case 'after':   return t >= dayStart(c.value.date)
    case 'between': return t >= dayStart(c.value.from) && t < dayStart(c.value.to) + DAY_MS
    default:        return true
  }
}

function evalText(raw, c) {
  const v = String(raw || '').toLowerCase()
  const q = String(c.value || '').trim().toLowerCase()
  switch (c.op) {
    case 'contains':     return v.includes(q)
    case 'not_contains': return !v.includes(q)
    case 'is':           return v === q
    case 'isnt':         return v !== q
    case 'starts':       return v.startsWith(q)
    case 'empty':        return !v
    case 'not_empty':    return !!v
    default:             return true
  }
}

// ctx: { subjectsById: Map(id → subject doc),
//        chapterSets: { key → { done, attended, allotted: Set(userId) } | 'error' } }
// Incomplete rows pass everyone (see conditionComplete); not-ready chapter rows
// are the caller's job to surface — here they also pass everyone.
export function evalCondition(student, c, ctx) {
  if (!conditionComplete(c)) return true
  const def = fieldDef(c.field)
  switch (def.kind) {
    case 'text': return evalText(def.get(student), c)
    case 'date': return evalDate(def.get(student), c)
    case 'enum': {
      const raw = def.get(student) || null
      if (c.op === 'not_set') return !raw
      const inList = c.value.includes(raw)
      return c.op === 'is' ? inList : !inList
    }
    case 'subject': {
      const op = SUBJECT_OP_ALIAS[c.op] || c.op
      const docs = subjectIdsOf(c).map(id => ctx.subjectsById?.get(String(id))).filter(Boolean)
      if (!docs.length) return true   // every picked subject was deleted since the view was saved
      const hits = docs.filter(sub => studiesSubject(student, sub)).length
      return op === 'any' ? hits > 0
        : op === 'all' ? hits === docs.length
        : hits === 0
    }
    case 'slot': {
      // days '' = either day type counts; otherwise only the picked one.
      const types = c.value?.days ? [c.value.days] : DAY_TYPES.map(d => d.key)
      if (c.op === 'not_set') return types.every(t => !availableSlots(student, t).length)
      const match = types.some(t => availableSlots(student, t).includes(c.value.slot))
      return c.op === 'is' ? match : !match
    }
    case 'chapter': {
      const buckets = ctx.chapterSets?.[chapterConditionKey(c)]
      if (!isChapterBuckets(buckets)) return true   // still loading / errored — don't hide anyone
      const st = chapterStatusOf(student, buckets)
      switch (c.op) {
        case 'done':          return st === 'done'
        case 'not_done':      return st !== 'done'
        case 'attended':      return st === 'attended'
        case 'allotted':      return st === 'allotted'
        case 'not_allotted':  return st === 'not_allotted'
        case 'attended_plus': return st === 'attended' || st === 'done'
        case 'allotted_plus': return st !== 'not_allotted'
        default:              return true
      }
    }
    default: return true
  }
}
