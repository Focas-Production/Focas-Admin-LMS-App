// Programs — what a student came to us for (Class, Workout Batch, …). The list
// is fixed in server code (server/utils/programs.js) and served by
// /api/admin/programs, so a new program needs no change here: every picker and
// filter reads that list. Students hold program KEYS ('class', 'workout').
//
// One shared fetch per page load.

import { useEffect, useState } from 'react'
import { apiFetch } from '../api'

let cache = null          // the list, once fetched
let inflight = null       // the fetch in progress

function load() {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = apiFetch('/api/admin/programs')
      .then(d => { cache = d.programs || []; return cache })
      .finally(() => { inflight = null })
  }
  return inflight
}

// null while loading; [] when the list can't be read (filters then just have
// no program options — nothing else breaks).
export function usePrograms() {
  const [list, setList] = useState(cache)
  useEffect(() => {
    let alive = true
    load().then(l => alive && setList(l)).catch(() => alive && setList(l => l || []))
    return () => { alive = false }
  }, [])
  return list
}

// "Class, Workout Batch" for a student's program keys, always in the list's
// order; '' when none. Keys not in the list (still loading) are skipped.
export function programNames(keys, programs) {
  const mine = new Set(keys || [])
  return (programs || []).filter(p => mine.has(p.key)).map(p => p.name).join(', ')
}

// Filter options for a program dropdown: every program (retired ones marked),
// then "No program set". Value 'none' matches the server's ?program=none.
export const NO_PROGRAM = 'none'
export function programFilterOptions(programs) {
  return [
    ...(programs || []).map(p => ({ value: p.key, label: p.active ? p.name : `${p.name} (retired)` })),
    { value: NO_PROGRAM, label: 'No program set' },
  ]
}

// Does this student match a program dropdown value ('' = any)?
export function matchesProgram(student, value) {
  if (!value) return true
  const mine = student.programs || []
  return value === NO_PROGRAM ? mine.length === 0 : mine.includes(value)
}

// Class status — Active / Inactive / Completed, for students holding the Class
// program only (User.classStatus; null = not set). Same keys as
// server/utils/programs.js CLASS_STATUSES. Set from the Users list.
export const CLASS_PROGRAM = 'class'
export const CLASS_STATUSES = [
  { key: 'active',    label: 'Active',    className: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  { key: 'inactive',  label: 'Inactive',  className: 'bg-gray-100 text-gray-600 border-gray-300', dot: 'bg-gray-400' },
  { key: 'completed', label: 'Completed', className: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
]
export const isClassStudent = (u) => !u.isAdmin && !u.isMentor && (u.programs || []).includes(CLASS_PROGRAM)
export const classStatusByKey = (key) => CLASS_STATUSES.find(s => s.key === key) || null

// Student status — how a Class student is doing / whether to chase them
// (User.studentStatus; null = not set). Class students only, admin-only. Same
// keys as server/utils/programs.js STUDENT_STATUSES.
export const STUDENT_STATUSES = [
  { key: 'top',          label: 'Top',             className: 'bg-amber-50 text-amber-700 border-amber-300', dot: 'bg-amber-500' },
  { key: 'follow_up',    label: 'Follow-up',       className: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
  { key: 'no_follow_up', label: 'No follow-up',    className: 'bg-gray-100 text-gray-600 border-gray-300', dot: 'bg-gray-400' },
]
export const studentStatusByKey = (key) => STUDENT_STATUSES.find(s => s.key === key) || null
