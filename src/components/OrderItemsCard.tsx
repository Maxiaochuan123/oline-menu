'use client'

import { formatPrice, cn } from '@/lib/utils'

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
  target_type?: 'all' | 'category' | 'customer' | null
  target_category_id?: string | null
  target_item_ids?: string[] | null // 用于精准匹配特定菜品
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
  /** 违约金比例（0~1），有取消违约时传入 */
  penaltyRate?: number | null
  /** 违约金金额，有取消违约时传入 */
  penaltyAmount?: number | null
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
  penaltyRate,
  penaltyAmount,
  totalColor = 'text-orange-500', // 改为传类名
}: Props) {
  return (
    <div className="space-y-4 font-sans">
      {/* 标题 */}
      {titleAsHeading ? (
        <h3 className="text-base font-black pb-3 border-b border-slate-100 text-slate-800 tracking-tight">
          {title}
        </h3>
      ) : (
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-3.5 bg-orange-500 rounded-full" />
          <span className="text-[15px] font-black text-slate-800 tracking-tight">{title}</span>
        </div>
      )}

      {/* 菜品列表 */}
      <div className="space-y-2">
        {items.map(item => (
          <div
            key={item.id}
            className={cn(
              "flex justify-between text-sm transition-colors hover:bg-slate-50 rounded-lg py-1 px-1 -mx-1",
              titleAsHeading ? "pb-3" : "py-1"
            )}
          >
            <div className="flex flex-col">
              <span className="text-slate-700 font-medium">
                {item.item_name} <span className="text-slate-400 font-bold ml-1">x{item.quantity}</span>
              </span>
              {showRemark && item.remark && (
                <span className="text-[11px] text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded mt-1 w-fit font-bold animate-pulse">
                  备注: {item.remark}
                </span>
              )}
            </div>
            <span className={cn("text-slate-900 font-black", titleAsHeading ? "text-base" : "text-sm tabular-nums")}>
              {formatPrice(item.item_price * item.quantity)}
            </span>
          </div>
        ))}
      </div>

      {/* 优惠券明细 */}
      {usedCoupons.length > 0 && couponDiscountAmount > 0 && (
        <div className="pt-3 border-t border-dashed border-blue-100 space-y-2">
          {usedCoupons.map((coupon) => (
            <div
              key={coupon.id}
              className="flex justify-between items-center text-[13px] text-blue-600 font-medium bg-blue-50/50 px-2 py-1.5 rounded-lg border border-blue-100/50"
            >
              <span className="flex items-center gap-1.5">
                <span className="text-xs">🏷️</span> {coupon.title}
              </span>
              <span className="font-black tabular-nums">-{formatPrice(coupon.amount)}</span>
            </div>
          ))}
          {usedCoupons.length > 1 && (
            <div className="flex justify-between items-center pt-2 px-2 text-[11px] text-blue-500 font-bold">
              <span>共优惠</span>
              <span className="tabular-nums">-{formatPrice(couponDiscountAmount)}</span>
            </div>
          )}
        </div>
      )}

      {/* 实付合计 */}
      <div className="pt-4 border-t border-dashed border-slate-200">
        <div className="flex justify-between items-end">
          <span className="text-sm font-bold text-slate-500 pb-0.5">实付合计</span>
          <span className={cn(
            "font-black tracking-tighter tabular-nums",
            titleAsHeading ? "text-2xl" : "text-xl",
            totalColor === 'var(--color-primary)' || totalColor === '#f59e0b' ? "text-orange-600" : totalColor
          )}>
            {formatPrice(totalAmount)}
          </span>
        </div>
      </div>

      {/* 违约金明细（取消订单有违约时显示） */}
      {!!penaltyRate && penaltyRate > 0 && !!penaltyAmount && penaltyAmount > 0 && (
        <div className="pt-3 border-t border-dashed border-red-100 space-y-2">
          <div className="flex justify-between items-center text-xs text-red-500 font-bold">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              违约金 ({(penaltyRate * 100).toFixed(0)}%)
            </span>
            <span className="tabular-nums">-{formatPrice(penaltyAmount)}</span>
          </div>
          <div className="flex justify-between items-center text-sm font-black bg-red-50 text-red-600 px-3 py-2 rounded-xl">
            <span>实际退款额</span>
            <span className="text-base tabular-nums">{formatPrice(Math.max(0, totalAmount - penaltyAmount))}</span>
          </div>
        </div>
      )}

      {/* 售后退款（售后处理后展示） */}
      {refundResolved && refundAmount && (
        <div className="pt-3 border-t border-dashed border-slate-100 space-y-1.5">
          <div className="flex justify-between items-center text-[12px] text-rose-500 font-black px-2.5">
            <span>售后退款</span>
            <span className="tabular-nums">-{formatPrice(Number(refundAmount))}</span>
          </div>
          <div className="flex justify-between items-center text-sm font-black text-emerald-600 px-2.5 pt-1">
            <span className="tracking-tight">实际结算支付</span>
            <span className="text-xl tracking-tighter tabular-nums">
              {formatPrice(Math.max(0, totalAmount - Number(refundAmount)))}
            </span>
          </div>
        </div>
      )}

      {/* 下单时间 */}
      <div className="text-[10px] text-slate-400 font-bold text-right pt-2 italic">
        下单时间 · {new Date(createdAt).toLocaleString('zh-CN', { hour12: false })}
      </div>
    </div>
  )
}
