'use client'

import { motion } from 'framer-motion'
import type { CortexStatus } from './types'

interface OrbitRingProps {
  status: CortexStatus
  isOuter?: boolean
}

interface RingConfig {
  rotate: number
  duration: number
  direction: number
}

export function OrbitRing({ status, isOuter = false }: OrbitRingProps) {
  // Configurações de animação por estado
  const getAnimationConfig = (): { outer: RingConfig; inner: RingConfig } => {
    switch (status) {
      case 'idle':
        return {
          outer: { rotate: 360, duration: 20, direction: 1 },
          inner: { rotate: -360, duration: 12, direction: -1 },
        }
      case 'thinking':
        return {
          outer: { rotate: 360, duration: 15, direction: 1 },
          inner: { rotate: -360, duration: 8, direction: -1 },
        }
      case 'processing':
        return {
          outer: { rotate: 360, duration: 8, direction: 1 },
          inner: { rotate: -360, duration: 4, direction: -1 },
        }
      case 'talking':
        return {
          outer: { rotate: 360, duration: 12, direction: 1 },
          inner: { rotate: 360, duration: 10, direction: 1 },
        }
      case 'learning':
        return {
          outer: { rotate: 360, duration: 18, direction: 1 },
          inner: { rotate: 360, duration: 18, direction: 1 },
        }
      case 'offline':
      case 'error':
        return {
          outer: { rotate: 360, duration: 2, direction: 1 },
          inner: { rotate: 360, duration: 2, direction: -1 },
        }
      default:
        return {
          outer: { rotate: 360, duration: 20, direction: 1 },
          inner: { rotate: -360, duration: 12, direction: -1 },
        }
    }
  }

  const config = getAnimationConfig()
  const ringConfig = isOuter ? config.outer : config.inner

  // Cores e opacidades
  const getRingStyles = () => {
    if (status === 'offline') {
      return {
        stroke: 'oklch(0.5 0.05 165 / 0.2)',
        strokeWidth: 1,
      }
    }
    if (status === 'error') {
      return {
        stroke: 'oklch(0.7 0.2 25 / 0.6)',
        strokeWidth: 1.5,
      }
    }
    return isOuter
      ? {
          stroke: 'oklch(0.75 0.16 165 / 0.4)',
          strokeWidth: 1.5,
        }
      : {
          stroke: 'oklch(0.75 0.16 165 / 0.6)',
          strokeWidth: 1.5,
        }
  }

  const styles = getRingStyles()

  // Anéis com dashes diferentes
  const strokeDasharray = isOuter ? '3 2' : '2 2'
  const radius = isOuter ? 22 : 16

  const rotationAnimation = status === 'offline' 
    ? {} 
    : {
        rotate: ringConfig.direction >= 0 ? [0, 360] : [0, -360],
        transition: {
          duration: ringConfig.duration,
          ease: 'linear' as const,
          repeat: Infinity,
        },
      }

  return (
    <motion.svg
      viewBox="0 0 48 48"
      className="absolute inset-0"
      animate={rotationAnimation}
    >
      <circle
        cx="24"
        cy="24"
        r={radius}
        fill="none"
        stroke={styles.stroke}
        strokeWidth={styles.strokeWidth}
        strokeDasharray={strokeDasharray}
      />
    </motion.svg>
  )
}