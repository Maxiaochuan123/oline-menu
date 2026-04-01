import type { SupabaseClient } from '@supabase/supabase-js'
import type { Order } from './types'

interface RollbackCustomerAssetsParams {
  supabase: SupabaseClient
  order: Pick<Order, 'customer_id' | 'coupon_ids' | 'total_amount'>
  couponIdsToRefund: string[]
  refundAmount: number
  isFullRefund: boolean
}

export async function rollbackCustomerAssetsForOrder({
  supabase,
  order,
  couponIdsToRefund,
  refundAmount,
  isFullRefund,
}: RollbackCustomerAssetsParams) {
  if (!order.customer_id) return

  if (couponIdsToRefund.length > 0) {
    await supabase
      .from('user_coupons')
      .update({ status: 'unused', used_at: null })
      .eq('customer_id', order.customer_id)
      .in('coupon_id', couponIdsToRefund)
      .eq('status', 'used')
  }

  if (refundAmount <= 0) return

  const { data: customer } = await supabase
    .from('customers')
    .select('points, order_count, total_spent')
    .eq('id', order.customer_id)
    .single()

  if (!customer) return

  const totalAmount = Number(order.total_amount)
  const remainingAmount = Math.max(0, totalAmount - refundAmount)
  const pointsToRollback = Math.max(0, Math.floor(totalAmount) - Math.floor(remainingAmount))

  await supabase
    .from('customers')
    .update({
      points: Math.max(0, (customer.points ?? 0) - pointsToRollback),
      order_count: isFullRefund ? Math.max(0, (customer.order_count ?? 0) - 1) : customer.order_count,
      total_spent: Math.max(0, (customer.total_spent ?? 0) - refundAmount),
    })
    .eq('id', order.customer_id)
}
