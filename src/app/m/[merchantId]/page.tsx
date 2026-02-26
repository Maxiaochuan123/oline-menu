'use client'

import { useState, useEffect, useRef, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Merchant, Category, MenuItem, CartItem, Order } from '@/lib/types'
import { formatPrice, isWechat } from '@/lib/utils'
import { 
  Plus, Minus, ShoppingBag, Search, X, 
  MapPin, Phone, User, Clock, Briefcase, UserRound, ArrowRight, Package
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import WechatGuide from '@/components/customer/WechatGuide'
import NewItemsCarousel from '@/components/customer/NewItemsCarousel'

export default function ClientMenuPage({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = use(params)
  const supabase = createClient()
  const router = useRouter()

  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [activeCategory, setActiveCategory] = useState<string>('')
  
  const [cart, setCart] = useState<CartItem[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [isWechatEnv, setIsWechatEnv] = useState(false)
  
  // 详情/表单状态
  const [showCart, setShowCart] = useState(false)
  const [showOrderForm, setShowOrderForm] = useState(false)
  
  // 表单数据
  const [orderType, setOrderType] = useState<'personal' | 'company'>('personal')
  const [customerName, setCustomerName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 进行中的订单（悬浮进度条）
  const [activeOrder, setActiveOrder] = useState<Order | null>(null)

  const itemsRef = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    setIsWechatEnv(isWechat())
    loadData()
    
    // 加载购物车缓存
    const savedCart = localStorage.getItem(`cart_${merchantId}`)
    if (savedCart) {
      try { setCart(JSON.parse(savedCart)) } catch { /* ignore */ }
    }

    // 尝试带出用户信息
    const lastUser = localStorage.getItem(`customer_info_${merchantId}`)
    if (lastUser) {
      try {
        const info = JSON.parse(lastUser)
        setCustomerName(info.name)
        setPhone(info.phone)
        setAddress(info.address)
        // 查询该手机号进行中的订单
        loadActiveOrder(info.phone)
      } catch { /* ignore */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId])

  useEffect(() => {
    localStorage.setItem(`cart_${merchantId}`, JSON.stringify(cart))
  }, [cart, merchantId])

  // 加载该手机号进行中的最新订单
  async function loadActiveOrder(ph: string) {
    const { data } = await supabase
      .from('orders')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('phone', ph)
      .in('status', ['pending', 'preparing', 'delivering'])
      .order('created_at', { ascending: false })
      .limit(1)
    if (data && data.length > 0) setActiveOrder(data[0])
    else setActiveOrder(null)
  }

  // 实时订阅进行中订单状态变更
  useEffect(() => {
    if (!phone) return
    const channel = supabase
      .channel('menu-active-order')
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          const updated = payload.new as Order
          if (['pending', 'preparing', 'delivering'].includes(updated.status)) {
            setActiveOrder(updated)
          } else {
            // 完成或取消，消除悬浮条
            setActiveOrder(prev => prev?.id === updated.id ? null : prev)
          }
        }
      ).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [phone, supabase])

  async function loadData() {
    const [mRes, cRes, iRes] = await Promise.all([
      supabase.from('merchants').select('*').eq('id', merchantId).single(),
      supabase.from('categories').select('*').eq('merchant_id', merchantId).order('sort_order'),
      supabase.from('menu_items').select('*').eq('merchant_id', merchantId).eq('is_available', true)
    ])

    if (mRes.data) setMerchant(mRes.data)
    if (cRes.data) {
      setCategories(cRes.data)
      if (cRes.data.length > 0) setActiveCategory(cRes.data[0].id)
    }
    if (iRes.data) setMenuItems(iRes.data)
    setLoading(false)
  }

  function addToCart(item: MenuItem) {
    setCart(prev => {
      const existing = prev.find(i => i.menuItem.id === item.id)
      if (existing) {
        return prev.map(i => i.menuItem.id === item.id ? { ...i, quantity: i.quantity + 1 } : i)
      }
      return [...prev, { menuItem: item, quantity: 1, remark: '' }]
    })
  }

  function removeFromCart(itemId: string) {
    setCart(prev => {
      const existing = prev.find(i => i.menuItem.id === itemId)
      if (existing && existing.quantity > 1) {
        return prev.map(i => i.menuItem.id === itemId ? { ...i, quantity: i.quantity - 1 } : i)
      }
      return prev.filter(i => i.menuItem.id !== itemId)
    })
  }

  const totalAmount = cart.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0)
  const totalCount = cart.reduce((sum, item) => sum + item.quantity, 0)

  async function handleSubmitOrder() {
    if (!customerName || !phone || !address || !scheduledTime) {
      alert('请填写完整的配送信息')
      return
    }
    setSubmitting(true)

    try {
      // 1. 同步/创建客户信息
      let customerId = null
      const { data: customerData } = await supabase
        .from('customers')
        .select('id')
        .eq('merchant_id', merchantId)
        .eq('phone', phone)
        .maybeSingle()

      if (customerData) {
        customerId = customerData.id
        await supabase.from('customers').update({ name: customerName, address }).eq('id', customerId)
      } else {
        const { data: newCustomer } = await supabase
          .from('customers')
          .insert({ merchant_id: merchantId, name: customerName, phone, address })
          .select('id')
          .single()
        customerId = newCustomer?.id
      }

      // 保存信息到本地，下次自动带出
      localStorage.setItem(`customer_info_${merchantId}`, JSON.stringify({ name: customerName, phone, address }))

      // 2. 创建订单
      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .insert({
          merchant_id: merchantId,
          customer_id: customerId,
          order_type: orderType,
          phone,
          customer_name: customerName,
          address,
          scheduled_time: new Date(scheduledTime).toISOString(),
          total_amount: totalAmount,
          status: 'pending'
        })
        .select('id')
        .single()

      if (orderErr) throw orderErr

      // 3. 创建订单项
      const orderItems = cart.map(item => ({
        order_id: order.id,
        menu_item_id: item.menuItem.id,
        item_name: item.menuItem.name,
        item_price: item.menuItem.price,
        quantity: item.quantity,
        remark: item.remark
      }))

      const { error: itemsErr } = await supabase.from('order_items').insert(orderItems)
      if (itemsErr) throw itemsErr

      // 下单完成，弹窗支付告知
      setShowOrderForm(false)
      setCart([])
      localStorage.removeItem(`cart_${merchantId}`)
      // 写入最新订单 ID，供汇总返回时展示
      localStorage.setItem(`last_order_${merchantId}`, order.id)
      router.push(`/m/${merchantId}/order/${order.id}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '下单失败'
      alert(`下单失败: ${msg}`)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <span className="spinner" />
    </div>
  )

  if (isWechatEnv) return <WechatGuide />

  // 不接单弹窗逻辑
  if (merchant && !merchant.is_accepting_orders) {
    return (
      <div className="overlay" style={{ background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="dialog" style={{ position: 'relative', top: 'auto', left: 'auto', transform: 'none' }}>
          <div style={{ textAlign: 'center' }}>
            <Clock size={48} color="#f97316" style={{ margin: '0 auto 16px' }} />
            <h2 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '12px' }}>暂停接单中</h2>
            <div style={{ 
              background: '#fff7ed', padding: '16px', borderRadius: '12px', 
              color: '#c2410c', fontSize: '14px', lineHeight: '1.6' 
            }}>
              {merchant.announcement || '商家目前忙碌中，请稍后再来点餐~'}
            </div>
            <p style={{ marginTop: '20px', color: '#999', fontSize: '12px' }}>您可以收藏本页，等商家恢复接单后再次访问</p>
          </div>
        </div>
      </div>
    )
  }

  const filteredItems = menuItems.filter(i => 
    i.name.includes(search) || (i.description && i.description.includes(search))
  )

  const newItems = menuItems.filter(i => i.is_new && (!i.new_until || new Date(i.new_until) > new Date()))

  // 调试：查看新品数量及原始数据
  if (typeof window !== 'undefined') {
    console.log('[NewItems] menuItems总数:', menuItems.length)
    console.log('[NewItems] 符合条件新品:', newItems.length, newItems.map(i => ({ name: i.name, is_new: i.is_new, new_until: i.new_until })))
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* 搜索栏 */}
      <header style={{ 
        padding: '12px 16px', background: 'white', 
        borderBottom: '1px solid var(--color-border)', flexShrink: 0 
      }}>
        <div style={{ position: 'relative' }}>
          <Search size={16} color="#a8a29e" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
          <input 
            className="input" 
            placeholder={`搜索${merchant?.shop_name}的菜品...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: '36px', height: '40px' }}
          />
        </div>
      </header>

      {/* 客户端主布局 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左侧分类 */}
        {!search && (
          <div className="menu-categories">
            {categories.map(cat => (
              <div 
                key={cat.id} 
                className={`category-tab ${activeCategory === cat.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveCategory(cat.id)
                  itemsRef.current[cat.id]?.scrollIntoView({ behavior: 'smooth' })
                }}
              >
                {cat.name}
              </div>
            ))}
          </div>
        )}

        {/* 右侧菜品 */}
        <div className="menu-items">
          {categories.map(cat => {
            const itemsInCat = filteredItems.filter(i => i.category_id === cat.id)
            if (itemsInCat.length === 0) return null
            return (
              <div key={cat.id} ref={el => { itemsRef.current[cat.id] = el }}>
                <h3 style={{ fontSize: '14px', fontWeight: '700', padding: '12px 0 8px', color: '#78716c' }}>
                  {cat.name}
                </h3>
                {itemsInCat.map(item => (
                  <div key={item.id} style={{ 
                    display: 'flex', gap: '12px', padding: '12px', background: 'white',
                    borderRadius: '12px', marginBottom: '10px'
                  }}>
                    <div style={{ 
                      width: '80px', height: '80px', borderRadius: '8px',
                      background: item.image_url ? `url(${item.image_url}) center/cover` : '#f5f5f4',
                      flexShrink: 0 
                    }} />
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ fontWeight: '700', fontSize: '15px' }}>{item.name}</div>
                      <div style={{ 
                        fontSize: '12px', color: '#a8a29e', flex: 1,
                        overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
                        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', marginTop: '2px'
                      }}>
                        {item.description}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                        <span style={{ color: 'var(--color-primary)', fontWeight: '800', fontSize: '16px' }}>
                          {formatPrice(item.price)}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {cart.find(i => i.menuItem.id === item.id) && (
                            <>
                              <button 
                                onClick={() => removeFromCart(item.id)}
                                style={{ width: 22, height: 22, borderRadius: 6, border: '1px solid #d1d5db', background: 'white', padding: 0 }}
                              >
                                <Minus size={14} color="#666" style={{ margin: 'auto' }} />
                              </button>
                              <span style={{ fontSize: '14px', fontWeight: '600', width: '20px', textAlign: 'center' }}>
                                {cart.find(i => i.menuItem.id === item.id)?.quantity}
                              </span>
                            </>
                          )}
                          <button 
                            onClick={() => addToCart(item)}
                            style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--color-primary)', color: 'white', border: 'none', padding: 0 }}
                          >
                            <Plus size={14} style={{ margin: 'auto' }} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {/* 购物车底栏 */}
      {totalCount > 0 && (
        <div className="cart-bar animate-slide-up">
          <div 
            className="cart-badge" data-count={totalCount}
            onClick={() => setShowCart(true)}
            style={{ 
              width: 44, height: 44, borderRadius: '50%', background: 'var(--color-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginTop: -20, border: '4px solid #292524', cursor: 'pointer'
            }}
          >
            <ShoppingBag size={22} color="white" />
          </div>
          <div style={{ marginLeft: '12px', flex: 1, cursor: 'pointer' }} onClick={() => setShowCart(true)}>
            <div style={{ fontSize: '18px', fontWeight: '700' }}>{formatPrice(totalAmount)}</div>
            <div style={{ fontSize: '11px', color: '#a8a29e' }}>另需配送费或自提</div>
          </div>
          <button 
            className="btn btn-primary" 
            style={{ borderRadius: '25px', padding: '10px 24px', fontSize: '16px' }}
            onClick={() => setShowOrderForm(true)}
          >
            去下单
          </button>
        </div>
      )}

      {/* 购物车弹窗 */}
      {showCart && (
        <>
          <div className="overlay" style={{ zIndex: 100 }} onClick={() => setShowCart(false)} />
          <div className="dialog" style={{ 
            zIndex: 110, position: 'fixed', bottom: 0, top: 'auto', 
            left: 0, right: 0, transform: 'none', width: '100%', 
            maxWidth: 'none', borderRadius: '20px 20px 0 0', padding: '20px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ fontWeight: '800' }}>已购菜品</h3>
              <button onClick={() => setShowCart(false)} style={{ background: 'none', border: 'none' }}>
                <X size={20} color="#999" />
              </button>
            </div>
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {cart.map(item => (
                <div key={item.menuItem.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '16px', borderBottom: '1px solid #f5f5f4', marginBottom: '16px' }}>
                  <div style={{ width: '50px', height: '50px', borderRadius: '8px', background: item.menuItem.image_url ? `url(${item.menuItem.image_url}) center/cover` : '#f5f5f4' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '600', fontSize: '14px' }}>{item.menuItem.name}</div>
                    <div style={{ color: 'var(--color-primary)', fontWeight: '700', fontSize: '13px', marginTop: '2px' }}>{formatPrice(item.menuItem.price)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button onClick={() => removeFromCart(item.menuItem.id)} className="btn btn-outline" style={{ width: 24, height: 24, padding: 0 }}>-</button>
                    <span style={{ width: 20, textAlign: 'center', fontWeight: '600' }}>{item.quantity}</span>
                    <button onClick={() => addToCart(item.menuItem)} className="btn btn-outline" style={{ width: 24, height: 24, padding: 0 }}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'right', marginTop: '10px' }}>
              <button onClick={() => setCart([])} style={{ fontSize: '12px', color: '#999', background: 'none', border: 'none' }}>清空购物车</button>
            </div>
          </div>
        </>
      )}

      {/* 下单表单弹窗 */}
      {showOrderForm && (
        <>
          <div className="overlay" style={{ zIndex: 120 }} onClick={() => setShowOrderForm(false)} />
          <div className="dialog" style={{ 
            zIndex: 130, position: 'fixed', inset: 0, width: '100%', 
            maxWidth: 'none', transform: 'none', borderRadius: 0, 
            height: '100vh', padding: '0', display: 'flex', flexDirection: 'column'
          }}>
            <header style={{ padding: '14px 16px', borderBottom: '1px solid #f5f5f4', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button onClick={() => setShowOrderForm(false)} style={{ background: 'none', border: 'none' }}><X size={24} /></button>
              <h3 style={{ fontWeight: '800', fontSize: '18px' }}>确认订单</h3>
            </header>
            
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', background: '#f8f9fa' }}>
              {/* 类型选择 */}
              <div style={{ 
                display: 'flex', background: 'white', padding: '4px', 
                borderRadius: '12px', marginBottom: '20px', border: '1px solid #eee'
              }}>
                <button 
                  onClick={() => setOrderType('personal')}
                  style={{ 
                    flex: 1, padding: '10px', borderRadius: '8px', border: 'none', 
                    background: orderType === 'personal' ? 'var(--color-primary)' : 'none',
                    color: orderType === 'personal' ? 'white' : '#666',
                    fontWeight: '700', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                  }}
                >
                  <UserRound size={16} /> 个人
                </button>
                <button 
                  onClick={() => setOrderType('company')}
                  style={{ 
                    flex: 1, padding: '10px', borderRadius: '8px', border: 'none', 
                    background: orderType === 'company' ? 'var(--color-primary)' : 'none',
                    color: orderType === 'company' ? 'white' : '#666',
                    fontWeight: '700', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                  }}
                >
                  <Briefcase size={16} /> 公司
                </button>
              </div>

              {/* 信息表单 */}
              <div className="card" style={{ marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '700', marginBottom: '8px', color: '#444' }}>
                    <User size={14} /> 您的称呼
                  </label>
                  <input className="input" placeholder="怎么称呼您？" value={customerName} onChange={e => setCustomerName(e.target.value)} />
                </div>
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '700', marginBottom: '8px', color: '#444' }}>
                    <Phone size={14} /> 联系手机
                  </label>
                  <input className="input" type="tel" placeholder="重要：配送员将联系此号码" value={phone} onChange={e => setPhone(e.target.value)} />
                </div>
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '700', marginBottom: '8px', color: '#444' }}>
                    <Clock size={14} /> 预定时间
                  </label>
                  <input className="input" type="datetime-local" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} />
                </div>
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '700', marginBottom: '8px', color: '#444' }}>
                    <MapPin size={14} /> 详细地址
                  </label>
                  <textarea className="input" placeholder="请输入您的详细配送地址..." rows={2} value={address} onChange={e => setAddress(e.target.value)} />
                </div>
              </div>

              {/* 订单预览 */}
              <div className="card">
                <h4 style={{ fontSize: '14px', fontWeight: '800', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #f5f5f4' }}>菜品详情</h4>
                {cart.map(item => (
                  <div key={item.menuItem.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '8px' }}>
                    <span style={{ color: '#444' }}>{item.menuItem.name} x{item.quantity}</span>
                    <span style={{ fontWeight: '600' }}>{formatPrice(item.menuItem.price * item.quantity)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '800', fontSize: '18px', marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed #ddd' }}>
                  <span>应付合计</span>
                  <span style={{ color: 'var(--color-primary)' }}>{formatPrice(totalAmount)}</span>
                </div>
              </div>

              <div style={{ 
                marginTop: '16px', padding: '12px', background: '#fef2f2', 
                borderRadius: '8px', color: '#dc2626', fontSize: '12px' 
              }}>
                <strong>取消规则：</strong> 下单后 30 分钟内可免费取消。超出 30 分钟后按小时收取 2% 违约金（封顶 10%）
              </div>
            </div>

            <div style={{ padding: '16px', background: 'white', borderTop: '1px solid #f5f5f4' }}>
              <button 
                className="btn btn-primary btn-block" 
                style={{ height: '50px', fontSize: '18px', borderRadius: '25px' }}
                onClick={handleSubmitOrder}
                disabled={submitting}
              >
                {submitting ? <span className="spinner" /> : <>确认并模拟支付 <ArrowRight size={18} /></>}
              </button>
            </div>
          </div>
        </>
      )}

      {/* 新品轮播弹窗组件 */}
      <NewItemsCarousel items={newItems} onAdd={addToCart} />

      {/* 悬浮订单进度条 */}
      {activeOrder && (
        <div
          onClick={() => router.push(`/m/${merchantId}/order/${activeOrder.id}`)}
          style={{
            position: 'fixed', right: '16px', bottom: '88px', zIndex: 50,
            background: 'white', borderRadius: '20px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            padding: '10px 16px',
            display: 'flex', alignItems: 'center', gap: '10px',
            cursor: 'pointer',
            border: '1.5px solid var(--color-primary)',
            maxWidth: '220px',
            animation: 'fadeIn 0.3s ease',
          }}
        >
          <div style={{
            width: '32px', height: '32px', borderRadius: '50%',
            background: '#fff7ed',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {activeOrder.status === 'pending' && <Clock size={16} color="#f97316" />}
            {activeOrder.status === 'preparing' && <Package size={16} color="#3b82f6" />}
            {activeOrder.status === 'delivering' && <ArrowRight size={16} color="#22c55e" />}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>我的订单</div>
            <div style={{ fontSize: '13px', fontWeight: '700', color:
              activeOrder.status === 'pending' ? '#f97316' :
              activeOrder.status === 'preparing' ? '#3b82f6' : '#22c55e'
            }}>
              {activeOrder.status === 'pending' && '等待商家接单...'}
              {activeOrder.status === 'preparing' && '制作中✨'}
              {activeOrder.status === 'delivering' && '配送中 😋'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
