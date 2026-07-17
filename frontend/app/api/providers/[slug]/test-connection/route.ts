import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8082'

export async function GET(request: NextRequest, { params }: { params: { slug: string } }) {
  const authHeader = request.headers.get('authorization')

  try {
    const res = await fetch(`${BACKEND_URL}/me/providers/${params.slug}/test-connection`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {}),
      },
    })
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      return NextResponse.json(
        { error: error.detail || 'Erro ao testar conexão no backend' },
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