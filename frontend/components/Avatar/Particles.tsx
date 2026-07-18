'use client'

import { motion } from 'framer-motion'
import type { CortexStatus } from './types'

interface ParticlesProps {
  status: CortexStatus
}

export function Particles({ status }: ParticlesProps) {
  // Partículas não aparecem em estado offline
  if (status === 'offline') {
    return null
  }

  // Configurações por estado
  const getParticleConfig = () => {
    switch (status) {
      case 'idle':
        return { count: 6, speedRange: [20, 40], sizeRange: [2, 3] }
      case 'thinking':
        return { count: 5, speedRange: [15, 30], sizeRange: [2, 4] }
      case 'processing':
        return { count: 8, speedRange: [10, 20], sizeRange: [2, 4] }
      case 'talking':
        return { count: 4, speedRange: [25, 35], sizeRange: [1, 2] }
      case 'learning':
        return { count: 7, speedRange: [18, 32], sizeRange: [2, 3] }
      case 'error':
        return { count: 6, speedRange: [5, 10], sizeRange: [2, 4] }
      default:
        return { count: 6, speedRange: [20, 40], sizeRange: [2, 3] }
    }
  }

  const config = getParticleConfig()

  // Gera partículas com posições orbitais
  const particles = Array.from({ length: config.count }).map((_, i) => {
    const angle = (i * 360) / config.count
    const radius = 18 + (i % 3) * 2
    const duration = config.speedRange[0] + Math.random() * (config.speedRange[1] - config.speedRange[0])
    const size = config.sizeRange[0] + Math.random() * (config.sizeRange[1] - config.sizeRange[0])

    return { id: i, angle, radius, duration, size }
  })

  const particleColor = status === 'error' ? 'oklch(0.7 0.2 25)' : 'oklch(0.75 0.16 165)'

  return (
    <svg viewBox="0 0 48 48" className="absolute inset-0">
      <g transform="translate(24, 24)">
        {particles.map((p) => (
          <motion.circle
            key={p.id}
            r={p.size / 2}
            fill={particleColor}
            style={{ transformOrigin: '24px 24px' }}
            animate={{
              rotate: 360,
              opacity: [0.3, 0.7, 0.3],
            }}
            transition={{
              rotate: {
                duration: p.duration / 10,
                ease: 'linear' as const,
                repeat: Infinity,
              },
              opacity: {
                duration: p.duration / 10,
                ease: 'easeInOut' as const,
                repeat: Infinity,
              },
            }}
          />
        ))}
      </g>
    </svg>
  )
}