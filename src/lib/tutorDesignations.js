// Tutor designation — a mentor's pay grade (User.tutorDesignation; null = not
// set). Each grade has its own hourly rate in the server .env; the Action
// Center's cost-per-student check uses it. Same keys as
// server/utils/tutorDesignations.js.
export const TUTOR_DESIGNATIONS = [
  { key: 'junior', label: 'Junior Tutor', className: 'bg-sky-50 text-sky-700 border-sky-200',          dot: 'bg-sky-500' },
  { key: 'senior', label: 'Senior Tutor', className: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500' },
  { key: 'star',   label: 'Star Tutor',   className: 'bg-amber-50 text-amber-700 border-amber-300',    dot: 'bg-amber-500' },
]
