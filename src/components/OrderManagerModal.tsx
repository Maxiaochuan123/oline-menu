'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AlertTriangle, CheckCircle, ChevronRight, X, Send, MessageSquare } from 'lucide-react'
import { formatPrice } from '@/lib/utils'
import OrderItemsCard from '@/components/OrderItemsCard'
import type { UsedCoupon } from '@/components/OrderItemsCard'
import type { Order, Message } from '@/lib/types'

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  preparing: '制作中',
  delivering: '配送中',
  completed: '已完成',
  cancelled: '已取消'
}
const STATUS_FLOW = ['pending', 'preparing', 'delivering', 'completed']

export default function OrderManagerModal({ 
  order, 
  onClose, 
  onSuccess 
}: { 
  order: Order | any, 
  onClose: () => void, 
  onSuccess: () => void 
}) {
  const supabase = createClient()
  const [orderItems, setOrderItems] = useState<any[]>([])
  
  // 状态流
  const [showRefundPanel, setShowRefundPanel] = useState(false)
  const [refundMode, setRefundMode] = useState<'fixed' | 'ratio' | 'items'>('fixed')
  const [refundInput, setRefundInput] = useState('')
  // 记录选中的退货明细: item.id -> { quantity: number }
  const [selectedRefundItems, setSelectedRefundItems] = useState<Record<string, number>>({})
  const [isCouponRefundIncluded, setIsCouponRefundIncluded] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [isConfirmingStatus, setIsConfirmingStatus] = useState(false)

  // 客服聊天（同时接收普通留言与售后流）
  const [messages, setMessages] = useState<Message[]>([])
  const [asMsgText, setAsMsgText] = useState('')
  const [sendingAsMsg, setSendingAsMsg] = useState(false)
  const msgBoxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (msgBoxRef.current) {
      msgBoxRef.current.scrollTop = msgBoxRef.current.scrollHeight
    }
  }, [messages])

  const [usedCoupons, setUsedCoupons] = useState<UsedCoupon[]>([])

  useEffect(() => {
    if (order) {
      supabase.from('order_items').select('*').eq('order_id', order.id).then(({ data }) => {
        setOrderItems(data || [])
        if (data) {
          const initQty: Record<string, number> = {}
          data.forEach(item => {
            initQty[item.id] = item.quantity
          })
          setSelectedRefundItems(initQty)
        }
      })
      // 加载所有使用的优惠券（支持多张）
      const ids: string[] = order.coupon_ids ?? []
      if (ids.length > 0) {
        supabase.from('coupons').select('id, title, amount').in('id', ids).then(({ data: couponList }) => {
          setUsedCoupons(couponList || [])
        })
      }
    }
  }, [order, supabase])

  const loadMessages = () => {
    if (!order) return
    supabase
      .from('messages')
      .select('*')
      .eq('order_id', order.id)
      .order('created_at', { ascending: true })
      .then(async ({ data }) => {
        setMessages(data || [])
        // 将客户发的消息标记商家已读
        const unreadForMerchant = (data || []).filter((m: Message) => m.sender === 'customer' && !m.is_read_by_merchant)
        if (unreadForMerchant.length > 0) {
          await supabase.from('messages')
            .update({ is_read_by_merchant: true })
            .in('id', unreadForMerchant.map((m: Message) => m.id))
        }
      })
  }

  useEffect(() => {
    if (order) {
      loadMessages()

      const channel = supabase
        .channel(`merchant-asm-${order.id}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `order_id=eq.${order.id}`,
        }, () => loadMessages()) // Reload on new message and mark as read
        .subscribe()

      return () => { supabase.removeChannel(channel) }
    }
  }, [order])

  async function sendAfterSalesMessage(content?: string, isClosedObj = false) {
    const text = content || asMsgText.trim()
    if (!text || !order) return
    setSendingAsMsg(true)
    await supabase.from('messages').insert({
      order_id: order.id,
      merchant_id: order.merchant_id,
      sender: 'merchant',
      content: text,
      msg_type: isClosedObj ? 'after_sales_closed' : 'after_sales',
      is_read_by_merchant: true,
      is_read_by_customer: false
    })
    if (!content) setAsMsgText('')
    setSendingAsMsg(false)
  }

  // 当退款项改变、或金额比例等其他模式变化时，智能默认勾选退券
  useEffect(() => {
    if (!order || !(order.coupon_ids?.length > 0) || Object.keys(selectedRefundItems).length === 0) return
    let shouldCheck = false
    if (refundMode === 'items') {
      shouldCheck = orderItems.every(i => selectedRefundItems[i.id] === i.quantity)
    } else if (refundMode === 'fixed') {
      shouldCheck = Number(refundInput) >= Number(order.total_amount)
    } else if (refundMode === 'ratio') {
      shouldCheck = Number(refundInput) >= 100
    }
    setTimeout(() => setIsCouponRefundIncluded(shouldCheck), 0)
  }, [selectedRefundItems, refundMode, order, orderItems, refundInput])

  function currentRefundTotal() {
    if (!order) return 0
    let amt = 0
    if (refundMode === 'fixed') {
      const v = Number(refundInput)
      amt = isNaN(v) ? 0 : v
    }
    else if (refundMode === 'ratio') {
      const p = Number(refundInput)
      if (isNaN(p) || p < 0 || p > 100) return 0
      amt = Number(order.total_amount) * (p / 100)
    }
    else if (refundMode === 'items') {
      let sum = 0
      orderItems.forEach(i => {
        const qty = selectedRefundItems[i.id] || 0
        sum += (i.item_price * qty)
      })
      amt = sum
    }
    // 强制封顶策略：任何方式算出的退款额，都不能超过顾客实际支付
    return Math.min(amt, Number(order.total_amount))
  }

  async function handleConfirmRefund() {
    const amt = currentRefundTotal()
    if (amt <= 0) return alert('退款金额必须大于 0')
    if (amt > Number(order.total_amount)) return alert('退款金额不能大于订单实付额')
    if (!window.confirm(`确认同意售后？将会退款：${formatPrice(amt)} 给客户`)) return

    const isFullRefund = amt >= Number(order.total_amount)
    const updatePayload = {
      refund_amount: amt,
      after_sales_status: 'resolved',
      status: isFullRefund ? 'cancelled' : 'completed',
      cancelled_by: isFullRefund ? 'merchant' : order.cancelled_by,
      cancelled_at: isFullRefund ? new Date().toISOString() : order.cancelled_at,
      is_coupon_refunded: isCouponRefundIncluded, // 记录是否退了券
    }

    const { error } = await supabase.from('orders').update(updatePayload).eq('id', order.id)

    if (error) {
      alert('处理失败')
    } else {
      // 若选择同时退券
      if (isCouponRefundIncluded && order.customer_id) {
        const couponIds: string[] = order.coupon_ids ?? []
        if (couponIds.length > 0) {
          // 批量退还本单所有已使用的优惠券
          await supabase
            .from('user_coupons')
            .update({ status: 'unused', used_at: null })
            .eq('customer_id', order.customer_id)
            .in('coupon_id', couponIds)
            .eq('status', 'used')
        }
      }
      const extInfo = isCouponRefundIncluded ? '\n(同时已为您退回该单所用优惠券)' : ''
      await sendAfterSalesMessage(`商家已同意退款并完结本单售后（退款金额：${formatPrice(amt)}）${extInfo}\n祝您生活愉快~`, true)
      onSuccess()
      onClose()
    }
  }

  async function handleRejectRefund() {
    if (!window.confirm('确定要驳回这笔售后申请吗？')) return
    // 驳回售后也视作“处理完毕”，若订单未完成则强制标记完成（除非已取消）
    const nextStatus = order.status === 'cancelled' ? 'cancelled' : 'completed'
    await supabase.from('orders').update({ 
      after_sales_status: 'rejected',
      status: nextStatus
    }).eq('id', order.id)
    await sendAfterSalesMessage(`抱歉，商家已驳回您的售后申请。\n如有疑问可继续留言沟通。`, true)
    onSuccess()
    onClose()
  }

  async function cancelOrder() {
    const { error } = await supabase.from('orders').update({
      status: 'cancelled',
      cancelled_by: 'merchant',
      cancelled_at: new Date().toISOString(),
      refund_amount: order.total_amount
    }).eq('id', order.id)

    if (error) alert('取消失败')
    else {
      onSuccess()
      onClose()
    }
  }

  function requestStatusUpdate() {
    const idx = STATUS_FLOW.indexOf(order.status)
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return
    setIsConfirmingStatus(true)
  }

  async function updateStatus() {
    const idx = STATUS_FLOW.indexOf(order.status)
    const nextStatus = STATUS_FLOW[idx + 1]
    const { error } = await supabase.from('orders').update({ status: nextStatus }).eq('id', order.id)
    if (error) alert('更新状态失败')
    else {
      onSuccess()
      onClose()
    }
  }

  if (!order) return null

  return (
    <>
      <div className="overlay" style={{ zIndex: 50 }} onClick={onClose} />
      <div className="dialog" style={{ zIndex: 60 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontWeight: '700' }}>订单详情</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
        </div>

        {order.after_sales_status === 'pending' && (
           <div className={(order.after_sales_urge_count || 0) > 0 ? "urgent-panel-pulse" : ""} style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444', fontWeight: 'bold', marginBottom: '4px', fontSize: '14px' }}>
               <AlertTriangle size={16} /> 售后待处理 {(order.after_sales_urge_count || 0) > 0 && `(客户已催处理 ${order.after_sales_urge_count} 次)`}
             </div>
             <div style={{ fontSize: '13px', color: '#7f1d1d', marginBottom: '10px' }}>
               <strong>顾客缘由：</strong>{order.after_sales_reason}
             </div>
             {order.after_sales_items && order.after_sales_items.length > 0 && (
               <div style={{ fontSize: '12px', color: '#b91c1c', marginBottom: '10px', background: 'white', padding: '6px', borderRadius: '4px' }}>
                 <strong>不满意菜品：</strong>
                 {orderItems.filter(i => order.after_sales_items?.includes(i.id)).map(i => i.item_name).join('、')}
               </div>
             )}
             {order.after_sales_images && order.after_sales_images.length > 0 && (
               <div style={{ marginBottom: '10px' }}>
                 <strong style={{ fontSize: '12px', color: '#b91c1c', display: 'block', marginBottom: '4px' }}>凭证照片：</strong>
                 <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                   {order.after_sales_images.map((url: string, idx: number) => (
                     <img 
                       key={idx} 
                       src={url} 
                       alt="凭证" 
                       style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #fca5a5', cursor: 'pointer' }} 
                       onClick={() => window.open(url, '_blank')}
                     />
                   ))}
                 </div>
               </div>
             )}
             <button 
               className="btn btn-primary btn-block btn-sm" 
               style={{ background: '#ef4444', borderColor: '#ef4444' }}
               onClick={() => setShowRefundPanel(true)}
             >去处理退款/驳回</button>
           </div>
        )}
        {order.after_sales_status === 'resolved' && (
           <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#15803d', fontSize: '13px', fontWeight: 'bold', marginBottom: '8px' }}>
               <CheckCircle size={16} /> 已完结售后
             </div>
             <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#374151', marginBottom: '4px' }}>
               <span>退款金额</span>
               <span style={{ fontWeight: '700', color: '#166534' }}>{formatPrice(Number(order.refund_amount))}</span>
             </div>
             {(order.coupon_ids?.length ?? 0) > 0 && order.is_coupon_refunded && (
               <div style={{ marginTop: '8px', padding: '8px 10px', background: '#dcfce7', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #bbf7d0' }}>
                 <span>🏷️</span>
                 <div>
                   <div style={{ fontSize: '12px', fontWeight: '700', color: '#15803d' }}>已同时退还优惠券</div>
                    <div style={{ fontSize: '13px', fontWeight: '800', color: '#166534' }}>
                      {usedCoupons.length > 0 ? usedCoupons.map(c => c.title).join(' + ') : '优惠券'}
                      （抵扣 {formatPrice(Number(order.coupon_discount_amount || 0))}）
                    </div>
                 </div>
               </div>
             )}
           </div>
        )}

        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
          <span className={`tag tag-${order.order_type === 'personal' ? 'personal' : 'company'}`}>
            {order.order_type === 'personal' ? '个人' : '公司'}
          </span>
          <span className={`tag tag-status tag-${order.status}`}>{STATUS_LABELS[order.status]}</span>
        </div>
        <div style={{ fontSize: '14px', lineHeight: '2' }}>
          <div><strong>客户：</strong>{order.customer_name}</div>
          <div><strong>电话：</strong>{order.phone}</div>
          <div><strong>地址：</strong>{order.address}</div>
          <div><strong>预定时间：</strong>{new Date(order.scheduled_time).toLocaleString('zh-CN')}</div>
        </div>
        <div style={{ margin: '12px 0', borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
          <OrderItemsCard
            title="菜品明细"
            titleAsHeading={false}
            items={orderItems}
            showRemark
            usedCoupons={usedCoupons}
            couponDiscountAmount={Number(order.coupon_discount_amount)}
            totalAmount={Number(order.total_amount)}
            createdAt={order.created_at}
            totalColor="#f59e0b"
          />
        </div>

        {/* --- 统一客户沟通记录区 (P12-D 升级版) --- */}
        <div style={{ marginTop: '16px', background: '#f9fafb', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e5e7eb' }}>
          <div style={{ padding: '10px 12px', background: '#f3f4f6', borderBottom: '1px solid #e5e7eb', fontSize: '13px', fontWeight: 'bold', color: '#4b5563', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <MessageSquare size={16} color="var(--color-primary)" /> 客户留言与评价沟通记录
          </div>
          <div ref={msgBoxRef} style={{ padding: '12px 14px', maxHeight: '240px', overflowY: 'auto' }}>
            {messages.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '13px', padding: '10px 0' }}>暂无沟通记录</div>
            ) : messages.map(msg => {
              const isMerc = msg.sender === 'merchant'
              const isAfterSales = msg.msg_type === 'after_sales'
              const isClosed = msg.msg_type === 'after_sales_closed'

              return (
                <div key={msg.id} style={{
                  display: 'flex',
                  justifyContent: isMerc ? 'flex-end' : 'flex-start',
                  marginBottom: '10px',
                }}>
                  <div style={{ maxWidth: '85%' }}>
                    {msg.sender === 'customer' && msg.rating && (
                       <div style={{ fontSize: '12px', color: '#f59e0b', fontWeight: '600', marginBottom: '4px' }}>客户评价了 {msg.rating} 星 ⭐</div>
                    )}
                    <div style={{
                      padding: '8px 12px',
                      borderRadius: isMerc ? '14px 4px 14px 14px' : '4px 14px 14px 14px',
                      background: isAfterSales ? (isMerc ? '#fecaca' : '#fee2e2') : (isMerc ? 'var(--color-primary)' : 'white'),
                      color: isAfterSales ? (isMerc ? '#7f1d1d' : '#991b1b') : (isMerc ? 'white' : '#1c1917'),
                      border: isMerc ? 'none' : '1px solid #e5e7eb',
                      fontSize: '14px', lineHeight: '1.5',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-all'
                    }}>
                      {isAfterSales && !isMerc && <div style={{ fontSize: '12px', fontWeight: '800', marginBottom: '4px', opacity: 0.9 }}>🚨 发起售后争议</div>}
                      {isClosed && <div style={{ fontSize: '12px', fontWeight: '800', marginBottom: '4px', color: '#10b981' }}>✅ 纠纷已完结</div>}
                      {msg.content}
                    </div>
                    <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px', textAlign: isMerc ? 'right' : 'left' }}>
                      {new Date(msg.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      {!isMerc && <span style={{ marginLeft: '4px', color: '#f59e0b', fontWeight: '600' }}>客户</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ padding: '10px', background: 'white', borderTop: '1px solid #e5e7eb', display: 'flex', gap: '8px' }}>
            <input
              value={asMsgText}
              onChange={e => setAsMsgText(e.target.value)}
              placeholder="发送消息..."
              style={{
                flex: 1, border: '1px solid var(--color-border)',
                borderRadius: '16px', padding: '8px 14px',
                fontSize: '14px', outline: 'none', background: '#fafafa'
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') sendAfterSalesMessage()
              }}
            />
            <button
              onClick={() => sendAfterSalesMessage()}
              disabled={sendingAsMsg || !asMsgText.trim()}
              className="btn btn-primary"
              style={{ height: '36px', width: '36px', padding: 0, borderRadius: '50%', flexShrink: 0 }}
            >
              <Send size={16} />
            </button>
          </div>
        </div>

        {/* --- 订单全局底部操作栏 --- */}
        {!['completed', 'cancelled'].includes(order.status) && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <button onClick={() => setShowCancel(true)} className="btn btn-danger btn-sm" style={{ flex: 1 }}>取消订单</button>
            <button onClick={() => requestStatusUpdate()} className="btn btn-primary" style={{ flex: 2 }}>
              {STATUS_LABELS[STATUS_FLOW[STATUS_FLOW.indexOf(order.status) + 1]] || ''}
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {/* 取消确认弹窗 */}
      {showCancel && (
        <>
          <div className="overlay" style={{ zIndex: 70 }} onClick={() => setShowCancel(false)} />
          <div className="dialog" style={{ zIndex: 80 }}>
            <div style={{ textAlign: 'center' }}>
              <AlertTriangle size={48} color="#ef4444" style={{ margin: '0 auto 12px' }} />
              <h3 style={{ fontWeight: '700', marginBottom: '8px' }}>确认取消订单？</h3>
              <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                商家取消订单将全额退款给客户，此操作不可撤销。
              </p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
                <button onClick={() => setShowCancel(false)} className="btn btn-outline" style={{ flex: 1 }}>再想想</button>
                <button onClick={cancelOrder} className="btn btn-danger" style={{ flex: 1 }}>确认取消</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 售后与退款面板 */}
      {showRefundPanel && (
        <>
          <div className="overlay" style={{ zIndex: 90 }} onClick={() => setShowRefundPanel(false)} />
          <div className="dialog" style={{ zIndex: 100 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontWeight: '800' }}>协商退款控制台</h3>
              <button onClick={() => setShowRefundPanel(false)} style={{ background: 'none', border: 'none' }}><X size={20} /></button>
            </div>
            
            <div style={{ marginBottom: '16px', background: '#f8f9fa', padding: '12px', borderRadius: '8px', fontSize: '13px' }}>
              <div style={{ color: '#666', marginBottom: '4px' }}>订单总额</div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--color-primary)' }}>{formatPrice(Number(order.total_amount))}</div>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', borderBottom: '1px solid #eee', paddingBottom: '12px' }}>
              <button className={`btn btn-sm ${refundMode === 'fixed' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setRefundMode('fixed')}>按金额</button>
              <button className={`btn btn-sm ${refundMode === 'ratio' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setRefundMode('ratio')}>按比例</button>
              <button className={`btn btn-sm ${refundMode === 'items' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setRefundMode('items')}>按菜品</button>
            </div>

            {refundMode === 'fixed' && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '6px' }}>输入一口价退款金额 (最多可退款 {formatPrice(Number(order.total_amount))})</label>
                <input type="number" className="input" placeholder={`最多: ${order.total_amount}`} value={refundInput} onChange={e => setRefundInput(e.target.value)} />
              </div>
            )}

            {refundMode === 'ratio' && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '6px' }}>输入退款比例 (%) 比如 50 表示退款一半</label>
                <input type="number" className="input" placeholder="0 - 100" value={refundInput} onChange={e => setRefundInput(e.target.value)} />
              </div>
            )}

            {refundMode === 'items' && (
              <div style={{ marginBottom: '16px', maxHeight: '200px', overflowY: 'auto', border: '1px solid #eee', borderRadius: '8px', padding: '8px' }}>
                {orderItems.map(item => {
                  const currentQty = selectedRefundItems[item.id] || 0
                  return (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 4px', borderBottom: '1px solid #f9fafb', fontSize: '14px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flex: 1 }}>
                        <input 
                          type="checkbox" 
                          checked={currentQty > 0}
                          onChange={(e) => {
                            setSelectedRefundItems(prev => ({
                              ...prev,
                              [item.id]: e.target.checked ? item.quantity : 0
                            }))
                          }}
                        />
                        <div>{item.item_name} (原买: {item.quantity})</div>
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #ddd', borderRadius: '4px', background: '#fff' }}>
                          <button 
                            style={{ padding: '2px 8px', border: 'none', background: 'transparent', cursor: currentQty <= 1 ? 'not-allowed' : 'pointer', color: currentQty <= 1 ? '#ccc' : '#333' }}
                            disabled={currentQty <= 1}
                            onClick={() => setSelectedRefundItems(p => ({ ...p, [item.id]: p[item.id] - 1 }))}
                          >-</button>
                          <span style={{ fontSize: '13px', padding: '0 8px', minWidth: '24px', textAlign: 'center' }}>{currentQty}</span>
                          <button 
                            style={{ padding: '2px 8px', border: 'none', background: 'transparent', cursor: currentQty >= item.quantity ? 'not-allowed' : 'pointer', color: currentQty >= item.quantity ? '#ccc' : '#333' }}
                            disabled={currentQty >= item.quantity}
                            onClick={() => setSelectedRefundItems(p => ({ ...p, [item.id]: (p[item.id] || 0) + 1 }))}
                          >+</button>
                        </div>
                        <div style={{ fontWeight: '600', minWidth: '60px', textAlign: 'right' }}>{formatPrice(item.item_price * currentQty)}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {(order.coupon_ids?.length ?? 0) > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '13px', color: '#666', marginBottom: '8px', fontWeight: 'bold' }}>
                  客户本单所用的优惠券 
                  <span style={{ fontSize: '12px', color: '#ef4444', marginLeft: '6px' }}>(勾选优惠券退回给客户)</span>
                </div>
                <label style={{ display: 'block', cursor: 'pointer' }}>
                  <div style={{ 
                    padding: '12px', background: isCouponRefundIncluded ? '#eff6ff' : '#f9fafb', 
                    borderRadius: '8px', border: `1px solid ${isCouponRefundIncluded ? '#bfdbfe' : '#e5e7eb'}`, 
                    display: 'flex', alignItems: 'center', gap: '10px', transition: 'all 0.2s'
                  }}>
                    <input 
                      type="checkbox" 
                      style={{ transform: 'scale(1.2)', marginLeft: '4px' }}
                      checked={isCouponRefundIncluded} 
                      onChange={e => setIsCouponRefundIncluded(e.target.checked)} 
                    />
                    <div style={{ width: '40px', height: '40px', background: isCouponRefundIncluded ? '#3b82f6' : '#9ca3af', color: '#fff', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: '14px', fontWeight: 'bold' }}>券</span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 'bold', color: isCouponRefundIncluded ? '#1e3a8a' : '#374151' }}>
                          {usedCoupons.length > 0 ? usedCoupons.map(c => c.title).join(' + ') : '加载中...'}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: isCouponRefundIncluded ? '#3b82f6' : '#6b7280', marginTop: '4px' }}>
                        抵扣额度: {formatPrice(Number(order.coupon_discount_amount || 0))} 
                        {isCouponRefundIncluded ? ' · 即将退回客户账户' : ''}
                      </div>
                    </div>
                  </div>
                </label>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '20px', marginBottom: '16px', background: '#fff7ed', padding: '12px', borderRadius: '8px' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '14px', fontWeight: '700', color: '#9a3412' }}>拟退款金额合计</span>
                {currentRefundTotal() >= Number(order.total_amount) && (
                  <span style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>不可大于实付 {formatPrice(Number(order.total_amount))}</span>
                )}
              </div>
              <span style={{ fontSize: '24px', fontWeight: '800', color: '#ea580c' }}>{formatPrice(currentRefundTotal())}</span>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn btn-outline" style={{ flex: 1, color: '#ef4444', borderColor: '#fca5a5' }} onClick={handleRejectRefund}>驳回售后</button>
              <button className="btn btn-primary" style={{ flex: 2, background: '#ea580c' }} onClick={handleConfirmRefund}>同意入账并完结</button>
            </div>
          </div>
        </>
      )}

      {/* 推进状态二次确认弹窗 */}
      {isConfirmingStatus && (() => {
        const idx = STATUS_FLOW.indexOf(order.status)
        const nextStatus = STATUS_FLOW[idx + 1]
        return (
          <>
            <div className="overlay" style={{ zIndex: 110 }} onClick={() => setIsConfirmingStatus(false)} />
            <div className="dialog" style={{ zIndex: 120 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: '56px', height: '56px', borderRadius: '50%',
                  background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 14px'
                }}>
                  <AlertTriangle size={28} color="#ef4444" />
                </div>
                <h3 style={{ fontWeight: '800', marginBottom: '10px' }}>确认更新状态？</h3>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: '10px', margin: '14px 0', fontSize: '15px'
                }}>
                  <span style={{
                    padding: '4px 12px', borderRadius: '20px',
                    background: '#f5f5f4', fontWeight: '600', color: '#78716c'
                  }}>{STATUS_LABELS[order.status]}</span>
                  <ChevronRight size={18} color="#f59e0b" />
                  <span style={{
                    padding: '4px 12px', borderRadius: '20px',
                    background: '#fff7ed', fontWeight: '700', color: '#ea580c',
                    border: '1px solid #fed7aa'
                  }}>{STATUS_LABELS[nextStatus]}</span>
                </div>
                <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '20px' }}>
                  {order.customer_name} · {formatPrice(Number(order.total_amount))}
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => setIsConfirmingStatus(false)} className="btn btn-outline" style={{ flex: 1 }}>再想想</button>
                  <button onClick={updateStatus} className="btn btn-primary" style={{ flex: 1 }}>确认</button>
                </div>
              </div>
            </div>
          </>
        )
      })()}
    </>
  )
}
