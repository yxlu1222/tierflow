/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 全局固定外观常量。
 *
 * 用户级「界面样式自定义」(ConfigDrawer / theme-customization-provider)已移除,
 * 全站统一为单一外观:配色预设 `default`、圆角 `sm`。这里仅保留图表组件在计算
 * 圆角像素 / 缓存 key 时仍需引用的固定值,作为唯一真源。
 */
export const FIXED_THEME_PRESET = 'default'
export const FIXED_THEME_RADIUS = 'sm'
