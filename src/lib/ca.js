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

// One line describing a student's enrolled scope, e.g. "Intermediate · Group 1"
// or "Final · 2 papers". Empty when nothing has been set for them yet.
export function enrollmentLabel({ caLevel, caGroup, caSubjects } = {}) {
  const parts = []
  if (caLevel) parts.push(caLevel)
  const picked = caSubjects?.length || 0
  if (picked) parts.push(`${picked} paper${picked !== 1 ? 's' : ''}`)
  else if (caGroup) parts.push(groupLabel(caGroup))
  return parts.join(' · ')
}
