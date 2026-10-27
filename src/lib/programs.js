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
