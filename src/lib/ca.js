// The CA curriculum vocabulary, shared by every admin screen that talks about
// what a student is enrolled for. Kept in one place so the Users page and the
// student progress report can never label the same group differently.

export const CA_LEVELS = ['Foundation', 'Intermediate', 'Final']

// Groups exist only for Intermediate and Final. 'both' is an enrollment choice,
// not a paper's group — a paper is always Group 1 or Group 2 (or unassigned).
export const CA_GROUPS = [
  { value: 'group1', label: 'Group 1' },
  { value: 'group2', label: 'Group 2' },
  { value: 'both',   label: 'Both groups' },
]

export const groupLabel = (g) => CA_GROUPS.find(x => x.value === g)?.label || ''

// ICAI sitting calendar: Foundation & Intermediate exams run thrice a year,
// Final twice. An attempt is one sitting, labelled 'Sep 2026'.
export const ATTEMPT_MONTHS = {
  Foundation:   ['Jan', 'May', 'Sep'],
  Intermediate: ['Jan', 'May', 'Sep'],
  Final:        ['May', 'Nov'],
}

const MONTH_INDEX = { Jan: 0, May: 4, Sep: 8, Nov: 10 }

// The sittings a student of `level` could currently be preparing for: every
// attempt from this month through the next `monthsAhead` months. Today (say
// Aug 2026) that is Sep 2026 / Jan 2027 / May 2027 / Sep 2027 for Intermediate
// and Nov 2026 / May 2027 / Nov 2027 for Final — the window rolls forward on
// its own, so nobody has to come back and add next year's dates.
export function upcomingAttempts(level, monthsAhead = 15) {
  const months = ATTEMPT_MONTHS[level]
  if (!months) return []
  const now = new Date()
  const out = []
  for (let year = now.getFullYear(); year <= now.getFullYear() + 2; year++) {
    for (const m of months) {
      const away = (year - now.getFullYear()) * 12 + MONTH_INDEX[m] - now.getMonth()
      if (away >= 0 && away <= monthsAhead) out.push(`${m} ${year}`)
    }
  }
  return out
}

// One line describing a student's enrolled scope, e.g. "Intermediate · Group 1
// · Sep 2026" or "Final · 2 papers". Empty when nothing has been set for them yet.
export function enrollmentLabel({ caLevel, caGroup, caSubjects, caAttempt } = {}) {
  const parts = []
  if (caLevel) parts.push(caLevel)
  const picked = caSubjects?.length || 0
  if (picked) parts.push(`${picked} paper${picked !== 1 ? 's' : ''}`)
  else if (caGroup) parts.push(groupLabel(caGroup))
  if (caAttempt) parts.push(caAttempt)
  return parts.join(' · ')
}
