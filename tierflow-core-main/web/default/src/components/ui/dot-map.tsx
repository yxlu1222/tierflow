/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * DotMap —— 世界地图点阵 + 路由连线动画(纯 Canvas,无外部依赖)。
 * 取自 travel-connect-signin 参考稿,用作 AuthLayout 左侧品牌面板背景。
 * 颜色用蓝色系,贴合品牌与浅色卡片。随父容器尺寸自适应(ResizeObserver)。
 */
import { useEffect, useRef, useState } from 'react'

type RoutePoint = { x: number; y: number; delay: number }
type Route = { start: RoutePoint; end: RoutePoint; color: string }

const ACCENT = '#2563eb'

const routes: Route[] = [
  { start: { x: 100, y: 150, delay: 0 }, end: { x: 200, y: 80, delay: 2 }, color: ACCENT },
  { start: { x: 200, y: 80, delay: 2 }, end: { x: 260, y: 120, delay: 4 }, color: ACCENT },
  { start: { x: 50, y: 50, delay: 1 }, end: { x: 150, y: 180, delay: 3 }, color: ACCENT },
  { start: { x: 280, y: 60, delay: 0.5 }, end: { x: 180, y: 180, delay: 2.5 }, color: ACCENT },
]

type Dot = { x: number; y: number; radius: number; opacity: number }

function generateDots(width: number, height: number): Dot[] {
  const dots: Dot[] = []
  const gap = 12
  const dotRadius = 1
  for (let x = 0; x < width; x += gap) {
    for (let y = 0; y < height; y += gap) {
      const isInMapShape =
        // North America
        (x < width * 0.25 && x > width * 0.05 && y < height * 0.4 && y > height * 0.1) ||
        // South America
        (x < width * 0.25 && x > width * 0.15 && y < height * 0.8 && y > height * 0.4) ||
        // Europe
        (x < width * 0.45 && x > width * 0.3 && y < height * 0.35 && y > height * 0.15) ||
        // Africa
        (x < width * 0.5 && x > width * 0.35 && y < height * 0.65 && y > height * 0.35) ||
        // Asia
        (x < width * 0.7 && x > width * 0.45 && y < height * 0.5 && y > height * 0.1) ||
        // Australia
        (x < width * 0.8 && x > width * 0.65 && y < height * 0.8 && y > height * 0.6)

      if (isInMapShape && Math.random() > 0.3) {
        dots.push({ x, y, radius: dotRadius, opacity: Math.random() * 0.5 + 0.2 })
      }
    }
  }
  return dots
}

export function DotMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !canvas.parentElement) return

    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setDimensions({ width, height })
      canvas.width = width
      canvas.height = height
    })

    resizeObserver.observe(canvas.parentElement)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    const { width, height } = dimensions
    if (!width || !height) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dots = generateDots(width, height)
    let animationFrameId: number
    let startTime = Date.now()

    const drawDots = () => {
      ctx.clearRect(0, 0, width, height)
      dots.forEach((dot) => {
        ctx.beginPath()
        ctx.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(37, 99, 235, ${dot.opacity})`
        ctx.fill()
      })
    }

    const drawRoutes = () => {
      const currentTime = (Date.now() - startTime) / 1000
      routes.forEach((route) => {
        const elapsed = currentTime - route.start.delay
        if (elapsed <= 0) return
        const progress = Math.min(elapsed / 3, 1)
        const x = route.start.x + (route.end.x - route.start.x) * progress
        const y = route.start.y + (route.end.y - route.start.y) * progress

        ctx.beginPath()
        ctx.moveTo(route.start.x, route.start.y)
        ctx.lineTo(x, y)
        ctx.strokeStyle = route.color
        ctx.lineWidth = 1.5
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(route.start.x, route.start.y, 3, 0, Math.PI * 2)
        ctx.fillStyle = route.color
        ctx.fill()

        ctx.beginPath()
        ctx.arc(x, y, 3, 0, Math.PI * 2)
        ctx.fillStyle = '#3b82f6'
        ctx.fill()

        ctx.beginPath()
        ctx.arc(x, y, 6, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(59, 130, 246, 0.4)'
        ctx.fill()

        if (progress === 1) {
          ctx.beginPath()
          ctx.arc(route.end.x, route.end.y, 3, 0, Math.PI * 2)
          ctx.fillStyle = route.color
          ctx.fill()
        }
      })
    }

    const animate = () => {
      drawDots()
      drawRoutes()
      if ((Date.now() - startTime) / 1000 > 15) startTime = Date.now()
      animationFrameId = requestAnimationFrame(animate)
    }
    animate()

    return () => cancelAnimationFrame(animationFrameId)
  }, [dimensions])

  return (
    <div className='relative h-full w-full overflow-hidden'>
      <canvas ref={canvasRef} className='absolute inset-0 h-full w-full' />
    </div>
  )
}
