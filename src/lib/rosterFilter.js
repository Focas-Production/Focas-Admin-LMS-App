// Zoho-style advanced filtering for the scheduler's student roster.
//
// A filter is a list of condition rows, ANDed:
//   { id, field, op, value }
// The value shape depends on the field's kind:
//   text    → string
//   date    → { days } | { date } | { from, to }        (per operator)
//   enum    → array of option keys
//   subject → array of subjectId strings (any/all/none of them)
//   slot    → { slot, subjectId }   subjectId '' = any paper / their default
//   chapter → { subjectId, chapterId, unitId }
//
// Everything here is pure: the async part (who completed a chapter — the
// /api/admin/syllabus-completion sets) arrives via ctx.chapterSets, keyed by
// chapterConditionKey(). A chapter condition whose set hasn't landed yet is
// "not ready" and must not hide anyone — the board keeps students visible and
// shows a "checking…" note instead.

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

export const SLOT_OPTIONS = [
  { key: 'm1', label: 'Morning Slot 1 (6–9 AM)' },
  { key: 'm2', label: 'Morning Slot 2 (10 AM–1 PM)' },
  { key: 'af', label: 'Afternoon Slot (2–5 PM)' },
  { key: 'ev', label: 'Evening Slot (7–10 PM)' },
]
export const SLOT_SHORT = { m1: 'Mor 1', m2: 'Mor 2', af: 'Aft', ev: 'Eve' }

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

// The slot that applies to this student for one paper: their subject-specific
// row wins, else their default (subjectId null) row, else nothing.
export function effectiveSlot(student, subjectId) {
  const prefs = student.slotPreferences || []
  if (subjectId) {
    const specific = prefs.find(p => p.subjectId && String(p.subjectId) === String(subjectId))
    if (specific) return specific.slot
  }
  const def = prefs.find(p => !p.subjectId)
  return def ? def.slot : null
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
  { key: 'slot',       label: 'Slot time',       kind: 'slot',    ops: ENUM_OPS },
  { key: 'chapter',    label: 'Chapter completion', kind: 'chapter',
    ops: [{ key: 'done', label: 'completed' }, { key: 'not_done', label: 'not completed' }] },
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
      : def.kind === 'slot' ? { slot: '', subjectId: '' }
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
  if (fieldDef(c.field)?.kind !== 'subject') return c
  return { ...c, op: SUBJECT_OP_ALIAS[c.op] || c.op, value: subjectIdsOf(c) }
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

// Chapter rows also need their completion set fetched before they may filter.
export function conditionReady(c, ctx) {
  if (fieldDef(c.field)?.kind !== 'chapter') return true
  return ctx.chapterSets?.[chapterConditionKey(c)] instanceof Set
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

// ctx: { subjectsById: Map(id → subject doc), chapterSets: { key → Set(userId) } }
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
      const subjectId = c.value?.subjectId || ''
      if (c.op === 'not_set') {
        return subjectId ? !effectiveSlot(student, subjectId) : !(student.slotPreferences || []).length
      }
      const match = subjectId
        ? effectiveSlot(student, subjectId) === c.value.slot
        : (student.slotPreferences || []).some(p => p.slot === c.value.slot)
      return c.op === 'is' ? match : !match
    }
    case 'chapter': {
      const set = ctx.chapterSets?.[chapterConditionKey(c)]
      if (!(set instanceof Set)) return true   // still loading / errored — don't hide anyone
      const done = set.has(String(student._id))
      return c.op === 'done' ? done : !done
    }
    default: return true
  }
}
