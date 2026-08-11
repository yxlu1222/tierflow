/*
Copyright (C) 2023-2026 TierFlow
*/
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

/** Map an i18next language code to a registered dayjs locale name. */
export function dayjsLocale(language: string | undefined): string {
  return language?.toLowerCase().startsWith('zh') ? 'zh-cn' : 'en'
}

export default dayjs
