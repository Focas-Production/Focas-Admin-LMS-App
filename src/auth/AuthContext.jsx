import { createContext, useContext, useState, useEffect } from 'react'
import { apiFetch } from '../api'

function isTokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.exp * 1000 < Date.now()
  } catch {
    return true
  }
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token  = localStorage.getItem('admin_token')
    const stored = localStorage.getItem('admin_user')
    if (!token || !stored || isTokenExpired(token)) {
      clear()
      setLoading(false)
      return
    }
    const parsed = JSON.parse(stored)
    if (!parsed.isAdmin) { clear(); setLoading(false); return }
    setUser(parsed)

    apiFetch('/api/auth/me')
      .then(fresh => {
        if (!fresh.isAdmin) { clear(); return }
        const updated = { ...fresh, id: fresh.id || parsed.id }
        persist(updated)
      })
      .catch(() => clear())
      .finally(() => setLoading(false))
  }, [])

  function persist(userData) {
    localStorage.setItem('admin_user', JSON.stringify(userData))
    setUser(userData)
  }

  function clear() {
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_user')
    setUser(null)
  }

  function login(userData, token) {
    localStorage.setItem('admin_token', token)
    persist(userData)
  }

  function logout() { clear() }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, setUser: persist }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
