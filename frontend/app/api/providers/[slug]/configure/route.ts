import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8082'

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const authHeader = request.headers.get('authorization')
  const body = await request.json()
  const { slug } = await params

  try {
    const res = await fetch(`${BACKEND_URL}/me/providers/${slug}/configure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {}),
      },
      body: JSON.stringify(body),
    })
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      return NextResponse.json(
        { error: error.detail || 'Erro ao configurar provedor no backend' },
        { status: res.status }
      )
    }
    
    const data = await res.json()
    return NextResponse.json(data, { status: 200 })
  } catch (err) {
    return NextResponse.json(
      { error: 'Não foi possível conectar ao backend' },
      { status: 503 }
    )
  }
}