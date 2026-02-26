/**
 * 违约金计算逻辑
 *
 * 规则：
 * - 下单后 30 分钟内取消：免违约金
 * - 超过 30 分钟：每小时（不足 1 小时按 1 小时算）收取订单金额的 2%
 * - 违约金封顶：订单金额的 10%
 */

export interface PenaltyResult {
  /** 是否需要违约金 */
  hasPenalty: boolean
  /** 违约金比例（0 ~ 0.10） */
  penaltyRate: number
  /** 违约金金额 */
  penaltyAmount: number
  /** 退款金额 */
  refundAmount: number
  /** 提示文案 */
  message: string
}

export function calculatePenalty(
  orderAmount: number,
  orderCreatedAt: Date,
  cancelTime: Date = new Date()
): PenaltyResult {
  const diffMs = cancelTime.getTime() - orderCreatedAt.getTime()
  const diffMinutes = diffMs / (1000 * 60)

  // 30 分钟内免违约金
  if (diffMinutes <= 30) {
    return {
      hasPenalty: false,
      penaltyRate: 0,
      penaltyAmount: 0,
      refundAmount: orderAmount,
      message: '取消成功，全额退款。',
    }
  }

  // 超过 30 分钟，计算超出部分的小时数（向上取整）
  const overtimeMinutes = diffMinutes - 30
  const overtimeHours = Math.ceil(overtimeMinutes / 60)

  // 每小时 2%，封顶 10%
  const rawRate = overtimeHours * 0.02
  const penaltyRate = Math.min(rawRate, 0.1)

  const penaltyAmount = Math.round(orderAmount * penaltyRate * 100) / 100
  const refundAmount = Math.round((orderAmount - penaltyAmount) * 100) / 100

  return {
    hasPenalty: true,
    penaltyRate,
    penaltyAmount,
    refundAmount,
    message: `下单已超过 30 分钟，取消需支付 ${(penaltyRate * 100).toFixed(0)}% 违约金 ¥${penaltyAmount.toFixed(2)}，退款 ¥${refundAmount.toFixed(2)}。`,
  }
}
