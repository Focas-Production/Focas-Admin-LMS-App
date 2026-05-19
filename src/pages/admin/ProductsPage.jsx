import { useState, useEffect } from 'react'
import { apiFetch } from '../../api'

const LEVEL_BADGE = {
  Foundation:    'bg-green-100 text-green-700',
  Intermediate:  'bg-yellow-100 text-yellow-700',
  Final:         'bg-purple-100 text-purple-700',
}

export default function ProductsPage() {
  const [products, setProducts] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    apiFetch('/api/admin/products')
      .then(d => setProducts(d.products || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Products</h1>
        <p className="text-gray-400 text-sm mt-0.5">{products.length} products</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading
          ? Array(6).fill(0).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-5 shadow-sm animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/2 mb-4" />
                <div className="h-6 bg-gray-100 rounded w-1/4" />
              </div>
            ))
          : products.map(p => (
              <div key={p._id} className="bg-white rounded-2xl p-5 shadow-sm">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-semibold text-gray-900 text-sm leading-snug">{p.name}</h3>
                  {p.level && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${LEVEL_BADGE[p.level] || 'bg-gray-100 text-gray-600'}`}>
                      {p.level}
                    </span>
                  )}
                </div>
                {p.category && <p className="text-xs text-gray-400 mb-3">{p.category}{p.subCategory ? ` · ${p.subCategory}` : ''}</p>}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {p.originalPrice && p.originalPrice > p.price && (
                      <span className="text-xs text-gray-400 line-through">₹{p.originalPrice.toLocaleString('en-IN')}</span>
                    )}
                    <span className="text-base font-bold text-indigo-600">₹{(p.price || 0).toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex gap-1.5">
                    {p.isCourse && <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">Course</span>}
                    {p.shipToHome && <span className="text-xs px-2 py-0.5 bg-orange-50 text-orange-600 rounded-full">Physical</span>}
                  </div>
                </div>
                {p.stock != null && (
                  <p className="text-xs text-gray-400 mt-2">Stock: <span className={p.stock <= 5 ? 'text-red-500 font-medium' : 'text-gray-600'}>{p.stock}</span></p>
                )}
              </div>
            ))
        }
      </div>
    </div>
  )
}
