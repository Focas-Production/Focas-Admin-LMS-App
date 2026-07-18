import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../api'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtINR(n) {
  if (n == null) return '—'
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`
  if (n >= 1000)   return `₹${(n / 1000).toFixed(1)}K`
  return `₹${Math.round(n)}`
}

function fmtDate(d) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// ── Date-range filter helpers ──────────────────────────────────────────────────

const toYMD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const today = () => toYMD(new Date())
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return toYMD(d) }
const monthsAgo = n => { const d = new Date(); d.setMonth(d.getMonth() - n); return toYMD(d) }

// Key a timeline row's { year, month, day } period for a given granularity.
function periodKey(p = {}, groupBy) {
  if (groupBy === 'year')  return `${p.year}`
  if (groupBy === 'month') return `${p.year}-${String(p.month).padStart(2,'0')}`
  return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`
}

// Build a continuous, gap-filled series of { label, revenue } across [from, to].
function buildBuckets(timeline, groupBy, from, to) {
  const map = {}
  for (const t of timeline || []) map[periodKey(t.period || t._id, groupBy)] = t.totalRevenue || 0

  const start = new Date(from), end = new Date(to)
  const out = []
  const cursor = new Date(start)

  if (groupBy === 'year') {
    for (let y = start.getFullYear(); y <= end.getFullYear(); y++)
      out.push({ label: `${y}`, revenue: map[`${y}`] || 0 })
  } else if (groupBy === 'month') {
    cursor.setDate(1)
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}`
      out.push({ label: cursor.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }), revenue: map[key] || 0 })
      cursor.setMonth(cursor.getMonth() + 1)
    }
  } else {
    cursor.setHours(0,0,0,0)
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`
      out.push({ label: fmtDate(cursor), revenue: map[key] || 0 })
      cursor.setDate(cursor.getDate() + 1)
    }
  }
  return out
}

// ── Mini Revenue Chart (SVG) ──────────────────────────────────────────────────

function RevenueChart({ data }) {
  const W = 480, H = 110, PL = 10, PR = 10, PT = 10, PB = 30
  const chartW = W - PL - PR
  const chartH = H - PT - PB
  const maxVal = Math.max(...data.map(d => d.revenue), 1)
  const denom = Math.max(data.length - 1, 1)   // avoid /0 when a single point
  const pts = data.map((d, i) => ({
    x: data.length === 1 ? PL + chartW / 2 : PL + (i / denom) * chartW,
    y: PT + chartH - (d.revenue / maxVal) * chartH,
    ...d,
  }))
  const polyline = pts.map(p => `${p.x},${p.y}`).join(' ')
  const area = `${pts[0].x},${PT + chartH} ${polyline} ${pts[pts.length - 1].x},${PT + chartH}`
  // Thin x-axis labels so they never overlap (~max 8 visible).
  const labelStep = Math.ceil(pts.length / 8)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {/* Grid lines */}
      {[0, 0.5, 1].map(t => (
        <line key={t}
          x1={PL} x2={W - PR}
          y1={PT + chartH - t * chartH} y2={PT + chartH - t * chartH}
          stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4 3" />
      ))}
      {/* Area fill */}
      <polygon points={area} fill="url(#grad)" opacity="0.25" />
      {/* Line */}
      <polyline points={polyline} fill="none" stroke="#4f46e5" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {/* Dots */}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={pts.length > 20 ? 2 : 3.5} fill="#4f46e5" stroke="white" strokeWidth={pts.length > 20 ? 1 : 2} />
      ))}
      {/* X labels (thinned to avoid overlap; show last only if it won't collide) */}
      {pts.map((p, i) => {
        const isLast = i === pts.length - 1
        const showLast = isLast && (pts.length - 1) % labelStep > labelStep / 2
        if (!(i % labelStep === 0 || showLast)) return null
        return (
          <text key={i} x={p.x} y={H - 6} textAnchor="middle" fontSize="9" fill="#9ca3af">
            {p.label}
          </text>
        )
      })}
      <defs>
        <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4f46e5" />
          <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, color, sub }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${color}`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value ?? '—'}</p>
      <p className="text-sm text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

// ── Source badge ──────────────────────────────────────────────────────────────

const SOURCE_STYLE = {
  website: 'bg-blue-100 text-blue-700',
  shopify: 'bg-green-100 text-green-700',
  combo:   'bg-purple-100 text-purple-700',
  custom:  'bg-orange-100 text-orange-700',
}

// ── Main Component ────────────────────────────────────────────────────────────

const RANGE_PRESETS = [
  { key: 'last7',    label: 'Last 7 days',  groupBy: 'day',   from: () => daysAgo(6) },
  { key: 'last30',   label: 'Last 30 days', groupBy: 'day',   from: () => daysAgo(29) },
  { key: 'thisMonth',label: 'This month',   groupBy: 'day',   from: () => toYMD(new Date(new Date().getFullYear(), new Date().getMonth(), 1)) },
  { key: 'last6mo',  label: 'Last 6 months',groupBy: 'month', from: () => monthsAgo(5) },
  { key: 'last12mo', label: 'Last 12 months',groupBy: 'month',from: () => monthsAgo(11) },
]

export default function AdminDashboard() {
  const navigate = useNavigate()
  const [summary,   setSummary]   = useState(null)
  const [chartData, setChartData] = useState([])
  const [rangeRevenue, setRangeRevenue] = useState(0)
  const [users,     setUsers]     = useState(0)
  const [products,  setProducts]  = useState(0)
  const [recent,    setRecent]    = useState([])
  const [loading,   setLoading]   = useState(true)
  const [chartLoading, setChartLoading] = useState(true)
  const [filters,   setFilters]   = useState({ dateFrom: daysAgo(6), dateTo: today(), source: '', groupBy: 'day' })

  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }))

  // Top cards + recent orders — all-time, loaded once.
  useEffect(() => {
    Promise.all([
      apiFetch('/api/admin/sales/summary'),
      apiFetch('/api/admin/users?limit=1'),
      apiFetch('/api/admin/products?limit=1'),
      apiFetch('/api/admin/purchases?limit=5'),
    ])
      .then(([sumRes, usrRes, prodRes, purchRes]) => {
        setSummary(sumRes)
        setUsers(usrRes.pagination?.total || 0)
        setProducts(prodRes.pagination?.total || 0)
        setRecent(purchRes.purchases || [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Revenue chart — refetches whenever the filters change.
  useEffect(() => {
    let alive = true
    const qs = new URLSearchParams({ groupBy: filters.groupBy })
    if (filters.dateFrom) qs.set('dateFrom', filters.dateFrom)
    if (filters.dateTo)   qs.set('dateTo',   filters.dateTo)
    if (filters.source)   qs.set('source',   filters.source)

    const sumQs = new URLSearchParams(qs); sumQs.delete('groupBy')

    Promise.all([
      apiFetch(`/api/admin/sales/timeline?${qs}`),
      apiFetch(`/api/admin/sales/summary?${sumQs}`),
    ])
      .then(([timeRes, sumRes]) => {
        if (!alive) return
        setChartData(buildBuckets(timeRes.timeline, filters.groupBy, filters.dateFrom, filters.dateTo))
        setRangeRevenue(sumRes?.totalRevenue || 0)
      })
      .catch(() => {})
      .finally(() => { if (alive) setChartLoading(false) })
    return () => { alive = false }
  }, [filters])

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Revenue"
          value={summary ? fmtINR(summary.totalRevenue) : '—'}
          color="bg-green-100"
          icon={<svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <StatCard
          label="Total Orders"
          value={summary?.totalOrders}
          color="bg-blue-100"
          icon={<svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>}
        />
        <StatCard
          label="Total Users"
          value={users}
          color="bg-purple-100"
          icon={<svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
        />
        <StatCard
          label="Total Products"
          value={products}
          color="bg-orange-100"
          icon={<svg className="w-5 h-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>}
        />
      </div>

      {/* Chart */}
      <div className="bg-white rounded-2xl p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="font-semibold text-gray-900">Revenue</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {filters.dateFrom} → {filters.dateTo} · {filters.groupBy === 'day' ? 'Daily' : filters.groupBy === 'month' ? 'Monthly' : 'Yearly'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Total in range</p>
            <p className="text-xl font-bold text-emerald-600">{fmtINR(rangeRevenue)}</p>
          </div>
        </div>

        {/* Presets */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {RANGE_PRESETS.map(p => {
            const active = filters.groupBy === p.groupBy && filters.dateFrom === p.from() && filters.dateTo === today()
            return (
              <button key={p.key}
                onClick={() => setFilters(f => ({ ...f, groupBy: p.groupBy, dateFrom: p.from(), dateTo: today() }))}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  active ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                {p.label}
              </button>
            )
          })}
        </div>

        {/* Custom filters */}
        <div className="flex flex-wrap items-end gap-3 mb-4 pb-4 border-b border-gray-100">
          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">From</label>
            <input type="date" value={filters.dateFrom} max={filters.dateTo}
              onChange={e => setFilter('dateFrom', e.target.value)}
              className="text-sm rounded-lg border border-gray-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">To</label>
            <input type="date" value={filters.dateTo} min={filters.dateFrom} max={today()}
              onChange={e => setFilter('dateTo', e.target.value)}
              className="text-sm rounded-lg border border-gray-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">Source</label>
            <select value={filters.source} onChange={e => setFilter('source', e.target.value)}
              className="text-sm rounded-lg border border-gray-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">All Sources</option>
              <option value="website">Website</option>
              <option value="shopify">Shopify</option>
              <option value="combo">Combo</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">Group by</label>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              {['day', 'month', 'year'].map(g => (
                <button key={g} onClick={() => setFilter('groupBy', g)}
                  className={`px-3 py-1.5 capitalize transition-colors ${
                    filters.groupBy === g ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                  }`}>
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>

        {chartLoading ? (
          <div className="h-28 bg-gray-50 rounded-xl animate-pulse" />
        ) : chartData.length === 0 ? (
          <p className="h-28 flex items-center justify-center text-sm text-gray-400">No sales in this range</p>
        ) : (
          <RevenueChart data={chartData} />
        )}
      </div>

      {/* Recent Purchases */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Recent Orders</h2>
          <button onClick={() => navigate('/admin/purchases')}
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
            View all →
          </button>
        </div>
        {loading ? (
          <div className="p-5 space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-10 bg-gray-50 rounded-xl animate-pulse" />)}
          </div>
        ) : recent.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-400">No orders yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left px-5 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Order</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Customer</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Source</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Amount</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Date</th>
              </tr>
            </thead>
            <tbody>
              {recent.map(p => {
                const amount = (p.items || []).reduce((s, i) => s + (i.amount || 0), 0)
                return (
                  <tr key={p._id} onClick={() => navigate('/admin/purchases')}
                    className="border-t border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors">
                    <td className="px-5 py-3 font-mono text-xs text-gray-600">{p.orderId?.slice(-10) || '—'}</td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-900 text-sm">{p.customerName || p.userId?.name || '—'}</p>
                      <p className="text-xs text-gray-400">{p.customerPhone || p.userId?.phoneNumber || ''}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SOURCE_STYLE[p.source] || 'bg-gray-100 text-gray-600'}`}>
                        {p.source}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-semibold text-gray-900">{fmtINR(amount)}</td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {new Date(p.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
