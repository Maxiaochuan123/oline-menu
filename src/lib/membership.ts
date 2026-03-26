// ============================================
// VIP 会员等级 & 优惠券核心逻辑
// ============================================

import type { CartItem, Coupon, MembershipTierConfig } from './types'

export interface VipLevel {
  level: number
  label: string
  description: string
  rate: number
  discount: string
  minPoints: number
  maxPoints: number
  color: string
}

const DEFAULT_TIER_NAMES = ['铜牌会员', '银牌会员', '金牌会员', '铂金会员', '钻石会员', '星耀会员', '黑金会员']
const DEFAULT_TIER_COLORS = ['#22c55e', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6']

export const DEFAULT_MEMBERSHIP_TIER_CONFIGS: MembershipTierConfig[] = [
  { id: 'lv1', name: '铜牌会员', rate: 0.98, minPoints: 100, color: '#22c55e' },
  { id: 'lv2', name: '银牌会员', rate: 0.96, minPoints: 201, color: '#3b82f6' },
  { id: 'lv3', name: '金牌会员', rate: 0.94, minPoints: 501, color: '#8b5cf6' },
  { id: 'lv4', name: '铂金会员', rate: 0.92, minPoints: 1001, color: '#f59e0b' },
  { id: 'lv5', name: '钻石会员', rate: 0.9, minPoints: 3001, color: '#ef4444' },
]

export const MAX_MEMBERSHIP_TIERS = 7

export function getDefaultTierName(index: number): string {
  return DEFAULT_TIER_NAMES[index] || `等级${index + 1}会员`
}

function clampRate(rate: number): number {
  return Math.min(1, Math.max(0.5, Number(rate.toFixed(2))))
}

function formatDiscount(rate: number): string {
  if (rate >= 1) return '原价'

  const discountValue = Number((rate * 10).toFixed(1))
  return `${Number.isInteger(discountValue) ? discountValue.toFixed(0) : discountValue.toFixed(1)}折`
}

export function sanitizeMembershipTierConfigs(
  tiers?: MembershipTierConfig[] | null
): MembershipTierConfig[] {
  const source = Array.isArray(tiers) && tiers.length > 0 ? tiers : DEFAULT_MEMBERSHIP_TIER_CONFIGS

  return source
    .map((tier, index) => ({
      id: tier.id || `lv${index + 1}`,
      name: (tier.name || getDefaultTierName(index)).trim(),
      rate: clampRate(Number(tier.rate) || 1),
      minPoints: Math.max(1, Math.floor(Number(tier.minPoints) || 1)),
      color: tier.color || DEFAULT_TIER_COLORS[index % DEFAULT_TIER_COLORS.length],
    }))
    .sort((a, b) => a.minPoints - b.minPoints)
    .reduce<MembershipTierConfig[]>((acc, tier, index) => {
      const prevMin = acc[index - 1]?.minPoints ?? 0
      acc.push({
        ...tier,
        minPoints: Math.max(tier.minPoints, prevMin + 1),
      })
      return acc
    }, [])
}

export function validateMembershipTierConfigs(tiers: MembershipTierConfig[]): string[] {
  if (tiers.length === 0) return ['至少保留 1 个会员等级']
  if (tiers.length > MAX_MEMBERSHIP_TIERS) return [`最多支持 ${MAX_MEMBERSHIP_TIERS} 个会员等级`]

  const errors: string[] = []

  tiers.forEach((tier, index) => {
    if (!tier.name.trim()) {
      errors.push(`LV${index + 1} 等级名称不能为空`)
    }

    if (!Number.isFinite(tier.minPoints) || tier.minPoints < 1) {
      errors.push(`LV${index + 1} 的升级积分必须大于 0`)
    }

    if (!Number.isFinite(tier.rate) || tier.rate <= 0 || tier.rate > 1) {
      errors.push(`LV${index + 1} 的折扣必须在 1 折到 100 折之间`)
    }

    if (index > 0) {
      const prev = tiers[index - 1]
      if (tier.minPoints <= prev.minPoints) {
        errors.push(`LV${index + 1} 的升级积分必须大于上一等级`)
      }
    }
  })

  return errors
}

export function getMembershipLevels(tiers?: MembershipTierConfig[] | null): VipLevel[] {
  const normalized = sanitizeMembershipTierConfigs(tiers)
  const paidLevels = normalized.map((tier, index) => ({
    level: index + 1,
    label: `LV${index + 1}`,
    description: tier.name,
    rate: tier.rate,
    discount: formatDiscount(tier.rate),
    minPoints: tier.minPoints,
    maxPoints: normalized[index + 1]?.minPoints ? normalized[index + 1].minPoints - 1 : -1,
    color: tier.color || DEFAULT_TIER_COLORS[index % DEFAULT_TIER_COLORS.length],
  }))

  const lv0MaxPoints = paidLevels[0]?.minPoints ? paidLevels[0].minPoints - 1 : -1

  return [
    {
      level: 0,
      label: 'LV0',
      description: '新朋友',
      rate: 1,
      discount: '原价',
      minPoints: 0,
      maxPoints: lv0MaxPoints,
      color: '#9ca3af',
    },
    ...paidLevels,
  ]
}

export const VIP_LEVELS: VipLevel[] = getMembershipLevels()

export function getVipLevel(points: number, levels: VipLevel[] = VIP_LEVELS): VipLevel {
  for (let i = levels.length - 1; i >= 0; i--) {
    if (points >= levels[i].minPoints) return levels[i]
  }
  return levels[0]
}

export function calcDiscount(params: {
  originalAmount: number
  points: number
  couponAmount?: number
  couponMinSpend?: number
  couponAmounts?: { amount: number; minSpend: number }[]
  membershipLevels?: VipLevel[]
}): {
  vipLevel: VipLevel
  vipDiscountAmount: number
  couponDiscountAmount: number
  finalAmount: number
} {
  const {
    originalAmount,
    points,
    couponAmount = 0,
    couponMinSpend = 0,
    couponAmounts,
    membershipLevels = VIP_LEVELS,
  } = params

  // 预积分按原价临时预测，本单可即时享受达成后的会员折扣
  const effectivePoints = points + Math.floor(originalAmount)
  const vipLevel = getVipLevel(effectivePoints, membershipLevels)

  const afterVip = originalAmount * vipLevel.rate
  const vipDiscountAmount = parseFloat((originalAmount - afterVip).toFixed(2))

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
    couponDiscountAmount = Math.min(couponAmount, afterVip)
    remaining = afterVip - couponDiscountAmount
  }

  const finalAmount = parseFloat(Math.max(0, remaining).toFixed(2))

  return { vipLevel, vipDiscountAmount, couponDiscountAmount, finalAmount }
}

export function getPointsToNextLevel(
  points: number,
  levels: VipLevel[] = VIP_LEVELS
): { needed: number; nextLevel: VipLevel } | null {
  const current = getVipLevel(points, levels)
  if (current.maxPoints === -1) return null

  const next = levels[current.level + 1]
  if (!next) return null

  return { needed: next.minPoints - points, nextLevel: next }
}

export function getCouponEligibleAmount(coupon: Coupon, cart: CartItem[]): number {
  if (!coupon) return 0

  if (coupon.target_type === 'all' || !coupon.target_type) {
    return cart.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0)
  }

  if (coupon.target_type === 'category') {
    if (coupon.target_item_ids && coupon.target_item_ids.length > 0) {
      return cart
        .filter(item => coupon.target_item_ids.includes(item.menuItem.id))
        .reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0)
    }

    if (coupon.target_category_id) {
      return cart
        .filter(item => item.menuItem.category_id === coupon.target_category_id)
        .reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0)
    }
  }

  return cart.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0)
}
