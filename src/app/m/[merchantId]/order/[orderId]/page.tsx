'use client'

import { useState, useEffect, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Order, Merchant, OrderItem, Message } from '@/lib/types'
import { formatPrice, getCountdown } from '@/lib/utils'
import { calculatePenalty } from '@/lib/penalty'
import { 
  CheckCircle2, Clock, MapPin,
  ArrowLeft, AlertCircle, QrCode, X, Star, Send, MessageSquare
} from 'lucide-react'
import Link from 'next/link'

const STATUS_MAP: Record<string, { label: string, color: string, step: number }> = {
  pending: { label: '待收单', color: '#f97316', step: 1 },
  preparing: { label: '制作中', color: '#3b82f6', step: 2 },
  delivering: { label: '配送中', color: '#22c55e', step: 3 },
  completed: { label: '已完成', color: '#047857', step: 4 },
  cancelled: { label: '已取消', color: '#ef4444', step: 0 }
}

export default function OrderStatusPage({ params }: { params: Promise<{ merchantId: string, orderId: string }> }) {
  const supabase = createClient()
  const { merchantId, orderId } = use(params)

  const [order, setOrder] = useState<Order | null>(null)
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [items, setItems] = useState<OrderItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showPayQr, setShowPayQr] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [, setTick] = useState(0)

  // 消息对话
  const [messages, setMessages] = useState<Message[]>([])
  const [msgText, setMsgText] = useState('')
  const [rating, setRating] = useState(0)
  const [sendingMsg, setSendingMsg] = useState(false)

  async function loadData() {
    const [oRes, mRes, iRes] = await Promise.all([
      supabase.from('orders').select('*').eq('id', orderId).single(),
      supabase.from('merchants').select('*').eq('id', merchantId).single(),
      supabase.from('order_items').select('*').eq('order_id', orderId)
    ])

    if (oRes.data) setOrder(oRes.data)
    if (mRes.data) setMerchant(mRes.data)
    if (iRes.data) setItems(iRes.data)
    // 加载消息
    loadMessages()
    setLoading(false)
  }

  useEffect(() => {
    loadData()
    const timer = setInterval(() => setTick(t => t + 1), 60000)
    
    // 监听订单状态变更
    const channel = supabase
      .channel('order-update')
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'orders', 
        filter: `id=eq.${orderId}` 
      }, (payload) => {
        setOrder(payload.new as Order)
      })
      // 实时收到商家回复
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `order_id=eq.${orderId}`,
      }, () => {
        loadMessages()
      })
      .subscribe()

    return () => {
      clearInterval(timer)
      supabase.removeChannel(channel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  async function loadMessages() {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true })
    setMessages(data || [])
    // 将商家发的消息标记客户已读
    const unread = (data || []).filter((m: Message) => m.sender === 'merchant' && !m.is_read_by_customer)
    if (unread.length > 0) {
      await supabase.from('messages').update({ is_read_by_customer: true }).in('id', unread.map((m: Message) => m.id))
    }
  }

  async function sendMessage() {
    if (!msgText.trim() || !order) return
    setSendingMsg(true)
    await supabase.from('messages').insert({
      order_id: orderId,
      merchant_id: merchantId,
      sender: 'customer',
      content: msgText.trim(),
      rating: rating || null,
      is_read_by_merchant: false,
      is_read_by_customer: true,
    })
    setMsgText('')
    setRating(0)
    setSendingMsg(false)
  }

  async function handleCancel() {
    if (!order) return
    const penaltyRes = calculatePenalty(Number(order.total_amount), new Date(order.created_at))
    
    const { error } = await supabase
      .from('orders')
      .update({
        status: 'cancelled',
        cancelled_by: 'customer',
        cancelled_at: new Date().toISOString(),
        penalty_rate: penaltyRes.penaltyRate,
        penalty_amount: penaltyRes.penaltyAmount,
        refund_amount: penaltyRes.refundAmount
      })
      .eq('id', order.id)

    if (error) alert('取消失败')
    else {
      setShowCancelConfirm(false)
      loadData()
    }
  }

  if (loading || !order) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <span className="spinner" />
    </div>
  )

  const status = STATUS_MAP[order.status]
  const penalty = calculatePenalty(Number(order.total_amount), new Date(order.created_at))

  return (
    <div style={{ minHeight: '100vh', background: '#f8f9fa' }}>
      {/* 顶部状态色块 */}
      <div style={{ 
        background: status.color, color: 'white', padding: '40px 24px 80px',
        textAlign: 'center', transition: 'background 0.3s'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
          {order.status === 'completed' ? <CheckCircle2 size={32} /> : <Clock size={32} />}
          <h1 style={{ fontSize: '24px', fontWeight: '800' }}>{status.label}</h1>
        </div>
        <p style={{ opacity: 0.9, fontSize: '14px' }}>
          {order.status === 'pending' && '等待商家接单，请您在下方扫码支付'}
          {order.status === 'preparing' && '商家正在全力为您配菜制作中...'}
          {order.status === 'delivering' && '您的美食正在飞奔而来的路上！'}
          {order.status === 'completed' && '订单已送达，祝您用餐愉快！'}
          {order.status === 'cancelled' && '订单已取消'}
        </p>
      </div>

      <div style={{ padding: '0 16px 100px', marginTop: '-40px' }}>
        {/* 状态卡片 */}
        <div className="card" style={{ marginBottom: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
          <div className="progress-bar" style={{ margin: '10px 0 20px' }}>
            {[1, 2, 3, 4].map(s => (
              <div key={s} className={`progress-step ${status.step >= s ? 'completed' : ''} ${status.step === s ? 'active' : ''}`} />
            ))}
          </div>
          
          {order.status !== 'cancelled' && order.status !== 'completed' && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
              <span style={{ fontSize: '14px', color: '#f97316', fontWeight: '700', padding: '6px 12px', background: '#fff7ed', borderRadius: '20px' }}>
                预计送达：{getCountdown(order.scheduled_time)}
              </span>
            </div>
          )}

          {/* 支付按钮 */}
          {order.status === 'pending' && (merchant?.payment_qr_urls?.wechat || merchant?.payment_qr_urls?.alipay || merchant?.payment_qr_url) && (
            <button 
              className="btn btn-primary btn-block"
              style={{ height: '48px', borderRadius: '12px', marginBottom: '12px' }}
              onClick={() => setShowPayQr(true)}
            >
              <QrCode size={18} /> 查看支付收款码
            </button>
          )}

          {order.status === 'pending' && (
            <button 
              className="btn btn-outline btn-block"
              style={{ color: '#ef4444' }}
              onClick={() => setShowCancelConfirm(true)}
            >
              取消订单
            </button>
          )}
        </div>

        {/* 订单详情卡片 */}
        <div className="card" style={{ marginBottom: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '800', marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid #f5f5f4' }}>
            配送信息
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <Clock size={16} color="#999" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div style={{ fontSize: '14px' }}>
                <div style={{ color: '#999', fontSize: '12px' }}>预定送达时间</div>
                <div style={{ fontWeight: '600' }}>{new Date(order.scheduled_time).toLocaleString('zh-CN')}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <MapPin size={16} color="#999" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div style={{ fontSize: '14px' }}>
                <div style={{ color: '#999', fontSize: '12px' }}>配送地址</div>
                <div style={{ fontWeight: '600' }}>{order.address}</div>
                <div style={{ color: '#666' }}>{order.customer_name} {order.phone}</div>
              </div>
            </div>
          </div>
        </div>

        {/* 菜品明细卡片 */}
        <div className="card">
          <h3 style={{ fontSize: '15px', fontWeight: '800', marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid #f5f5f4' }}>
            订单内容
          </h3>
          {items.map(item => (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '12px' }}>
              <span>{item.item_name} x{item.quantity}</span>
              <span style={{ fontWeight: '600' }}>{formatPrice(item.item_price * item.quantity)}</span>
            </div>
          ))}
          <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px dashed #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '15px', fontWeight: '700' }}>应付金额</span>
            <span style={{ fontSize: '20px', fontWeight: '800', color: 'var(--color-primary)' }}>{formatPrice(Number(order.total_amount))}</span>
          </div>
          <div style={{ fontSize: '12px', color: '#999', marginTop: '12px', textAlign: 'right' }}>
            下单时间：{new Date(order.created_at).toLocaleString('zh-CN')}
          </div>
        </div>
      </div>

      <div style={{ position: 'fixed', bottom: '20px', left: '20px', right: '20px' }}>
        <Link href={`/m/${merchantId}`}>
          <button className="btn btn-outline btn-block" style={{ background: 'white', height: '44px', borderRadius: '22px' }}>
            <ArrowLeft size={16} /> 返回菜单
          </button>
        </Link>
      </div>

      {/* 收款码弹窗 */}
      {showPayQr && (
        <>
          <div className="overlay" style={{ zIndex: 100 }} onClick={() => setShowPayQr(false)} />
          <div className="dialog" style={{ zIndex: 110, textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontWeight: '800' }}>扫码支付</h3>
              <button onClick={() => setShowPayQr(false)} style={{ background: 'none', border: 'none' }}><X size={20} /></button>
            </div>
            <p style={{ fontSize: '14px', color: '#666', marginBottom: '16px' }}>请扫码支付 <span style={{ color: 'var(--color-primary)', fontWeight: '700' }}>{formatPrice(Number(order.total_amount))}</span></p>
            {/* 多张收款码并排居中 */}
            <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
              {(merchant?.payment_qr_urls?.wechat) && (
                <div style={{ textAlign: 'center' }}>
                  <img src={merchant.payment_qr_urls.wechat} alt="微信收款码" style={{ width: '160px', height: '160px', objectFit: 'contain', borderRadius: '12px', border: '2px solid #bbf7d0' }} />
                  <div style={{ fontSize: '13px', color: '#15803d', fontWeight: '700', marginTop: '6px' }}>🟢 微信支付</div>
                </div>
              )}
              {(merchant?.payment_qr_urls?.alipay) && (
                <div style={{ textAlign: 'center' }}>
                  <img src={merchant.payment_qr_urls.alipay} alt="支付宝收款码" style={{ width: '160px', height: '160px', objectFit: 'contain', borderRadius: '12px', border: '2px solid #bfdbfe' }} />
                  <div style={{ fontSize: '13px', color: '#1d4ed8', fontWeight: '700', marginTop: '6px' }}>🔵 支付宝</div>
                </div>
              )}
              {/* 匹配老字段，如果新字段都没有 */}
              {!merchant?.payment_qr_urls?.wechat && !merchant?.payment_qr_urls?.alipay && merchant?.payment_qr_url && (
                <img src={merchant.payment_qr_url} alt="收款码" style={{ width: '200px', height: '200px', objectFit: 'contain', borderRadius: '12px', border: '1px solid #eee' }} />
              )}
            </div>
            <div style={{ marginTop: '16px', padding: '12px', background: '#f0fdf4', borderRadius: '8px', color: '#15803d', fontSize: '13px' }}>
              支付完成后请耐心等待商家确认收单
            </div>
          </div>
        </>
      )}

      {/* 取消确认弹窗 */}
      {showCancelConfirm && (
        <>
          <div className="overlay" style={{ zIndex: 100 }} onClick={() => setShowCancelConfirm(false)} />
          <div className="dialog" style={{ zIndex: 110, textAlign: 'center' }}>
            <AlertCircle size={48} color="#ef4444" style={{ margin: '0 auto 16px' }} />
            <h3 style={{ fontWeight: '800', marginBottom: '12px' }}>确认取消订单？</h3>
            <div style={{ 
              background: penalty.hasPenalty ? '#fef2f2' : '#f0fdf4', 
              padding: '16px', borderRadius: '12px', textAlign: 'left', marginBottom: '20px' 
            }}>
              <p style={{ fontSize: '14px', color: '#444', marginBottom: '8px' }}>{penalty.message}</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', borderTop: '1px solid #eee', paddingTop: '8px' }}>
                <span style={{ color: '#666' }}>违约金 ({ (penalty.penaltyRate*100).toFixed(0) }%)</span>
                <span style={{ color: '#ef4444', fontWeight: '700' }}>-{formatPrice(penalty.penaltyAmount)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: '800', marginTop: '4px' }}>
                <span>预计退款</span>
                <span style={{ color: '#22c55e' }}>{formatPrice(penalty.refundAmount)}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button 
                className="btn btn-outline" 
                style={{ flex: 1 }} 
                onClick={() => setShowCancelConfirm(false)}
              >
                再想想
              </button>
              <button 
                className="btn btn-danger" 
                style={{ flex: 1 }}
                onClick={handleCancel}
              >
                确认取消
              </button>
            </div>
          </div>
        </>
      )}

      {/* 评论与消息对话区（已完成或已取消时显示） */}
      {order && ['completed', 'cancelled'].includes(order.status) && (
        <div style={{ margin: '16px', background: 'white', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MessageSquare size={18} color="var(--color-primary)" />
            <span style={{ fontWeight: '700', fontSize: '15px' }}>评论与消息</span>
          </div>

          {/* 消息列表 */}
          <div style={{ padding: '12px 16px', maxHeight: '280px', overflowY: 'auto' }}>
            {messages.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#aaa', fontSize: '13px', padding: '20px 0' }}>
                订单已{order.status === 'completed' ? '完成' : '取消'}，可以给商家留言啖~
              </div>
            ) : messages.map(msg => (
              <div key={msg.id} style={{
                display: 'flex',
                justifyContent: msg.sender === 'customer' ? 'flex-end' : 'flex-start',
                marginBottom: '10px',
              }}>
                <div style={{ maxWidth: '75%' }}>
                  {msg.sender === 'customer' && msg.rating && (
                    <div style={{ display: 'flex', gap: '2px', marginBottom: '4px', justifyContent: 'flex-end' }}>
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} size={13} fill={i < msg.rating! ? '#f97316' : 'none'} color={i < msg.rating! ? '#f97316' : '#d1d5db'} />
                      ))}
                    </div>
                  )}
                  <div style={{
                    padding: '10px 13px',
                    borderRadius: msg.sender === 'customer' ? '18px 4px 18px 18px' : '4px 18px 18px 18px',
                    background: msg.sender === 'customer' ? 'var(--color-primary)' : '#f3f4f6',
                    color: msg.sender === 'customer' ? 'white' : '#1c1917',
                    fontSize: '14px', lineHeight: '1.5',
                  }}>{msg.content}</div>
                  <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '3px', textAlign: msg.sender === 'customer' ? 'right' : 'left' }}>
                    {new Date(msg.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    {msg.sender === 'merchant' && <span style={{ marginLeft: '4px', color: '#22c55e' }}>商家回复</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* 评分选择 */}
          <div style={{ padding: '0 16px 8px' }}>
            <div style={{ fontSize: '12px', color: '#999', marginBottom: '6px' }}>评分（选填）</div>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
              {[1, 2, 3, 4, 5].map(s => (
                <button key={s} onClick={() => setRating(r => r === s ? 0 : s)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}>
                  <Star size={24} fill={s <= rating ? '#f97316' : 'none'} color={s <= rating ? '#f97316' : '#d1d5db'} />
                </button>
              ))}
            </div>
          </div>

          {/* 输入框 */}
          <div style={{ padding: '0 16px 16px', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <textarea
              value={msgText}
              onChange={e => setMsgText(e.target.value)}
              placeholder="给商家留言或评论..."
              rows={2}
              style={{
                flex: 1, border: '1px solid var(--color-border)',
                borderRadius: '12px', padding: '10px 12px',
                resize: 'none', fontSize: '14px', fontFamily: 'inherit',
                outline: 'none',
              }}
            />
            <button
              onClick={sendMessage}
              disabled={sendingMsg || !msgText.trim()}
              className="btn btn-primary"
              style={{ height: '44px', width: '44px', padding: 0, borderRadius: '50%', flexShrink: 0 }}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
