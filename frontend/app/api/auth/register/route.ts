import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8082'

export async function POST(request: NextRequest) {
  const body = await request.json()

  try {
    const res = await fetch(`${BACKEND_URL}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const data = await res.json().catch(() => ({}))
    
    if (!res.ok) {
      return NextResponse.json(
        { error: data.detail || 'Falha ao registrar usuário' },
        { status: res.status }
      )
    }

    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json(
      { error: 'Não foi possível conectar ao backend' },
      { status: 503 }
    )
  }
}