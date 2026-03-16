import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPrice(price: number | string) {
  const p = typeof price === 'string' ? parseFloat(price) : price
  return '¥' + (isNaN(p) ? '0.00' : p.toFixed(2))
}

export function isWechat() {
  if (typeof window === 'undefined') return false
  return /MicroMessenger/i.test(window.navigator.userAgent)
}

export function isValidPhone(phone: string) {
  return /^1[3-9]\d{9}$/.test(phone)
}

export function getTimeAgo(date: string | Date | number) {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  const now = new Date()
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000)

  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}天前`
  
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

export function getCountdown(scheduledTime: string | Date | number) {
  const target = typeof scheduledTime === 'string' || typeof scheduledTime === 'number' ? new Date(scheduledTime) : scheduledTime
  const now = new Date()
  const diff = target.getTime() - now.getTime()
  
  if (diff <= 0) {
    return target.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) {
    return `${minutes}分钟后`
  }
  
  return target.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
export function lastFourDigits(phone?: string) {
  if (!phone) return '****'
  return phone.slice(-4)
}

export function speak(text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  
  // 先取消当前正在进行的播放，避免堆积
  window.speechSynthesis.cancel()
  
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'zh-CN'
  utterance.rate = 1.0
  utterance.pitch = 1.0
  
  window.speechSynthesis.speak(utterance)
}
