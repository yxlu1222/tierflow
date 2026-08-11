/*
Copyright (C) 2023-2026 TierFlow
*/
import { useEffect } from 'react'

/**
 * 全站固定单一亮色主题。
 *
 * 暗色主题已下线:不再有 cookie / 系统偏好 / 切换入口,也不再对外暴露 `useTheme`
 * ——所有组件与图表都直接按亮色渲染。本组件仅保证 <html> 始终带 `light` 类
 * (并移除历史遗留的 `dark` 类),使 `dark:` 工具类与 `.dark` CSS 块永不激活。
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('dark')
    root.classList.add('light')
  }, [])

  return <>{children}</>
}
