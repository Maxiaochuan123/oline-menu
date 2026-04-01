'use client'

import { useState, useEffect, use, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Order, Merchant, OrderItem, Message } from '@/lib/types'
import { formatPrice, cn } from '@/lib/utils'
import { calculateCancellationPenalty } from '@/lib/order'
import { rollbackCustomerAssetsForOrder } from '@/lib/order-assets'
import { 
  CheckCircle2, AlertCircle, X,
  ArrowLeft, RefreshCw, QrCode, Gift
} from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import React from 'react'
import OrderItemsCard from '@/components/OrderItemsCard'
import type { UsedCoupon } from '@/components/OrderItemsCard'
import OrderStatusHero from '@/components/customer/order/OrderStatusHero'
import OrderStatusBar from '@/components/customer/order/OrderStatusBar'
import OrderDeliveryCard from '@/components/customer/order/OrderDeliveryCard'
import OrderChatBox from '@/components/customer/order/OrderChatBox'
import ScrollToTopButton from '@/components/customer/ScrollToTopButton'

const STATUS_MAP: Record<string, { label: string, color: string, step: number }> = {
  pending: { label: '待收单', color: '#f59e0b', step: 1 },
  preparing: { label: '制作中', color: '#3b82f6', step: 2 },
  delivering: { label: '配送中', color: '#10b981', step: 3 },
  completed: { label: '已完成', color: '#059669', step: 4 },
  cancelled: { label: '已取消', color: '#64748b', step: 0 }
}

export default function OrderStatusPage({ params }: { params: Promise<{ merchantId: string, orderId: string }> }) {
  const supabase = createClient()
  const router = useRouter()
  const { merchantId, orderId } = use(params)

  const [order, setOrder] = useState<Order | null>(null)
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [items, setItems] = useState<OrderItem[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [showPayQr, setShowPayQr] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [, setTick] = useState(0)

  // 消息对话
  const [messages, setMessages] = useState<Message[]>([])
  const [sendingMsg, setSendingMsg] = useState(false)

  // 售后相关
  const [showAfterSales, setShowAfterSales] = useState(false)
  const [afterSalesReason, setAfterSalesReason] = useState('')
  const [afterSalesReasonDetail, setAfterSalesReasonDetail] = useState('')
  const [afterSalesItems, setAfterSalesItems] = useState<string[]>([])
  const [urgeCountdown, setUrgeCountdown] = useState(0)

  // 取消原因
  const [cancelReason, setCancelReason] = useState('')
  const [usedCoupons, setUsedCoupons] = useState<UsedCoupon[]>([])
  const pageScrollRef = useRef<HTMLElement | null>(null)

  const shouldShowRatingPanel = !!order && (
    order.status === 'completed' || 
    messages.some(m => m.msg_type === 'after_sales_closed')
  ) && !messages.some(m => m.sender === 'customer' && m.rating)
  
  useEffect(() => {
    if (!order || order.after_sales_status !== 'pending') {
      // Use requestAnimationFrame to avoid synchronous state jump warning
      const frame = requestAnimationFrame(() => setUrgeCountdown(0))
      return () => cancelAnimationFrame(frame)
    }
    const timer = setInterval(() => {
      const lastUrge = order.after_sales_last_urge_at ? new Date(order.after_sales_last_urge_at).getTime() : 0
      const now = new Date().getTime()
      if (lastUrge > 0) {
        const diff = Math.floor((now - lastUrge) / 1000)
        const remain = 300 - diff
        setUrgeCountdown(remain > 0 ? remain : 0)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [order])

  const markMerchantMessagesAsRead = useCallback(async (sourceMessages: Message[]) => {
    const unreadMerchantMessageIds = sourceMessages
      .filter((message) => message.sender === 'merchant' && !message.is_read_by_customer)
      .map((message) => message.id)

    if (unreadMerchantMessageIds.length === 0) return

    await supabase
      .from('messages')
      .update({ is_read_by_customer: true })
      .in('id', unreadMerchantMessageIds)

    setMessages((prev) =>
      prev.map((message) =>
        unreadMerchantMessageIds.includes(message.id)
          ? { ...message, is_read_by_customer: true }
          : message,
      ),
    )
  }, [supabase])

  const loadData = useCallback(async () => {
    const [oRes, mRes, iRes] = await Promise.all([
      supabase.from('orders').select('*').eq('id', orderId).eq('merchant_id', merchantId).maybeSingle(),
      supabase.from('merchants').select('*').eq('id', merchantId).single(),
      supabase.from('order_items').select('*').eq('order_id', orderId)
    ])

    if (!oRes.data || !mRes.data) {
      setOrder(null)
      setMerchant(mRes.data ?? null)
      setItems([])
      setMessages([])
      setUsedCoupons([])
      setNotFound(true)
      setLoading(false)
      return
    }

    setNotFound(false)
    setOrder(oRes.data)
    setMerchant(mRes.data)
    setItems(iRes.data || [])
    
    const ids = oRes.data?.coupon_ids ?? []
    if (ids.length > 0) {
      const { data: couponList } = await supabase.from('coupons').select('id, title, amount').in('id', ids)
      setUsedCoupons(couponList || [])
    }
    
    const { data: messageData } = await supabase
      .from('messages')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true })

    const nextMessages = messageData || []
    setMessages(nextMessages)
    await markMerchantMessagesAsRead(nextMessages)
    setLoading(false)
  }, [supabase, orderId, merchantId, markMerchantMessagesAsRead])

  useEffect(() => {
    const frame = requestAnimationFrame(() => loadData())
    return () => cancelAnimationFrame(frame)
  }, [loadData])

  useEffect(() => {
    pageScrollRef.current = document.scrollingElement as HTMLElement | null
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 60000)
    
    const channel = supabase
      .channel(`order-${orderId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }, (payload) => {
        setOrder(payload.new as Order)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `order_id=eq.${orderId}` }, (payload) => {
        const newMessage = payload.new as Message
        setMessages(prev => prev.some(m => m.id === newMessage.id) ? prev : [...prev, newMessage])
        if (newMessage.sender === 'merchant' && !newMessage.is_read_by_customer) {
          supabase.from('messages').update({ is_read_by_customer: true }).eq('id', newMessage.id).then(() => {
            setMessages((prev) =>
              prev.map((message) =>
                message.id === newMessage.id
                  ? { ...message, is_read_by_customer: true }
                  : message,
              ),
            )
          })
        }
      })
      .subscribe()

    return () => {
      clearInterval(timer)
      supabase.removeChannel(channel)
    }
  }, [orderId, supabase])

  async function sendMessage(text: string, rating?: number) {
    if (!text.trim() && !rating) return
    setSendingMsg(true)
    await supabase.from('messages').insert({
      order_id: orderId, merchant_id: merchantId, sender: 'customer',
      content: text.trim() || `客户评了 ${rating} 星 ⭐`,
      rating: rating || null, is_read_by_merchant: false, is_read_by_customer: true,
    })
    setSendingMsg(false)
  }

  async function handleQuickRating(score: number) {
    if (sendingMsg || !order) return
    setSendingMsg(true)
    await supabase.from('messages').insert({
      order_id: orderId, merchant_id: merchantId, sender: 'customer',
      content: `客户评了 ${score} 星 ⭐`,
      rating: score, is_read_by_merchant: false, is_read_by_customer: true,
    })
    setSendingMsg(false)
  }

  async function handleNegotiateRefund() {
    if (!order) return
    setSendingMsg(true)
    await supabase.from('orders').update({
      after_sales_status: 'pending',
      after_sales_reason: '客户在配送中申请协商退单',
      after_sales_urge_count: 0,
      after_sales_last_urge_at: new Date().toISOString()
    }).eq('id', orderId)
    setSendingMsg(false)
    loadData()
  }

  async function handleCancel() {
    if (!order) return
    const penaltyRes = calculateCancellationPenalty(order)
    if (!penaltyRes.canCancel) return alert(penaltyRes.reason)

    const penaltyAmount = Number(order.total_amount) * penaltyRes.rate
    const refundAmount = Number(order.total_amount) - penaltyAmount

    const { error } = await supabase.from('orders').update({
        status: 'cancelled', cancelled_by: 'customer', cancelled_at: new Date().toISOString(),
        penalty_rate: penaltyRes.rate, penalty_amount: penaltyAmount, refund_amount: refundAmount,
        after_sales_reason: cancelReason.trim(), is_coupon_refunded: true,
      }).eq('id', order.id)

    if (error) return

    await rollbackCustomerAssetsForOrder({
      supabase,
      order,
      couponIdsToRefund: order.coupon_ids ?? [],
      refundAmount,
      isFullRefund: refundAmount >= Number(order.total_amount),
    })

    setShowCancelConfirm(false)
    loadData()
  }

  async function handleSubmitAfterSales() {
    if (!order || !afterSalesReason) return
    const finalReason = afterSalesReason === '其他原因' ? afterSalesReasonDetail : afterSalesReason
    await supabase.from('orders').update({ 
      after_sales_status: 'pending', after_sales_reason: finalReason,
      after_sales_urge_count: 0, after_sales_last_urge_at: new Date().toISOString()
    }).eq('id', order.id)
    setShowAfterSales(false)
    loadData()
  }

  async function handleUrgeOrder() {
    if (!order) return
    await supabase.from('orders').update({
        after_sales_urge_count: (order.after_sales_urge_count || 0) + 1,
        after_sales_last_urge_at: new Date().toISOString()
      }).eq('id', order.id)
    loadData()
  }

  if (loading) return <div className="flex items-center justify-center h-screen"><span className="spinner" /></div>

  if (notFound || !order || !merchant) {
    return (
      <div className="min-h-screen bg-slate-50/50 px-5 py-8">
        <div className="max-w-xl mx-auto bg-white rounded-3xl border border-slate-100 shadow-xl shadow-slate-200/40 p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center mx-auto mb-5">
            <AlertCircle size={28} />
          </div>
          <h1 className="text-xl font-black text-slate-900 tracking-tight">订单不存在</h1>
          <p className="text-sm font-medium text-slate-500 mt-3 leading-relaxed">
            这个订单可能已失效，或者不属于当前店铺。
          </p>
          <Link
            href={`/m/${merchantId}`}
            className="inline-flex items-center justify-center mt-6 h-11 px-6 rounded-full bg-slate-900 text-white text-sm font-black shadow-lg shadow-slate-200"
          >
            返回店铺
          </Link>
        </div>
      </div>
    )
  }

  const status = STATUS_MAP[order.status]
  const penalty = calculateCancellationPenalty(order)

  return (
    <div className={`min-h-screen ${order.status === 'cancelled' ? 'pb-28' : 'pb-10'} bg-slate-50/50`}>
      {/* Sticky Header */}
      <header className="sticky top-0 z-[60] bg-white/80 backdrop-blur-md border-b border-slate-100 px-5 h-14 flex items-center gap-4">
        <Link href={`/m/${merchantId}/orders`} className="p-2 -ml-2 hover:bg-slate-100 rounded-full transition-colors">
          <ArrowLeft size={20} className="text-slate-600" />
        </Link>
        <h2 className="text-base font-black text-slate-800 tracking-tight leading-none">订单详情</h2>
      </header>

      <OrderStatusHero 
        status={order.status} statusLabel={status.label} color={status.color}
        description={order.status === 'pending' ? '等待商家接单，请扫码支付' : order.status === 'preparing' ? '商家正在全力制作中...' : order.status === 'delivering' ? '美食正在飞奔而来的路上！' : order.status === 'completed' ? '订单已送达，祝您用餐愉快！' : '订单已取消'}
      />

      <div className="px-4 -mt-10 relative z-20 space-y-4">
        {/* 状态卡片 */}
        <div className="bg-white rounded-3xl p-5 shadow-xl shadow-slate-200/50 border border-slate-100">
          {order.status === 'cancelled' ? (
            <div className="flex flex-col items-center justify-center text-center">
              <p className="text-base font-black text-slate-900 mb-1">订单已取消</p>
              <p className="text-xs font-bold text-slate-400">期待下次为您服务</p>
            </div>
          ) : (
            <>
              <OrderStatusBar currentStep={status.step} />
              
              {order.status === 'pending' && (
                <div className="bg-amber-50/50 border border-amber-100 border-dashed rounded-2xl p-4 mb-5 text-center">
                  <span className="text-sm font-black text-amber-700">商家审单中...</span>
                </div>
              )}


              <div className="space-y-3">
                {order.status === 'pending' && (merchant?.payment_qr_urls?.wechat || merchant?.payment_qr_urls?.alipay || merchant?.payment_qr_url) && (
                  <button data-testid="order-cta-pay" className="w-full bg-slate-900 text-white h-12 rounded-2xl font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-slate-200" onClick={() => setShowPayQr(true)}>
                    <QrCode size={18} /> 查看支付收款码
                  </button>
                )}

                <div className="grid grid-cols-2 gap-3">
                  {order.status === 'pending' && <button data-testid="order-cta-cancel" className="col-span-2 h-12 rounded-2xl border-2 border-slate-100 text-slate-500 font-black text-sm" onClick={() => { setCancelReason(''); setShowCancelConfirm(true) }}>取消订单</button>}
                  {order.status === 'preparing' && <button data-testid="order-cta-cancel" className="col-span-2 h-12 rounded-2xl border-2 border-slate-100 text-slate-500 font-black text-sm" onClick={() => { setCancelReason(''); setShowCancelConfirm(true) }}>申请退单</button>}
                  {order.status === 'delivering' && order.after_sales_status === 'none' && (
                    <>
                      <button data-testid="order-cta-cancel" className="h-11 rounded-2xl border-2 border-rose-100 text-rose-500 font-black text-sm" onClick={() => { setCancelReason(''); setShowCancelConfirm(true) }}>申请退单</button>
                      <button data-testid="order-cta-negotiate" className="h-11 rounded-2xl border-2 border-amber-100 text-amber-600 font-black text-sm" onClick={handleNegotiateRefund}>与商家协商</button>
                    </>
                  )}
                </div>

                {order.status === 'completed' && order.after_sales_status === 'none' && (
                  <button data-testid="order-cta-after-sales" className="w-full h-11 rounded-2xl border-2 border-slate-100 text-slate-500 font-black text-sm" onClick={() => setShowAfterSales(true)}>对菜品不满意？申请售后</button>
                )}
              </div>
            </>
          )}

          {/* 售后状态提醒 */}
          {order.after_sales_status === 'pending' && (
             <div data-testid="order-after-sales-pending" className="mt-4 p-4 bg-rose-50 border border-rose-100 rounded-2xl text-center">
               <div className="text-rose-600 text-[13px] font-black mb-3">售后申请已提交，等待商家处理...</div>
               <button data-testid="order-cta-urge" disabled={urgeCountdown > 0} onClick={handleUrgeOrder} className="px-6 py-2 rounded-full border border-rose-200 text-rose-500 text-xs font-black bg-white">
                 {urgeCountdown > 0 ? `催单冷却中 (${Math.floor(urgeCountdown / 60)}:${(urgeCountdown % 60).toString().padStart(2, '0')})` : '催促商家处理'}
               </button>
             </div>
          )}

          {order.after_sales_status === 'resolved' && (
             <div className="mt-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl p-4">
               <div className="flex items-center gap-2 text-emerald-600 font-black text-[14px] mb-4">
                 <CheckCircle2 size={18} /> 售后处理完毕
               </div>
               <div className="flex justify-between items-center py-3 border-b border-dashed border-emerald-100 text-xs font-bold">
                 <span className="text-slate-500">退款金额</span>
                 <span className="text-lg font-black text-emerald-700">{formatPrice(Number(order.refund_amount))}</span>
               </div>
               {(order.coupon_ids?.length ?? 0) > 0 && order.is_coupon_refunded && (
                 <div className="mt-4 bg-white rounded-2xl p-3 border border-emerald-100 shadow-sm">
                    <div className="text-[11px] font-black text-emerald-600 mb-2 flex items-center gap-1.5"><Gift size={12} /> 优惠券已原路退回</div>
                    <div className="space-y-2">
                      {usedCoupons.map((c) => (
                        <div key={c.id} className="flex justify-between items-center bg-emerald-50/30 px-3 py-2 rounded-xl text-[12px] font-black text-emerald-800">
                          <span>🏷️ {c.title}</span>
                          <span className="text-emerald-600">+{formatPrice(c.amount)}</span>
                        </div>
                      ))}
                    </div>
                 </div>
               )}
             </div>
          )}
        </div>

        <OrderDeliveryCard scheduledTime={order.scheduled_time} address={order.address} customerName={order.customer_name} phone={order.phone} />

        <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
          <OrderItemsCard
            title="订单内容" titleAsHeading items={items} usedCoupons={usedCoupons}
            couponDiscountAmount={Number(order.coupon_discount_amount)} 
            vipDiscountAmount={Number(order.vip_discount_amount)}
            totalAmount={Number(order.total_amount)}
            createdAt={order.created_at} refundAmount={order.refund_amount} refundResolved={order.after_sales_status === 'resolved'}
            penaltyRate={order.penalty_rate} penaltyAmount={order.penalty_amount} totalColor="var(--color-primary)"
          />
        </div>

        {order && !['pending', 'cancelled'].includes(order.status) && (
          <OrderChatBox
            messages={messages}
            onSendMessage={sendMessage}
            onQuickRating={handleQuickRating}
            shouldShowRatingPanel={shouldShowRatingPanel}
            sendingMsg={sendingMsg}
            scrollContainerRef={pageScrollRef}
          />
        )}
      </div>

      {order.status === 'cancelled' && (
        <div className="fixed bottom-5 left-5 right-5 z-50">
          <button className="w-full h-12 rounded-full bg-slate-900 text-white font-black text-sm flex items-center justify-center gap-2 shadow-2xl active:scale-95 transition-transform" onClick={() => {
              const cartItems = items.map(item => ({ menuItem: { id: item.menu_item_id || item.id, name: item.item_name, price: item.item_price, image_url: '', category_id: '', merchant_id: merchantId, is_available: true, sort_order: 0 }, quantity: item.quantity }))
              localStorage.setItem(`cart_${merchantId}`, JSON.stringify(cartItems))
              router.push(`/m/${merchantId}`)
            }}>
            <RefreshCw size={18} /> 重新下单
          </button>
        </div>
      )}

      {/* 弹窗部分 */}
      {showPayQr && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowPayQr(false)} />
          <div className="relative bg-white rounded-3xl p-6 w-full max-w-sm text-center shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-black text-lg text-slate-900">扫码支付</h3>
              <button onClick={() => setShowPayQr(false)} className="size-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 active:scale-90 transition-transform"><X size={18}/></button>
            </div>
            <p className="text-sm text-slate-500 mb-6 font-medium">请扫码支付 <span className="text-slate-900 font-black">{formatPrice(Number(order.total_amount))}</span></p>
            <div className="flex gap-4 justify-center flex-wrap">
              {merchant?.payment_qr_urls?.wechat && (
                <div className="text-center">
                  <div className="relative size-36 border-2 border-emerald-50 rounded-2xl overflow-hidden mb-2 bg-emerald-50/10">
                    <Image src={merchant.payment_qr_urls.wechat} alt="微信" fill unoptimized className="object-contain p-2" />
                  </div>
                  <span className="text-[11px] font-black text-emerald-600 uppercase tracking-wider">微信支付</span>
                </div>
              )}
              {merchant?.payment_qr_urls?.alipay && (
                <div className="text-center">
                  <div className="relative size-36 border-2 border-blue-50 rounded-2xl overflow-hidden mb-2 bg-blue-50/10">
                    <Image src={merchant.payment_qr_urls.alipay} alt="支付宝" fill unoptimized className="object-contain p-2" />
                  </div>
                  <span className="text-[11px] font-black text-blue-600 uppercase tracking-wider">支付宝</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showCancelConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowCancelConfirm(false)} />
          <div className="relative bg-white rounded-3xl p-6 w-full max-w-sm text-center shadow-2xl animate-in zoom-in-95 duration-300">
            <AlertCircle size={48} className="text-rose-500 mx-auto mb-4" />
            <h3 className="font-black text-lg text-slate-900 mb-2">确认取消订单？</h3>
            <div className="bg-slate-50 rounded-2xl p-4 text-left mb-6">
              <p className="text-xs text-slate-500 font-bold leading-relaxed mb-3">{penalty.reason}</p>
              {penalty.rate > 0 && (
                <div className="flex justify-between items-center pt-3 border-t border-slate-200">
                  <span className="text-xs font-black text-slate-900">预计退款</span>
                  <span className="text-sm font-black text-emerald-600">{formatPrice(Number(order.total_amount) * (1 - penalty.rate))}</span>
                </div>
              )}
            </div>
            <div className="text-left mb-6">
              <p className="text-[11px] font-black text-slate-400 mb-2">请选择取消原因：</p>
              <div className="flex flex-wrap gap-2">
                {['计划有变', '配送超时', '其他原因'].map(r => (
                  <button key={r} onClick={() => setCancelReason(r)} className={cn(
                    "px-4 py-2 rounded-xl text-[12px] font-black transition-all",
                    cancelReason === r ? "bg-slate-900 text-white shadow-lg" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  )}>{r}</button>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <button className="flex-1 h-12 rounded-2xl border-2 border-slate-100 font-black text-sm text-slate-600 hover:bg-slate-50 transition-colors" onClick={() => setShowCancelConfirm(false)}>再想想</button>
              <button disabled={!cancelReason} className="flex-1 h-12 rounded-2xl bg-rose-500 text-white font-black text-sm disabled:opacity-30 shadow-lg shadow-rose-100 active:scale-95 transition-transform" onClick={handleCancel}>确认取消</button>
            </div>
          </div>
        </div>
      )}

      {showAfterSales && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowAfterSales(false)} />
          <div className="relative bg-white rounded-3xl p-6 w-full max-w-md overflow-hidden flex flex-col max-h-[90vh] shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
            <div className="flex justify-between items-center mb-4 shrink-0">
              <h3 className="font-black text-lg text-slate-900">售后申请及协商</h3>
              <button onClick={() => setShowAfterSales(false)} className="size-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 active:scale-90 transition-transform"><X size={18}/></button>
            </div>
            <div className="overflow-y-auto custom-scrollbar pr-1 flex-1">
              <p className="text-xs text-slate-400 font-bold mb-4">如果餐品存在质量问题，可向商家发起售后协商。</p>
              <div className="flex flex-wrap gap-2 mb-6">
                {['菜品不合适', '有异物', '漏发/错发', '其他原因'].map(r => (
                  <button key={r} onClick={() => setAfterSalesReason(r)} className={cn(
                    "px-4 py-2 rounded-xl text-[12px] font-black transition-all",
                    afterSalesReason === r ? "bg-indigo-500 text-white shadow-lg shadow-indigo-200" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  )}>{r}</button>
                ))}
              </div>
              {afterSalesReason === '菜品不合适' && (
                <div className="bg-slate-50 rounded-2xl p-4 mb-6">
                  <p className="text-[11px] font-black text-slate-400 mb-3 uppercase tracking-wider">请勾选问题菜品：</p>
                  <div className="space-y-2">
                    {items.map(item => (
                      <label key={item.id} className="flex items-center gap-3 p-3 bg-white rounded-xl border border-slate-100 cursor-pointer active:scale-[0.98] transition-all">
                        <input type="checkbox" className="size-4 rounded accent-indigo-500" checked={afterSalesItems.includes(item.id)} onChange={e => e.target.checked ? setAfterSalesItems([...afterSalesItems, item.id]) : setAfterSalesItems(afterSalesItems.filter(i => i !== item.id))} />
                        <span className="flex-1 text-sm font-black text-slate-700">{item.item_name}</span>
                        <span className="text-xs text-slate-400 font-bold">x{item.quantity}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {afterSalesReason === '其他原因' && <textarea placeholder="补充详细情况..." value={afterSalesReasonDetail} onChange={e => setAfterSalesReasonDetail(e.target.value)} className="w-full h-24 bg-slate-50 rounded-2xl p-4 text-sm font-medium border-transparent focus:bg-white focus:border-indigo-100 mb-6 resize-none outline-none transition-all placeholder:text-slate-300" />}
            </div>
            <button className="w-full h-12 rounded-2xl bg-indigo-500 text-white font-black text-sm shadow-lg shadow-indigo-200 shrink-0 active:scale-95 transition-transform" onClick={handleSubmitAfterSales}>提交售后申请</button>
          </div>
        </div>
      )}

      <ScrollToTopButton />
    </div>
  )
}
