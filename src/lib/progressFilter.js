// The admin Progress list's Advanced filter fields. Same condition rows as the
// live-class scheduler (lib/rosterFilter.js) and edited with the same row
// component, but CHECKED ON THE SERVER (server/utils/progressFilter.js) because
// the list is paged there — so every key, operator and option here must exist
// in that file's FIELDS too. Change both together.
//
// The whole filter is { conditions }, each row after the first carrying
// join: 'and' | 'or' — how it joins the row above. AND binds tighter than OR
// (A and B or C = (A and B) or C), so the rows fall into AND-groups split at
// every OR; the panel draws each group as a box. Only filled-in rows are sent.
import {
  fieldDef as rosterField, conditionComplete, normalizeCondition, SLOT_KEYS, DAY_TYPES, subjectProgressProblem,
  groupConditions, withSittingOptions,
} from './rosterFilter'
// AND / OR helpers live with the scheduler's filter (both pages use them).
export { JOINS, groupConditions, describeFilter, removeConditionAt } from './rosterFilter'

const DATE_OPS = [
  { key: 'last',    label: 'in the last' },
  { key: 'before',  label: 'before' },
  { key: 'after',   label: 'on or after' },
  { key: 'between', label: 'between' },
]

const pick = (key, patch = {}) => ({ ...rosterField(key), ...patch })

export const PROGRESS_FIELDS = [
  pick('studentStatus'),
  pick('classStatus'),
  // The list's "Joined" column — when the student's account was created.
  pick('joined', { label: 'Enrolment date (joined)' }),
  // When their current batch started — differs from Joined for repeaters.
  { key: 'batchStart', label: 'Current batch start', kind: 'date',
    ops: [...DATE_OPS, { key: 'never', label: 'has no batch yet' }] },
  pick('level'),
  // The exam sitting ('Jan 2027'). Options are the sittings students actually
  // have, filled in by withBatchOptions() from the server's list.
  { key: 'batch', label: 'Batch (exam sitting)', kind: 'enum', options: [], dynamicOptions: true },
  pick('group'),
  pick('subject', { label: 'Specific subject' }),
  pick('slot'),
  // One paper's "topics done" % — defined once in rosterFilter (the scheduler
  // uses the same field); worked out on the server (subjectProgressBatch.js).
  pick('subjectProgress'),
]

// Quick picks under the percent box.
export const PERCENT_PRESETS = [25, 50, 70, 100]

// PROGRESS_FIELDS with the Batch choices filled in (rosterFilter
// withSittingOptions — the scheduler's Batch uses the same).
export const withBatchOptions = (allBatches, conditions = []) =>
  withSittingOptions(PROGRESS_FIELDS, 'batch', allBatches, conditions)
export { sittingOver } from './rosterFilter'

export const isProgressCondition = (c) =>
  !!c && PROGRESS_FIELDS.some(f => f.key === c.field)

// Same limits as the server (server/utils/progressFilter.js).
export const MAX_CONDITIONS = 20
const MAX_DAYS = 3650

// A row that is filled in but can't be applied as typed — shown under the row
// and kept off the wire, so the server never has to refuse it. null = fine.
export function progressRowProblem(c) {
  const def = PROGRESS_FIELDS.find(f => f.key === c?.field)
  if (def?.kind === 'subjectProgress') return subjectProgressProblem(c)
  if (!def || def.kind !== 'date') return null
  if (c.op === 'last' && String(c.value?.days ?? '').trim() !== '') {
    const raw = String(c.value.days).trim()
    const n = /^\d+$/.test(raw) ? Number(raw) : NaN   // digits only, like the server
    if (!(n >= 1 && n <= MAX_DAYS)) return `Enter a whole number of days from 1 to ${MAX_DAYS}`
  }
  if (c.op === 'between' && c.value?.from && c.value?.to && c.value.from > c.value.to) {
    return 'The first date is after the second'
  }
  return null
}

// The value is the shape the server expects (server/utils/progressFilter.js
// parseCondition). The editor always builds the right shape; this guards rows
// that come back from storage or an old saved view.
const OBJECT_ID = /^[0-9a-f]{24}$/i
const isYmd = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''))
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}
function shapeOk(c) {
  const def = PROGRESS_FIELDS.find(f => f.key === c?.field)
  if (!def) return false
  const v = c.value
  switch (def.kind) {
    case 'enum':
      if (c.op === 'not_set') return true
      if (def.dynamicOptions) return Array.isArray(v) && v.length <= 50 && v.every(k => typeof k === 'string' && !!k.trim() && k.length <= 40)
      return Array.isArray(v) && v.every(k => def.options.some(o => o.key === k))
    case 'subject':
      return Array.isArray(v) && v.length <= 100 && v.every(id => typeof id === 'string' && OBJECT_ID.test(id))
    case 'slot':
      return !!v && typeof v === 'object' && (!v.days || DAY_TYPES.some(d => d.key === v.days))
        && (c.op === 'not_set' || SLOT_KEYS.includes(v.slot))
    case 'subjectProgress':
      return !!v && typeof v === 'object' && typeof v.subjectId === 'string' && OBJECT_ID.test(v.subjectId)
    case 'date':
      if (c.op === 'never' || c.op === 'last') return true   // days checked by progressRowProblem
      if (c.op === 'between') return isYmd(v?.from) && isYmd(v?.to)
      return isYmd(v?.date)
    default:
      return false
  }
}

export const progressConditionComplete = (c) =>
  conditionComplete(c, PROGRESS_FIELDS) && shapeOk(c) && !progressRowProblem(c)

// A saved view or stored state → a clean filter. Rows on fields this page no
// longer offers are dropped rather than sent to a server that would refuse them.
// Options that no longer exist (a retired status, a mangled subject id) are
// dropped from a stored row so the rest of it still works.
function cleanValue(c) {
  const def = PROGRESS_FIELDS.find(f => f.key === c.field)
  if (def?.kind === 'enum' && def.dynamicOptions && Array.isArray(c.value)) return { ...c, value: c.value.filter(k => typeof k === 'string' && k.trim() && k.length <= 40).slice(0, 50) }
  if (def?.kind === 'enum' && Array.isArray(c.value)) return { ...c, value: c.value.filter(k => def.options.some(o => o.key === k)) }
  if (def?.kind === 'enum') return { ...c, value: [] }
  if (def?.kind === 'subject') return { ...c, value: (Array.isArray(c.value) ? c.value : []).filter(id => typeof id === 'string' && OBJECT_ID.test(id)) }
  if (def?.kind === 'date' && (!c.value || typeof c.value !== 'object')) return { ...c, value: {} }
  if (def?.kind === 'subjectProgress') {
    const v = c.value && typeof c.value === 'object' ? c.value : {}
    const str = (x) => (typeof x === 'number' || typeof x === 'string' ? String(x) : '')
    return { ...c, value: { subjectId: typeof v.subjectId === 'string' && OBJECT_ID.test(v.subjectId) ? v.subjectId.toLowerCase() : '', percent: str(v.percent), min: str(v.min), max: str(v.max) } }
  }
  return c
}

// Views saved before per-row joins carry one `match: 'all' | 'any'` for every
// gap — a row without its own join takes that.
export function normalizeProgressFilter(raw) {
  const fallback = raw?.match === 'any' ? 'or' : 'and'
  const conditions = (Array.isArray(raw?.conditions) ? raw.conditions : [])
    .filter(isProgressCondition)
    .slice(0, MAX_CONDITIONS)
    .map((c, k) => ({
      ...cleanValue(normalizeCondition(c, PROGRESS_FIELDS)),
      // Rows are edited and removed by id; a hand-made or damaged row without
      // a unique one would make every edit hit several rows.
      id: typeof c.id === 'string' && c.id ? c.id : `r${Date.now()}_${k}`,
      join: c.join === 'or' || c.join === 'and' ? c.join : fallback,
    }))
  const seen = new Set()
  for (const c of conditions) {
    if (seen.has(c.id)) c.id = `${c.id}_${seen.size}`
    seen.add(c.id)
  }
  return { conditions }
}

// What goes on the wire as ?adv= — '' when no row is filled in yet.
// Built box by box (the AND-groups the admin sees): half-built rows drop out
// of their box, an emptied box drops out whole, and the boxes are rejoined
// with OR — so an unfinished row never moves another row into a different box.
export function serializeProgressFilter({ conditions }) {
  const ready = groupConditions(conditions)
    .map(g => g.map(x => x.c).filter(progressConditionComplete))
    .filter(g => g.length)
    .flatMap(g => g.map(({ field, op, value }, k) => ({
      field, op, join: k === 0 ? 'or' : 'and',
      value: wireValue(field, op, value),
    })))
  return ready.length ? JSON.stringify({ conditions: ready }) : ''
}

// The boxes are free text; the server wants numbers, and only the keys the
// operator uses.
function wireValue(field, op, value) {
  if (op === 'last') return { days: Number(String(value.days).trim()) }
  if (field === 'subjectProgress') {
    const n = (x) => Number(String(x).trim())
    if (op === 'between') return { subjectId: value.subjectId, min: n(value.min), max: n(value.max) }
    if (op === 'below' || op === 'at_least') return { subjectId: value.subjectId, percent: n(value.percent) }
    return { subjectId: value.subjectId }
  }
  return value
}

// Subject progress rows on screen — the list shows one % column per paper.
export const progressSubjectIds = (conditions) =>
  [...new Set(conditions.filter(c => c.field === 'subjectProgress' && progressConditionComplete(c)).map(c => c.value.subjectId.toLowerCase()))]

