import { NextResponse } from 'next/server'
import type { CreateProviderPayload } from '@/lib/types'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8082'

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/providers`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      return NextResponse.json(
        { error: error.detail || 'Erro ao buscar provedores do backend' },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json(
      { error: 'Não foi possível conectar ao backend' },
      { status: 503 }
    )
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<CreateProviderPayload>

  if (!body.name || !body.slug) {
    return NextResponse.json(
      { error: 'Campos obrigatórios: name, slug.' },
      { status: 400 },
    )
  }

  try {
    const res = await fetch(`${BACKEND_URL}/providers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      return NextResponse.json(
        { error: error.detail || 'Erro ao criar provedor no backend' },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: 'Não foi possível conectar ao backend' },
      { status: 503 }
    )
  }
}