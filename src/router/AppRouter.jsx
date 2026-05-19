import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import ProtectedRoute from './ProtectedRoute'

import LoginPage from '../auth/LoginPage'
import AdminLayout from '../layouts/AdminLayout'
import AdminDashboard from '../pages/admin/AdminDashboard'
import UsersPage from '../pages/admin/UsersPage'
import ProductsPage from '../pages/admin/ProductsPage'
import PurchasesPage from '../pages/admin/PurchasesPage'
import ContentPage from '../pages/admin/ContentPage'

function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) return null
  return <Navigate to={user ? '/admin' : '/login'} replace />
}

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/"      element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />

      <Route path="/admin" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
        <Route index          element={<AdminDashboard />} />
        <Route path="users"    element={<UsersPage />} />
        <Route path="products"  element={<ProductsPage />} />
        <Route path="purchases" element={<PurchasesPage />} />
        <Route path="content"   element={<ContentPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
