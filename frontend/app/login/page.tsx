'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { Loader2, LogIn } from 'lucide-react'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const router = useRouter()
  const { login } = useAuth()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      await login(username, password)
      router.push('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao fazer login')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-card-foreground">MyCrew</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Entre com suas credenciais para continuar
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="username"
              className="text-sm font-medium text-card-foreground"
            >
              Usuário
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
              autoComplete="username"
              disabled={submitting}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              className="text-sm font-medium text-card-foreground"
            >
              Senha
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
              autoComplete="current-password"
              disabled={submitting}
            />
          </div>

          {error && (
            <p className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LogIn className="size-4" />
            )}
            Entrar
          </button>
        </form>

        <div className="mt-4 text-center text-xs text-muted-foreground">
          <p>Conta padrão: admin / admin123</p>
        </div>
      </div>
    </div>
  )
}