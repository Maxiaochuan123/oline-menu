'use client'

import { formatPrice } from '@/lib/utils'

export interface OrderItemData {
  id: string
  item_name: string
  item_price: number
  quantity: number
  remark?: string | null
}

export interface UsedCoupon {
  id: string
  title: string
  amount: number
}

interface Props {
  /** 卡片标题，客户端用 "订单内容"，商家端用 "菜品明细" */
  title?: string
  /** 是否在标题处显示 h3 样式（客户端），false 时显示 strong（商家端） */
  titleAsHeading?: boolean
  /** 订单菜品列表 */
  items: OrderItemData[]
  /** 是否显示备注，商家端需要，客户端通常不显示 */
  showRemark?: boolean
  /** 已使用的优惠券列表 */
  usedCoupons: UsedCoupon[]
  /** 订单优惠券总抵扣金额 */
  couponDiscountAmount: number
  /** 订单实付总金额 */
  totalAmount: number
  /** 下单时间 */
  createdAt: string
  /** 售后退款金额（仅在已退款时传入） */
  refundAmount?: number | null
  /** 是否已完成售后退款（传入 refundAmount 同时也需将此设为 true） */
  refundResolved?: boolean
  /** 实付合计字体颜色，商家端 amber，客户端 orange */
  totalColor?: string
}

/**
 * 订单菜品明细卡片（商家端与客户端共用）
 * - 菜品列表
 * - 优惠券明细（逐张）
 * - 实付合计
 * - 售后退款（可选）
 * - 下单时间
 */
export default function OrderItemsCard({
  title = '菜品明细',
  titleAsHeading = false,
  items,
  showRemark = false,
  usedCoupons,
  couponDiscountAmount,
  totalAmount,
  createdAt,
  refundAmount,
  refundResolved = false,
  totalColor = '#f59e0b',
}: Props) {
  return (
    <>
      {/* 标题 */}
      {titleAsHeading ? (
        <h3 style={{ fontSize: '15px', fontWeight: '800', marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid #f5f5f4' }}>
          {title}
        </h3>
      ) : (
        <strong style={{ fontSize: '14px' }}>{title}：</strong>
      )}

      {/* 菜品列表 */}
      {items.map(item => (
        <div
          key={item.id}
          style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', padding: titleAsHeading ? '0 0 12px' : '4px 0' }}
        >
          <span>
            {item.item_name} x{item.quantity}
            {showRemark && item.remark ? ` (${item.remark})` : ''}
          </span>
          <span style={{ fontWeight: titleAsHeading ? '600' : undefined }}>
            {formatPrice(item.item_price * item.quantity)}
          </span>
        </div>
      ))}

      {/* 优惠券明细 */}
      {usedCoupons.length > 0 && couponDiscountAmount > 0 && (
        <div style={{ borderTop: '1px dashed #e5f0ff', marginTop: '6px', paddingTop: '6px' }}>
          {usedCoupons.map((coupon, idx) => (
            <div
              key={coupon.id}
              style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: '13px', padding: '3px 0', color: '#3b82f6',
                marginBottom: idx < usedCoupons.length - 1 ? '2px' : 0
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                🏷️ {coupon.title}
              </span>
              <span style={{ fontWeight: '600' }}>-{formatPrice(coupon.amount)}</span>
            </div>
          ))}
          {usedCoupons.length > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#6b7280', paddingTop: '4px', marginTop: '2px', borderTop: '1px dashed #e5e7eb' }}>
              <span>共优惠</span>
              <span style={{ fontWeight: '600', color: '#3b82f6' }}>-{formatPrice(couponDiscountAmount)}</span>
            </div>
          )}
        </div>
      )}

      {/* 实付合计 */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #e5e7eb',
        fontWeight: '700', fontSize: titleAsHeading ? '15px' : '16px'
      }}>
        <span>实付合计</span>
        <span style={{ fontSize: titleAsHeading ? '20px' : '16px', color: totalColor }}>
          {formatPrice(totalAmount)}
        </span>
      </div>

      {/* 售后退款（仅客户端使用） */}
      {refundResolved && refundAmount && (
        <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed #eee' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#dc2626' }}>
            <span>售后退款</span>
            <span style={{ fontWeight: '700' }}>-{formatPrice(Number(refundAmount))}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '14px', fontWeight: '800' }}>
            <span>实际支付</span>
            <span style={{ color: 'var(--color-primary)' }}>
              {formatPrice(Math.max(0, totalAmount - Number(refundAmount)))}
            </span>
          </div>
        </div>
      )}

      {/* 下单时间 */}
      <div style={{ fontSize: '12px', color: '#999', marginTop: '12px', textAlign: 'right' }}>
        下单时间：{new Date(createdAt).toLocaleString('zh-CN')}
      </div>
    </>
  )
}
