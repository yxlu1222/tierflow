/*
Copyright (C) 2023-2026 TierFlow
*/

/**
 * 列表型表格(DataTablePage / unifiedLayout)的统一行高规格。
 *
 * 对齐 antd 默认 Table:14px 字号 / 22px 行高 / 16px 单元格内边距,
 * 即表头与数据行均为 16 + 22 + 16 = 54px。
 *
 * 仅适用于功能页的列表表格;设置页与弹窗内的紧凑型表格沿用
 * `components/ui/table.tsx` 的默认紧凑尺寸,不走这里。
 */
export const LIST_ROW_HEIGHT = 54

/** 数据行 `<tr>` 的最小高度 */
export const LIST_ROW_CLASS = 'h-[54px]'

/** 表头 `<th>` 的高度与内边距 */
export const LIST_HEAD_CLASS = 'h-[54px] px-4 leading-[22px]'

/** 数据单元格 `<td>` 的内边距与行高 */
export const LIST_CELL_CLASS = 'px-4 py-4 leading-[22px]'
