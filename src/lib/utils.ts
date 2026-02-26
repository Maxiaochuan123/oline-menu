import { type ClassValue, clsx } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

/**
 * 检测是否在微信浏览器中
 */
export function isWechat(): boolean {
  if (typeof window === 'undefined') return false
  return /micromessenger/i.test(navigator.userAgent)
}

/**
 * 格式化价格
 */
export function formatPrice(price: number): string {
  return `¥${price.toFixed(2)}`
}

/**
 * 计算倒计时文案
 */
export function getCountdown(targetTime: string): string {
  const target = new Date(targetTime).getTime()
  const now = Date.now()
  const diff = target - now

  if (diff <= 0) return '已到时间'

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 0) return `${hours}时${minutes}分`
  return `${minutes}分钟`
}

/**
 * 语音播报
 */
export function speak(text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'zh-CN'
  utterance.rate = 1
  utterance.pitch = 1
  window.speechSynthesis.speak(utterance)
}

/**
 * 获取手机号后四位
 */
export function lastFourDigits(phone: string): string {
  return phone.slice(-4)
}
