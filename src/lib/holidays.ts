import { format } from "date-fns"

/**
 * 节日助手 - 支持公历循环判断 + 2024-2026 农历校正
 * duration: 建议的优惠券有效期 (天)
 */
export const SOLAR_HOLIDAYS: Record<string, { name: string, duration: number }> = {
  "01-01": { name: "元旦", duration: 1 },
  "02-14": { name: "情人节", duration: 1 },
  "03-08": { name: "妇女节", duration: 1 },
  "05-01": { name: "劳动节", duration: 5 },
  "06-01": { name: "儿童节", duration: 1 },
  "08-01": { name: "建军节", duration: 1 },
  "10-01": { name: "国庆节", duration: 7 },
  "12-25": { name: "圣诞节", duration: 1 },
}

export const LUNAR_HOLIDAYS: Record<string, { name: string, duration: number }> = {
  // 2024
  "2024-02-10": { name: "春节", duration: 7 },
  "2024-02-24": { name: "元宵", duration: 1 },
  "2024-06-10": { name: "端午", duration: 3 },
  "2024-08-10": { name: "七夕", duration: 1 },
  "2024-09-17": { name: "中秋", duration: 3 },
  // 2025
  "2025-01-29": { name: "春节", duration: 7 },
  "2025-02-12": { name: "元宵", duration: 1 },
  "2025-05-31": { name: "端午", duration: 3 },
  "2025-08-29": { name: "七夕", duration: 1 },
  "2025-10-06": { name: "中秋", duration: 3 },
  // 2026
  "2026-02-17": { name: "春节", duration: 7 },
  "2026-03-03": { name: "元宵", duration: 1 },
  "2026-06-19": { name: "端午", duration: 3 },
  "2026-08-19": { name: "七夕", duration: 1 },
  "2026-09-25": { name: "中秋", duration: 3 },
}

export function getHoliday(date: Date): string | null {
  const mmdd = format(date, "MM-dd")
  const yyyymmdd = format(date, "yyyy-MM-dd")
  if (SOLAR_HOLIDAYS[mmdd]) return SOLAR_HOLIDAYS[mmdd].name
  return LUNAR_HOLIDAYS[yyyymmdd]?.name || null
}

export function getHolidayInfo(date: Date) {
  const mmdd = format(date, "MM-dd")
  const yyyymmdd = format(date, "yyyy-MM-dd")
  return SOLAR_HOLIDAYS[mmdd] || LUNAR_HOLIDAYS[yyyymmdd] || null
}
