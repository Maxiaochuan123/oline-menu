import type { Order } from './types'

/**
 * 计算取消订单的动态违约金比例和文案说明
 *
 * 规则：
 * - 待确认 (pending) -> 0%
 * - 制作中 (preparing) ->
 *    - 接单 < 20分钟 -> 5%
 *    - 接单 >= 20分钟 -> 10% 起步，每超 10 分钟加 2%
 * - 配送中 (delivering) -> 协商处理（前端会拦截，此函数可返回特定标识）
 * - 已完成 (completed) -> 不可取消，走售后流程
 */
export function calculateCancellationPenalty(order: Order): { rate: number; reason: string; canCancel: boolean } {
  if (order.status === 'pending') {
    return { rate: 0, reason: '商家未接单，可免费取消', canCancel: true }
  }

  if (order.status === 'preparing') {
    if (!order.confirmed_at) {
      // 容错处理，如果状态不对称或者没有时间戳
      return { rate: 0.1, reason: '商家已开始备餐', canCancel: true }
    }

    const now = new Date()
    const confirmedTime = new Date(order.confirmed_at)
    const diffMinutes = (now.getTime() - confirmedTime.getTime()) / (1000 * 60)

    if (diffMinutes < 3) {
      return { rate: 0, reason: '商家已接单，3分钟内可极速免费取消', canCancel: true }
    }

    if (diffMinutes < 20) {
      return { rate: 0.05, reason: '已超过 3 分钟极速取消时段 (接单不满20分钟)，需承担 5% 食材损耗费', canCancel: true }
    }

    // 超过 20 分钟：基础 10%，超出部分每 10 分钟 + 2%
    let extraPeriods = Math.floor((diffMinutes - 20) / 10)
    if (extraPeriods < 0) extraPeriods = 0
    let rate = 0.10 + (extraPeriods * 0.02)
    
    // 违约金扣款封顶 80%
    if (rate > 0.8) {
      rate = 0.8
    }

    return { 
      rate, 
      reason: `商家备餐已进行 ${Math.floor(diffMinutes)} 分钟，需承担 ${(rate * 100).toFixed(0)}% 制作损耗费`, 
      canCancel: true 
    }
  }

  if (order.status === 'delivering') {
    // 按 80% 作为违约金计算 (跑腿费 + 餐品损耗)
    return { 
      rate: 0.8, 
      reason: '订单已在配送中，强制退单需扣除 80% 的餐品折损与跑腿费用。', 
      canCancel: true 
    }
  }

  return { rate: 1, reason: '订单已终结，请通过申请售后处理', canCancel: false }
}
