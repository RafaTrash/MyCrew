'use client'

import { motion } from 'framer-motion'
import type { CortexStatus } from './types'

interface GlowProps {
  status: CortexStatus
}

export function Glow({ status }: GlowProps) {
  // Configuração de intensidade por estado
  const getGlowConfig = () => {
    switch (status) {
      case 'idle':
        return {
          opacity: [0.3, 0.5, 0.3],
          scale: [1, 1.1, 1],
          duration: 4,
        }
      case 'thinking':
        return {
          opacity: [0.5, 0.8, 0.5],
          scale: [1, 1.15, 1],
          duration: 2,
        }
      case 'processing':
        return {
          opacity: [0.7, 1, 0.7],
          scale: [1, 1.2, 1],
          duration: 1.5,
        }
      case 'talking':
        return {
          opacity: [0.4, 0.6, 0.4],
          scale: [1, 1.05, 1],
          duration: 1,
        }
      case 'learning':
        return {
          opacity: [0.6, 0.9, 0.6],
          scale: [1, 1.12, 1],
          duration: 2.5,
        }
      case 'offline':
        return {
          opacity: 0,
          scale: 1,
          duration: 0.3,
        }
      case 'error':
        return {
          opacity: [0.8, 1, 0.8],
          scale: 1,
          duration: 0.3,
        }
      default:
        return {
          opacity: [0.3, 0.5, 0.3],
          scale: [1, 1.1, 1],
          duration: 4,
        }
    }
  }

  const config = getGlowConfig()
  const glowColor = status === 'error' ? 'oklch(0.7 0.2 25)' : 'oklch(0.75 0.16 165)'
  const gradientId = `glowGradient-${status}`

  const glowVariants = status === 'offline'
    ? {
        opacity: 0,
        scale: 1,
      }
    : {
        opacity: config.opacity,
        scale: config.scale,
        transition: {
          duration: config.duration,
          ease: 'easeInOut' as const,
          repeat: Infinity,
        },
      }

  return (
    <motion.svg
      viewBox="0 0 48 48"
      className="absolute inset-0"
      initial={{ opacity: 0 }}
      animate={glowVariants}
    >
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={glowColor} stopOpacity={status === 'offline' ? 0 : 0.8} />
          <stop offset="100%" stopColor={glowColor} stopOpacity={0} />
        </radialGradient>
      </defs>

      <motion.circle
        cx="24"
        cy="24"
        r="24"
        fill={`url(#${gradientId})`}
      />
    </motion.svg>
  )
}