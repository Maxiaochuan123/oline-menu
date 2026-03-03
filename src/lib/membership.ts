// ============================================
// VIP 会员等级 & 优惠券核心逻辑
// ============================================

import type { Coupon, CartItem } from './types'

export interface VipLevel {
  level: number        // 0~5
  label: string        // "LV0" ~ "LV5"
  description: string  // 等级名称描述
  rate: number         // 折扣率 0.85~1.0
  discount: string     // 展示文案 "85折"
  minPoints: number    // 达到该等级所需最低积分
  maxPoints: number    // 下一级所需积分（-1 表示无上限）
  color: string        // 等级主题色
}

/** VIP 等级配置表 */
export const VIP_LEVELS: VipLevel[] = [
  {
    level: 0,
    label: 'LV0',
    description: '新朋友',
    rate: 1.0,
    discount: '原价',
    minPoints: 0,
    maxPoints: 99,
    color: '#9ca3af',
  },
  {
    level: 1,
    label: 'LV1',
    description: '铜牌会员',
    rate: 0.98,
    discount: '98折',
    minPoints: 100,
    maxPoints: 200,
    color: '#22c55e',
  },
  {
    level: 2,
    label: 'LV2',
    description: '银牌会员',
    rate: 0.95,
    discount: '95折',
    minPoints: 201,
    maxPoints: 500,
    color: '#3b82f6',
  },
  {
    level: 3,
    label: 'LV3',
    description: '金牌会员',
    rate: 0.92,
    discount: '92折',
    minPoints: 501,
    maxPoints: 1000,
    color: '#8b5cf6',
  },
  {
    level: 4,
    label: 'LV4',
    description: '铂金会员',
    rate: 0.88,
    discount: '88折',
    minPoints: 1001,
    maxPoints: 3000,
    color: '#f59e0b',
  },
  {
    level: 5,
    label: 'LV5',
    description: '钻石会员',
    rate: 0.85,
    discount: '85折',
    minPoints: 3001,
    maxPoints: -1,
    color: '#ef4444',
  },
]

/**
 * 根据积分获取 VIP 等级信息
 */
export function getVipLevel(points: number): VipLevel {
  if (points >= 3001) return VIP_LEVELS[5]
  if (points >= 1001) return VIP_LEVELS[4]
  if (points >= 501)  return VIP_LEVELS[3]
  if (points >= 201)  return VIP_LEVELS[2]
  if (points >= 100)  return VIP_LEVELS[1]
  return VIP_LEVELS[0]
}

/**
 * 计算订单折扣金额
 * - 先算 VIP 折扣，再在折后价上减优惠券（支持多张叠加）
 */
export function calcDiscount(params: {
  originalAmount: number
  points: number
  couponAmount?: number    // 单张券面值（向后兼容）
  couponMinSpend?: number  // 单张券门槛（向后兼容）
  couponAmounts?: { amount: number; minSpend: number }[]  // 多张券叠加
}): {
  vipLevel: VipLevel
  vipDiscountAmount: number   // VIP 减免金额
  couponDiscountAmount: number // 优惠券减免金额（总计）
  finalAmount: number          // 实付金额
} {
  const { originalAmount, points, couponAmount = 0, couponMinSpend = 0, couponAmounts } = params

  // 先计算 VIP 折扣
  // 注：预积分用「原价」做临时预测（客户尚未付款，不知道最终实付），下单后按实付入库
  const effectivePoints = points + Math.floor(originalAmount)
  const vipLevel = getVipLevel(effectivePoints)

  // 1. VIP 折扣
  const afterVip = originalAmount * vipLevel.rate
  const vipDiscountAmount = parseFloat((originalAmount - afterVip).toFixed(2))

  // 2. 优惠券（在折后价基础上依次减）
  let couponDiscountAmount = 0
  let remaining = afterVip

  if (couponAmounts && couponAmounts.length > 0) {
    for (const c of couponAmounts) {
      if (c.amount > 0 && remaining >= c.minSpend) {
        const discount = Math.min(c.amount, remaining)
        couponDiscountAmount += discount
        remaining -= discount
      }
    }
  } else if (couponAmount > 0 && afterVip >= couponMinSpend) {
    // 单张券兼容模式
    couponDiscountAmount = Math.min(couponAmount, afterVip)
    remaining = afterVip - couponDiscountAmount
  }

  const finalAmount = parseFloat(Math.max(0, remaining).toFixed(2))

  return { vipLevel, vipDiscountAmount, couponDiscountAmount, finalAmount }
}

/**
 * 获取距离下一级还需多少积分（已满级返回 null）
 */
export function getPointsToNextLevel(points: number): { needed: number; nextLevel: VipLevel } | null {
  const current = getVipLevel(points)
  if (current.maxPoints === -1) return null
  const next = VIP_LEVELS.find(l => l.minPoints === current.maxPoints + 1) ?? VIP_LEVELS[current.level + 1]
  if (!next) return null
  return { needed: current.maxPoints + 1 - points, nextLevel: next }
}

/**
 * 获取购物车中满足该优惠券使用条件的商品总金额
 */
export function getCouponEligibleAmount(coupon: Coupon, cart: CartItem[]): number {
  if (!coupon) return 0
  
  if (coupon.target_type === 'all' || !coupon.target_type) {
    return cart.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0)
  }
  
  if (coupon.target_type === 'category') {
    // 指定菜品
    if (coupon.target_item_ids && coupon.target_item_ids.length > 0) {
      return cart
        .filter(item => coupon.target_item_ids.includes(item.menuItem.id))
        .reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0)
    }
    // 指定分类
    if (coupon.target_category_id) {
      return cart
        .filter(item => item.menuItem.category_id === coupon.target_category_id)
        .reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0)
    }
  }
  
  // fallback for unsupported target types (e.g. customer focused coupons apply to all items if they have it)
  return cart.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0)
}
