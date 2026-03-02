'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Order, Merchant, OrderItem, Message } from '@/lib/types'
import { formatPrice, getCountdown } from '@/lib/utils'
import { calculateCancellationPenalty } from '@/lib/order'
import { 
  CheckCircle2, Clock, MapPin, MessageSquare, Send, Star, AlertTriangle, AlertCircle, ChevronLeft, ChevronRight, X,
  ArrowLeft, RefreshCw, QrCode
} from 'lucide-react'
import Link from 'next/link'
import React from 'react'

const STATUS_MAP: Record<string, { label: string, color: string, step: number }> = {
  pending: { label: '待收单', color: '#f97316', step: 1 },
  preparing: { label: '制作中', color: '#3b82f6', step: 2 },
  delivering: { label: '配送中', color: '#22c55e', step: 3 },
  completed: { label: '已完成', color: '#047857', step: 4 },
  cancelled: { label: '已取消', color: '#ef4444', step: 0 }
}

export default function OrderStatusPage({ params }: { params: Promise<{ merchantId: string, orderId: string }> }) {
  const supabase = createClient()
  const router = useRouter()
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

  // 消息动态滚动与条件判定
  const msgBoxRef = React.useRef<HTMLDivElement>(null)
  const isInitialLoad = React.useRef(true) // 追踪是否为初次加载页面
  
  // 仅在“订单已完成”状态，或时间线上出现过商家发送的“after_sales_closed”完结语后，释放展示打分板
  const shouldShowRatingPanel = !!order && (
    order.status === 'completed' || 
    messages.some(m => m.msg_type === 'after_sales_closed')
  ) && !messages.some(m => m.sender === 'customer' && m.rating)
  
  useEffect(() => {
    if (msgBoxRef.current) {
      // 内部滚动始终到底部，以便看到最新消息
      msgBoxRef.current.scrollTop = msgBoxRef.current.scrollHeight
      
      // 如果是初次进入页面（初始化加载数据），绝对不要触发布屏视口滚动
      if (isInitialLoad.current) {
        if (messages.length > 0) {
          isInitialLoad.current = false // 拿到第一波历史消息后，标记初始化结束
        }
        return
      }

      // 如果不是初次加载（比如刚发完消息，或实时收到了新消息），则确保视口对准聊天区
      const rect = msgBoxRef.current.getBoundingClientRect()
      if (rect.bottom > window.innerHeight) {
         window.scrollTo({ top: window.scrollY + (rect.bottom - window.innerHeight) + 50, behavior: 'smooth' })
      }
    }
  }, [messages])

  // 售后相关
  const [showAfterSales, setShowAfterSales] = useState(false)
  const [afterSalesReason, setAfterSalesReason] = useState('')
  const [afterSalesReasonDetail, setAfterSalesReasonDetail] = useState('')
  const [afterSalesItems, setAfterSalesItems] = useState<string[]>([])
  const [afterSalesImages, setAfterSalesImages] = useState<File[]>([])
  const [uploadingImage, setUploadingImage] = useState(false)
  const [urgeCountdown, setUrgeCountdown] = useState(0)

  // 取消原因
  const [cancelReason, setCancelReason] = useState('')

  useEffect(() => {
    if (!order || order.after_sales_status !== 'pending') {
      setUrgeCountdown(0)
      return
    }
    // eslint-disable-next-line
    const timer = setInterval(() => {
      const lastUrge = order.after_sales_last_urge_at ? new Date(order.after_sales_last_urge_at).getTime() : 0
      const now = new Date().getTime()
      if (lastUrge > 0) {
        const diff = Math.floor((now - lastUrge) / 1000)
        const remain = 300 - diff
        if (remain > 0) {
          setUrgeCountdown(remain)
        } else {
          setUrgeCountdown(0)
        }
      } else {
        setUrgeCountdown(0)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [order])

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
      // 实时收到留言/评论（覆盖了原先由于分离表导致的重复监听）
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



  async function handleQuickRating(score: number) {
    if (sendingMsg || !order) return
    setSendingMsg(true)
    const content = msgText.trim() || `客户评了 ${score} 星 ⭐`
    await supabase.from('messages').insert({
      order_id: orderId,
      merchant_id: merchantId,
      sender: 'customer',
      content,
      rating: score,
      is_read_by_merchant: false,
      is_read_by_customer: true,
    })
    setMsgText('')
    setRating(0)
    setSendingMsg(false)
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

  async function handleNegotiateRefund() {
    if (!order) return
    setSendingMsg(true)
    const content = "【协商退单】客户由于配送中等原因申请取消订单，请及时处理"
    
    // 同步更新订单状态，使商家端弹出“去处理”面板
    const { error: orderError } = await supabase.from('orders').update({
      after_sales_status: 'pending',
      after_sales_reason: '客户在配送中申请协商退单',
      after_sales_urge_count: 0,
      after_sales_last_urge_at: new Date().toISOString()
    }).eq('id', orderId)

    if (orderError) {
      console.error('Update order after_sales_status error:', orderError)
    }

    await supabase.from('messages').insert({
      order_id: orderId,
      merchant_id: merchantId,
      sender: 'customer',
      content,
      msg_type: 'after_sales',
      is_read_by_merchant: false,
      is_read_by_customer: true,
    })
    setSendingMsg(false)
    loadData() // 刷新订单状态
    loadMessages()
    // 滚动到聊天区域，让视口对准对话栏
    setTimeout(() => {
      msgBoxRef.current?.closest('.card')?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, 200)
  }

  async function handleCancel() {
    if (!order) return
    const penaltyRes = calculateCancellationPenalty(order)
    
    // 不允许强制取消的阶段，拦截
    if (!penaltyRes.canCancel) {
       alert(penaltyRes.reason)
       setShowCancelConfirm(false)
       return
    }

    const penaltyAmount = Number(order.total_amount) * penaltyRes.rate
    const refundAmount = Number(order.total_amount) - penaltyAmount
    
    const { error } = await supabase
      .from('orders')
      .update({
        status: 'cancelled',
        cancelled_by: 'customer',
        cancelled_at: new Date().toISOString(),
        penalty_rate: penaltyRes.rate,
        penalty_amount: penaltyAmount,
        refund_amount: refundAmount,
        after_sales_reason: cancelReason.trim()
      })
      .eq('id', order.id)

    if (error) alert('取消失败')
    else {
      setShowCancelConfirm(false)
      loadData()
    }
  }

  async function handleSubmitAfterSales() {
    if (!order) return
    if (!afterSalesReason) return alert('请先选择售后原因')
    if (afterSalesReason === '菜品不合适' && afterSalesItems.length === 0) {
      return alert('请勾选遇到问题的具体菜品')
    }
    if (['有异物', '包装破损严重'].includes(afterSalesReason) && afterSalesImages.length === 0) {
      return alert('请至少上传1张图片凭证以供查明问题')
    }
    if (afterSalesReason === '其他原因' && !afterSalesReasonDetail.trim()) {
      return alert('请补充填写详细情况')
    }

    let uploadedUrls: string[] = []
    if (['有异物', '包装破损严重'].includes(afterSalesReason) && afterSalesImages.length > 0) {
      setUploadingImage(true)
      try {
        for (const file of afterSalesImages) {
          const fileName = `${merchantId}/${order.id}_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`
          const { error } = await supabase.storage.from('after_sales_images').upload(fileName, file, { contentType: file.type })
          if (error) throw error
          const { data: { publicUrl } } = supabase.storage.from('after_sales_images').getPublicUrl(fileName)
          uploadedUrls.push(publicUrl)
        }
      } catch (err: any) {
        alert('图片上传失败: ' + err.message)
        setUploadingImage(false)
        return
      }
      setUploadingImage(false)
    }

    let finalReason = afterSalesReason
    if (afterSalesReason === '其他原因' && afterSalesReasonDetail.trim()) {
      finalReason = afterSalesReasonDetail.trim()
    }

    const { error } = await supabase
      .from('orders')
      .update({ 
        after_sales_status: 'pending', 
        after_sales_reason: finalReason,
        after_sales_items: afterSalesReason === '菜品不合适' ? afterSalesItems : null,
        after_sales_images: uploadedUrls.length > 0 ? uploadedUrls : null,
        after_sales_urge_count: 0,
        after_sales_last_urge_at: new Date().toISOString()
      })
      .eq('id', order.id)
      
    if (error) {
      alert('发起售后失败: ' + error.message)
    } else {
      // 自动发送第一条售后沟通消息
      let firstMsgContent = `【发起售后】原因：${finalReason}`
      if (afterSalesReason === '菜品不合适' && afterSalesItems.length > 0) {
        const itemNames = items.filter(i => afterSalesItems.includes(i.id)).map(i => i.item_name).join('、')
        firstMsgContent += `\n涉及菜品：${itemNames}`
      }
      await supabase.from('messages').insert({
        order_id: order.id,
        merchant_id: merchantId,
        sender: 'customer',
        content: firstMsgContent,
        msg_type: 'after_sales',
        is_read_by_merchant: false,
        is_read_by_customer: true,
      })

      setShowAfterSales(false)
      loadData()
      loadMessages()
    }
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return
    const newFiles: File[] = []
    for (let i = 0; i < e.target.files.length; i++) {
      const file = e.target.files[i]
      if (!file.type.startsWith('image/')) continue
      
      const compressedFile = await new Promise<File>((resolve) => {
        const reader = new FileReader()
        reader.onload = (event) => {
          const img = new Image()
          img.onload = () => {
            const canvas = document.createElement('canvas')
            let { width, height } = img
            const max = 1080
            if (width > max || height > max) {
              if (width > height) {
                height = Math.round(height * max / width)
                width = max
              } else {
                width = Math.round(width * max / height)
                height = max
              }
            }
            canvas.width = width
            canvas.height = height
            const ctx = canvas.getContext('2d')
            ctx?.drawImage(img, 0, 0, width, height)
            canvas.toBlob((blob) => {
              if (blob) {
                resolve(new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", { type: 'image/jpeg' }))
              } else {
                resolve(file)
              }
            }, 'image/jpeg', 0.7)
          }
          img.src = event.target?.result as string
        }
        reader.readAsDataURL(file)
      })
      newFiles.push(compressedFile)
    }
    setAfterSalesImages(prev => {
      const combined = [...prev, ...newFiles]
      if (combined.length > 2) {
        alert('最多只能上传 2 张照片凭证喔！')
        return combined.slice(0, 2)
      }
      return combined
    })
  }

  async function handleUrgeOrder() {
    if (!order) return
    const { error } = await supabase
      .from('orders')
      .update({
        after_sales_urge_count: (order.after_sales_urge_count || 0) + 1,
        after_sales_last_urge_at: new Date().toISOString()
      })
      .eq('id', order.id)
      
    if (error) alert('催促失败，请稍后重试')
    else {
      alert('已向商家发送催促提醒！')
      loadData()
    }
  }

  if (loading || !order) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <span className="spinner" />
    </div>
  )

  const status = STATUS_MAP[order.status]
  const penalty = calculateCancellationPenalty(order)

  return (
    <div style={{ minHeight: '100vh', paddingBottom: '80px', background: '#f8f9fa' }}>
      {/* 顶部状态色块 */}
      <div style={{ 
        background: status.color, color: 'white', padding: '40px 24px 80px',
        textAlign: 'center', transition: 'background 0.3s'
      }}>
        <div style={{ position: 'absolute', top: '16px', left: '16px' }}>
          <Link href={`/m/${merchantId}/orders`} style={{ textDecoration: 'none' }}>
            <div style={{ 
              width: '36px', height: '36px', borderRadius: '50%', 
              background: 'rgba(255,255,255,0.2)', display: 'flex', 
              alignItems: 'center', justifyContent: 'center', color: 'white' 
            }}>
              <ArrowLeft size={20} />
            </div>
          </Link>
        </div>
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

      <div style={{ padding: '0 16px', marginTop: '-40px' }}>
        {/* 状态卡片 */}
        <div className="card" style={{ marginBottom: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
          <div className="progress-bar" style={{ margin: '10px 0 20px' }}>
            {[1, 2, 3, 4].map(s => (
              <div key={s} className={`progress-step ${status.step >= s ? 'completed' : ''} ${status.step === s ? 'active' : ''}`} />
            ))}
          </div>
          
          {order.status !== 'cancelled' && order.status !== 'completed' && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
              <span style={{ fontSize: '14px', color: '#f59e0b', fontWeight: '700', padding: '6px 12px', background: '#fef3c7', borderRadius: '20px' }}>
                预计送达：{getCountdown(order.scheduled_time)}
              </span>
            </div>
          )}

          {/* 支付/取消/售后操作区域 */}
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

          {order.status === 'preparing' && (
            <button 
              className="btn btn-outline btn-block"
              style={{ color: '#ef4444' }}
              onClick={() => setShowCancelConfirm(true)}
            >
              退单
            </button>
          )}

          {order.status === 'delivering' && order.after_sales_status === 'none' && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                className="btn btn-outline"
                style={{ flex: 1, color: '#ef4444', borderColor: '#fca5a5' }}
                onClick={() => setShowCancelConfirm(true)}
              >
                强制退单
              </button>
              <button 
                className="btn btn-outline"
                style={{ flex: 1, color: '#f59e0b', borderColor: '#fcd34d' }}
                onClick={handleNegotiateRefund}
              >
                与商家协商退单
              </button>
            </div>
          )}

          {order.status === 'completed' && order.after_sales_status === 'none' && (
            <button 
              className="btn btn-outline btn-block"
              style={{ color: '#f59e0b', borderColor: '#fcd34d' }}
              onClick={() => setShowAfterSales(true)}
            >
              对菜品不满意？申请售后
            </button>
          )}

          {order.after_sales_status === 'pending' && (
             <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', padding: '14px', borderRadius: '8px', textAlign: 'center', marginBottom: '16px' }}>
               <div style={{ color: '#ef4444', fontSize: '14px', fontWeight: 'bold', marginBottom: '10px' }}>
                 售后申请已提交，等待商家处理...
               </div>
               <button
                 disabled={urgeCountdown > 0}
                 onClick={handleUrgeOrder}
                 className="btn btn-outline btn-sm"
                 style={{ 
                   borderColor: urgeCountdown > 0 ? '#ccc' : '#ef4444', 
                   color: urgeCountdown > 0 ? '#999' : '#ef4444', 
                   background: urgeCountdown > 0 ? '#f3f4f6' : 'white',
                   borderRadius: '16px',
                   padding: '0 16px',
                   lineHeight: 1.5,
                   height: '32px'
                 }}
               >
                 {urgeCountdown > 0 
                   ? `(${Math.floor(urgeCountdown / 60).toString().padStart(2, '0')}:${(urgeCountdown % 60).toString().padStart(2, '0')} 后可再次催促)` 
                   : '催促商家处理'}
               </button>
             </div>
          )}
          {order.after_sales_status === 'resolved' && (
             <div style={{ background: '#f0fdf4', color: '#15803d', padding: '12px', borderRadius: '8px', fontSize: '13px', textAlign: 'center', fontWeight: 'bold', marginBottom: '16px' }}>
               售后处理完毕
             </div>
          )}
          {order.after_sales_status === 'rejected' && (
             <div style={{ background: '#fef2f2', color: '#ef4444', padding: '12px', borderRadius: '8px', fontSize: '13px', textAlign: 'center', fontWeight: 'bold', marginBottom: '16px' }}>
               商家已拒绝此次售后申请
             </div>
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

      {order.status === 'cancelled' && (
        <div style={{ position: 'fixed', bottom: '20px', left: '20px', right: '20px' }}>
          <button
            className="btn btn-primary"
            style={{ width: '100%', height: '44px', borderRadius: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            onClick={() => {
              // 将原订单菜品写入 localStorage 购物车
              const cartItems = items.map(item => ({
                menuItem: { id: item.menu_item_id || item.id, name: item.item_name, price: item.item_price, image_url: '', category_id: '', merchant_id: merchantId, is_available: true, sort_order: 0 },
                quantity: item.quantity
              }))
              localStorage.setItem(`cart_${merchantId}`, JSON.stringify(cartItems))
              router.push(`/m/${merchantId}`)
            }}
          >
            <RefreshCw size={16} /> 重新下单
          </button>
        </div>
      )}

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

      {/* 售后申请弹窗 */}
      {showAfterSales && (
        <>
          <div className="overlay" style={{ zIndex: 100 }} onClick={() => setShowAfterSales(false)} />
          <div className="dialog" style={{ zIndex: 110 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontWeight: '800' }}>申请售后及协商</h3>
              <button onClick={() => setShowAfterSales(false)} style={{ background: 'none', border: 'none' }}><X size={20} /></button>
            </div>
            <p style={{ fontSize: '13px', color: '#666', marginBottom: '16px', lineHeight: 1.5 }}>
              如果您的餐品存在质量问题，或配送过程中遇到特殊情况，可以向商家发起售后协商。
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
              {['菜品不合适', '有异物', '漏发/错发', '包装破损严重', '其他原因'].map(reason => (
                <span 
                  key={reason}
                  onClick={() => {
                    setAfterSalesReason(reason)
                    setAfterSalesItems([])
                    setAfterSalesImages([])
                    setAfterSalesReasonDetail('')
                  }}
                  style={{ 
                    padding: '6px 12px', borderRadius: '16px', fontSize: '13px', cursor: 'pointer',
                    background: afterSalesReason === reason ? 'var(--color-primary)' : '#f3f4f6',
                    color: afterSalesReason === reason ? 'white' : '#444',
                    border: '1px solid', borderColor: afterSalesReason === reason ? 'var(--color-primary)' : '#e5e7eb'
                  }}
                >
                  {reason}
                </span>
              ))}
            </div>

            {/* 动态显示：勾选菜品 */}
            {afterSalesReason === '菜品不合适' && (
              <div style={{ marginBottom: '16px', textAlign: 'left' }}>
                <p style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>请勾选存在问题的菜品：</p>
                <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '10px' }}>
                  {items.map(item => (
                    <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '13px' }}>
                      <input 
                        type="checkbox" 
                        checked={afterSalesItems.includes(item.id)}
                        onChange={(e) => {
                          if (e.target.checked) setAfterSalesItems([...afterSalesItems, item.id])
                          else setAfterSalesItems(afterSalesItems.filter(i => i !== item.id))
                        }}
                      />
                      <span style={{ flex: 1 }}>{item.item_name} x{item.quantity}</span>
                      <span style={{ color: '#999' }}>{formatPrice(item.item_price * item.quantity)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* 动态显示：上传照片 */}
            {['有异物', '包装破损严重'].includes(afterSalesReason) && (
              <div style={{ marginBottom: '16px', textAlign: 'left' }}>
                <p style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>请上传相关照片凭证（可选）：</p>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {afterSalesImages.map((file, idx) => (
                    <div key={idx} style={{ position: 'relative', width: '60px', height: '60px' }}>
                      <img src={URL.createObjectURL(file)} alt="凭证" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px' }} />
                      <button 
                        onClick={() => setAfterSalesImages(afterSalesImages.filter((_, i) => i !== idx))}
                        style={{ position: 'absolute', top: -6, right: -6, background: '#ef4444', color: 'white', borderRadius: '50%', border: 'none', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <label style={{ width: '60px', height: '60px', border: '1px dashed #d1d5db', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: '#f9fafb', color: '#9ca3af' }}>
                    <input type="file" multiple accept="image/*" onChange={handleImageSelect} style={{ display: 'none' }} />
                    <span style={{ fontSize: '24px' }}>+</span>
                  </label>
                </div>
              </div>
            )}

            {/* 其他原因输入框 */}
            {afterSalesReason === '其他原因' && (
              <textarea
                placeholder="请在这里补充填写详细情况..."
                value={afterSalesReasonDetail}
                onChange={e => setAfterSalesReasonDetail(e.target.value)}
                style={{
                  width: '100%', height: '80px', padding: '12px', border: '1px solid #e5e5e5',
                  borderRadius: '8px', marginBottom: '16px', fontSize: '14px', resize: 'none'
                }}
              />
            )}

            <button 
              className="btn btn-primary btn-block" 
              disabled={uploadingImage}
              onClick={handleSubmitAfterSales}
            >
              {uploadingImage ? '正在处理图片...' : '提交申请'}
            </button>
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
              background: penalty.rate > 0 ? '#fef2f2' : '#f0fdf4', 
              padding: '16px', borderRadius: '12px', textAlign: 'left', marginBottom: '16px' 
            }}>
              <p style={{ fontSize: '14px', color: '#444', marginBottom: '8px' }}>{penalty.reason}</p>
              
              {penalty.rate > 0 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', borderTop: '1px solid #eee', paddingTop: '8px' }}>
                    <span style={{ color: '#666' }}>违约金 ({ (penalty.rate*100).toFixed(0) }%)</span>
                    <span style={{ color: '#ef4444', fontWeight: '700' }}>-{formatPrice(Number(order.total_amount) * penalty.rate)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: '800', marginTop: '4px' }}>
                    <span>预计退款</span>
                    <span style={{ color: '#22c55e' }}>{formatPrice(Number(order.total_amount) * (1 - penalty.rate))}</span>
                  </div>
                </>
              )}
            </div>
            
            {/* 取消原因采集区 */}
            <div style={{ textAlign: 'left', marginBottom: '20px' }}>
              <p style={{ fontSize: '13px', color: '#666', marginBottom: '8px' }}>请选择取消原因以便我们改进服务：</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                {['计划有变', '配送超时', '其他原因'].map(reason => (
                  <span 
                    key={reason}
                    onClick={() => setCancelReason(reason)}
                    style={{ 
                      padding: '4px 10px', borderRadius: '16px', fontSize: '12px', cursor: 'pointer',
                      background: cancelReason === reason ? 'var(--color-primary)' : '#f3f4f6',
                      color: cancelReason === reason ? 'white' : '#444',
                      border: '1px solid', borderColor: cancelReason === reason ? 'var(--color-primary)' : '#e5e7eb'
                    }}
                  >
                    {reason}
                  </span>
                ))}
              </div>
              {cancelReason === '其他原因' && (
                <input 
                  className="input" 
                  placeholder="请输入取消原因..." 
                  style={{ height: '36px', fontSize: '13px' }}
                  onChange={e => setCancelReason(e.target.value)}
                />
              )}
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
                disabled={!cancelReason}
                onClick={handleCancel}
              >
                确认取消
              </button>
            </div>
          </div>
        </>
      )}

      {/* 统一留言/客服/评价流（取代原本干瘪的评论区） */}
      {order && !['pending', 'cancelled'].includes(order.status) && (
        <div style={{ margin: '16px', background: 'white', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MessageSquare size={18} color="var(--color-primary)" />
            <span style={{ fontWeight: '700', fontSize: '15px' }}>客服与评价</span>
          </div>

          <div 
            ref={msgBoxRef}
            style={{ padding: '12px 16px', minHeight: '120px', maxHeight: '420px', overflowY: 'auto', background: '#fafafa' }}
          >
            {messages.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#aaa', fontSize: '13px', padding: '20px 0' }}>
                还没有沟通记录喔，如有问题可以随时留言
              </div>
            ) : messages.map(msg => {
              const isCust = msg.sender === 'customer'
              const isAfterSales = msg.msg_type === 'after_sales'
              const isClosed = msg.msg_type === 'after_sales_closed'
              
              return (
                <div key={msg.id} style={{ display: 'flex', justifyContent: isCust ? 'flex-end' : 'flex-start', marginBottom: '16px' }}>
                  <div style={{ maxWidth: '85%' }}>
                    {/* 特型展示：如果是客户发出的带评价信息 */}
                    {isCust && msg.rating && (
                      <div style={{ display: 'flex', gap: '2px', marginBottom: '4px', justifyContent: 'flex-end' }}>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} size={14} fill={i < msg.rating! ? '#f59e0b' : 'none'} color={i < msg.rating! ? '#f59e0b' : '#d1d5db'} />
                        ))}
                      </div>
                    )}
                    
                    {/* 气泡本体 */}
                    <div style={{
                      padding: '12px 16px',
                      borderRadius: isCust ? '20px 4px 20px 20px' : '4px 20px 20px 20px',
                      background: isAfterSales ? (isCust ? '#ef4444' : '#fee2e2') : (isCust ? 'var(--color-primary)' : 'white'),
                      color: isAfterSales ? (isCust ? 'white' : '#991b1b') : (isCust ? 'white' : '#1c1917'),
                      boxShadow: isCust ? 'none' : '0 2px 8px rgba(0,0,0,0.04)',
                      border: isCust ? 'none' : '1px solid #f0f0f0',
                      fontSize: '14px', lineHeight: '1.6', whiteSpace: 'pre-wrap'
                    }}>
                      {/* 如果是系统特殊事件消息添加打眼标识 */}
                      {isAfterSales && isCust && <div style={{ fontSize: '12px', fontWeight: '800', marginBottom: '4px', opacity: 0.9 }}>🚨 发起售后争议</div>}
                      {isClosed && <div style={{ fontSize: '12px', fontWeight: '800', marginBottom: '4px', color: '#10b981' }}>✅ 纠纷已完结</div>}
                      {msg.content}
                    </div>
                    
                    <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px', textAlign: isCust ? 'right' : 'left' }}>
                      {new Date(msg.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      {!isCust && <span style={{ marginLeft: '4px', color: '#10b981', fontWeight: '600' }}>商家</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* 底部输入与动态评分区 */}
          <div style={{ padding: '12px 16px', background: 'white', borderTop: '1px solid #f5f5f5' }}>
            {/* 只在订单完结 或 售后完结状态下方露出的动态打分器 */}
            {shouldShowRatingPanel && (
              <div style={{ background: '#fef3c7', padding: '10px 14px', borderRadius: '12px', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '13px', color: '#d97706', fontWeight: '700' }}>本次服务还满意吗？留下评价吧 / 打分作为完结标记</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {[1, 2, 3, 4, 5].map(s => (
                    <button key={s} onClick={() => handleQuickRating(s)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', transition: 'transform 0.2s', transform: s <= rating ? 'scale(1.15)' : 'scale(1)' }}>
                      <Star size={24} fill={s <= rating ? '#f59e0b' : 'none'} color={s <= rating ? '#f59e0b' : '#d1d5db'} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
              <textarea
                value={msgText}
                onChange={e => setMsgText(e.target.value)}
                placeholder={rating > 0 ? "写点带星级的评价..." : "给商家留言..."}
                rows={2}
                style={{
                  flex: 1, border: '1px solid var(--color-border)',
                  borderRadius: '12px', padding: '10px 12px',
                  resize: 'none', fontSize: '14px', fontFamily: 'inherit',
                  outline: 'none', transition: 'border-color 0.2s',
                  background: '#fafafa'
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--color-primary)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'}
              />
              <button
                onClick={sendMessage}
                disabled={sendingMsg || (!msgText.trim() && rating === 0)}
                className="btn btn-primary"
                style={{ height: '44px', width: '44px', padding: 0, borderRadius: '50%', flexShrink: 0, opacity: (sendingMsg || (!msgText.trim() && rating === 0)) ? 0.5 : 1 }}
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
