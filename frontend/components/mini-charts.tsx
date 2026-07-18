'use client'

import { useId } from 'react'
import { cn } from '@/lib/utils'

/** Formata números grandes: 1240000 -> "1.24M" */
export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

interface SparklineProps {
  data: number[]
  className?: string
  width?: number
  height?: number
  /** Cor via CSS (ex: 'var(--primary)') */
  color?: string
}

/** Mini gráfico de linha com área preenchida, em SVG. */
export function Sparkline({
  data,
  className,
  width = 120,
  height = 36,
  color = 'var(--primary)',
}: SparklineProps) {
  const gradientId = useId()
  // Convert data to numbers (handle both number[] and object[])
  const numericData = (data as any[]).map((v) =>
    typeof v === 'number' ? v : (v?.value ?? 0)
  )
  const hasData = numericData.length > 0 && numericData.some((n) => n > 0)

  if (!hasData) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={cn('overflow-visible', className)}
        role="img"
        aria-label="Sem dados de consulta"
      >
        <line
          x1="0"
          y1={height - 1}
          x2={width}
          y2={height - 1}
          stroke="var(--border)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      </svg>
    )
  }

  const max = Math.max(...numericData)
  const min = Math.min(...numericData)
  const range = max - min || 1
  const stepX = width / (numericData.length - 1 || 1)

  const points = numericData.map((value, i) => {
    const x = i * stepX
    const y = height - ((value - min) / range) * (height - 4) - 2
    return [x, y] as const
  })

  const linePath = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')

  const areaPath =
    `${linePath} L${width},${height} L0,${height} Z`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      preserveAspectRatio="none"
      role="img"
      aria-label="Consultas por dia"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

interface MiniBarsProps {
  data: number[]
  className?: string
  color?: string
}

/** Mini gráfico de barras, para comparar consultas por dia. */
export function MiniBars({
  data,
  className,
  color = 'var(--primary)',
}: MiniBarsProps) {
  // Convert data to numbers (handle both number[] and object[])
  const numericData = (data as any[]).map((v) =>
    typeof v === 'number' ? v : (v?.value ?? 0)
  )
  const max = Math.max(...numericData, 1)
  return (
    <div
      className={cn('flex h-9 items-end gap-0.5', className)}
      role="img"
      aria-label="Consultas por dia"
    >
      {numericData.map((value, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm"
          style={{
            height: `${Math.max((value / max) * 100, 4)}%`,
            backgroundColor: color,
            opacity: 0.35 + (value / max) * 0.65,
          }}
        />
      ))}
    </div>
  )
}