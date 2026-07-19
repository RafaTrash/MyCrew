import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8082'

async function fetchWithAuth(req: NextRequest, path: string, init?: RequestInit) {
  const token = req.headers.get('authorization')

  // If no auth header, return unauthorized
  if (!token) {
    return NextResponse.json(
      { error: 'Token de autenticação não fornecido' },
      { status: 401 }
    )
  }

  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token,
        ...(init?.headers as Record<string, string>),
      },
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      return NextResponse.json(
        { error: error.detail || 'Erro ao comunicar com o backend' },
        { status: res.status }
      )
    }
    return NextResponse.json(await res.json())
  } catch (err) {
    return NextResponse.json(
      { error: 'Não foi possível conectar ao backend' },
      { status: 503 }
    )
  }
}

export async function GET(req: NextRequest) {
  return fetchWithAuth(req, '/knowledge')
}