// Admin → Student Details. Every Foundation student and where their admission
// details stand (not started → submitted → checked). A row opens the check
// window (StudentDetailsModal). "Download Excel" exports the current filter.
// Backed by /api/admin/student-details.
import { useEffect, useState } from 'react'
import { apiFetch, authHeaders } from '../../api'
import StudentDetailsModal from '../../components/StudentDetailsModal'
import { STATUS_OPTIONS, STATUS_LABEL, STATUS_TONE, DOC_LABEL, DOC_STATUS, phoneForInput, fmtDate } from '../../lib/studentDetails'

const PAGE_SIZE = 25

export default function StudentDetailsPage() {
  const [rows, setRows] = useState([])
  const [counts, setCounts] = useState(null)
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState(null)
  const [reload, setReload] = useState(0)
  const [exporting, setExporting] = useState(false)

  // Search waits for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    const q = new URLSearchParams({ page, limit: PAGE_SIZE, ...(status && { status }), ...(search && { search }) })
    apiFetch(`/api/admin/student-details?${q}`)
      .then(d => { setRows(d.rows); setCounts(d.counts); setTotal(d.total); setError('') })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [page, status, search, reload])

  async function download() {
    setExporting(true)
    try {
      const q = new URLSearchParams({ ...(status && { status }), ...(search && { search }) })
      const res = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/student-details/export?${q}`, { headers: authHeaders() })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed')
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `foundation-student-details-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    } catch (e) { setError(e.message) } finally { setExporting(false) }
  }

  const all = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const chip = (key, label, n) => (
    <button key={key || 'all'} onClick={() => { setStatus(key); setPage(1) }}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${status === key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200'}`}>
      {label}{n != null && <span className="ml-1 opacity-70">{n}</span>}
    </button>
  )

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Student Details</h1>
          <p className="text-gray-400 text-sm mt-0.5">Foundation students' admission details and documents · click a row to check</p>
        </div>
        <div className="flex items-center gap-3">
          <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search name / phone"
            className="py-2 px-3 border border-gray-200 rounded-xl text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500" />
          <button onClick={download} disabled={exporting} className="py-2 px-4 rounded-xl border border-gray-200 bg-white text-sm font-semibold disabled:opacity-60">
            {exporting ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {chip('', 'All', counts ? all : null)}
        {STATUS_OPTIONS.map(s => chip(s.key, s.label, counts?.[s.key]))}
      </div>

      {error && <p className="text-sm text-rose-600 mb-3">{error}</p>}

      <div className="bg-white rounded-2xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
              <th className="px-4 py-3 font-medium">Student</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Parent</th>
              <th className="px-4 py-3 font-medium">School</th>
              <th className="px-4 py-3 font-medium">Documents</th>
              <th className="px-4 py-3 font-medium">Last change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading && !rows.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>}
            {!loading && !rows.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No students here</td></tr>}
            {rows.map(r => (
              <tr key={r.id} onClick={() => setOpenId(r.id)} className="hover:bg-gray-50 cursor-pointer">
                <td className="px-4 py-3">
                  <p className="font-semibold text-gray-900">{r.name || '—'}</p>
                  <p className="text-xs text-gray-400">{r.phone}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  {r.status === 'incomplete' && r.missing > 0 && <p className="text-[11px] text-gray-400 mt-1">{r.missing} missing</p>}
                </td>
                <td className="px-4 py-3">
                  <p className="text-gray-800">{r.parentName || '—'}</p>
                  <p className="text-xs text-gray-400">{phoneForInput(r.parentPhone)}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="text-gray-800">{r.school?.name || '—'}</p>
                  <p className="text-xs text-gray-400">{[r.school?.city, r.school?.boardLabel].filter(Boolean).join(' · ')}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(r.docs).map(([t, s]) => (
                      <span key={t} title={DOC_LABEL[t]} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${s ? DOC_STATUS[s].cls : 'bg-gray-50 text-gray-300'}`}>
                        {DOC_LABEL[t].split(' ')[0]} {s ? DOC_STATUS[s].label : '—'}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{r.updatedAt ? fmtDate(r.updatedAt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 mt-4 text-sm">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40">Prev</button>
          <span className="text-gray-500">Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40">Next</button>
        </div>
      )}

      {openId && <StudentDetailsModal studentId={openId} onClose={() => setOpenId(null)} onChanged={() => setReload(n => n + 1)} />}
    </div>
  )
}
