/*
Copyright (C) 2023-2026 TierFlow
*/
const browserDpr =
  typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2)

export const VCHART_OPTION = {
  // 与老前端保持一致（浏览器环境渲染优化）
  mode: 'desktop-browser',
  autoFit: true,
  autoRefreshDpr: false,
  dpr: browserDpr,
  animation: false,
  resizeDelay: 80,
} as const
