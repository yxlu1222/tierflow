/*
Copyright (C) 2023-2026 TierFlow
*/
import { useEffect, useRef } from 'react'

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  alpha: number
}

const PARTICLE_COLOR = '37, 99, 235'
const PARTICLE_COUNT = 44
const LINK_DISTANCE = 92

export function ApplianceParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = canvas?.parentElement
    if (!canvas || !container) return

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches
    const context = canvas.getContext('2d')
    if (!context) return

    let width = 0
    let height = 0
    let animationFrameId = 0
    let particles: Particle[] = []

    const createParticles = () => {
      const count = Math.max(
        18,
        Math.min(PARTICLE_COUNT, Math.floor(width / 12))
      )
      particles = Array.from({ length: count }, () => ({
        x: width * (0.28 + Math.random() * 0.72),
        y: height * (0.05 + Math.random() * 0.9),
        vx: reducedMotion ? 0 : (Math.random() - 0.5) * 0.14,
        vy: reducedMotion ? 0 : (Math.random() - 0.5) * 0.12,
        radius: 0.7 + Math.random() * 1.5,
        alpha: 0.2 + Math.random() * 0.48,
      }))
    }

    const resize = () => {
      const rect = container.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
      width = rect.width
      height = rect.height
      canvas.width = Math.max(1, Math.floor(width * pixelRatio))
      canvas.height = Math.max(1, Math.floor(height * pixelRatio))
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      createParticles()
    }

    const draw = () => {
      context.clearRect(0, 0, width, height)

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index]
        particle.x += particle.vx
        particle.y += particle.vy

        if (particle.x < width * 0.22 || particle.x > width) particle.vx *= -1
        if (particle.y < 0 || particle.y > height) particle.vy *= -1

        for (let next = index + 1; next < particles.length; next += 1) {
          const other = particles[next]
          const dx = particle.x - other.x
          const dy = particle.y - other.y
          const distance = Math.hypot(dx, dy)
          if (distance > LINK_DISTANCE) continue

          context.beginPath()
          context.moveTo(particle.x, particle.y)
          context.lineTo(other.x, other.y)
          context.strokeStyle = `rgba(${PARTICLE_COLOR}, ${
            (1 - distance / LINK_DISTANCE) * 0.13
          })`
          context.lineWidth = 0.7
          context.stroke()
        }

        context.beginPath()
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
        context.fillStyle = `rgba(${PARTICLE_COLOR}, ${particle.alpha})`
        context.fill()
      }

      if (!reducedMotion) animationFrameId = requestAnimationFrame(draw)
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    resize()
    draw()

    return () => {
      resizeObserver.disconnect()
      cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className='pointer-events-none absolute inset-0 h-full w-full'
      aria-hidden='true'
    />
  )
}
