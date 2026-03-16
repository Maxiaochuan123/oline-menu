'use client'

import { useState, useEffect, useRef, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Merchant, Category, MenuItem, CartItem, Order, UserCoupon, Coupon } from '@/lib/types'
import { formatPrice, isWechat, isValidPhone } from '@/lib/utils'
import { calcDiscount, getVipLevel, VIP_LEVELS, getPointsToNextLevel, getCouponEligibleAmount } from '@/lib/membership'
import {
  Plus, Minus, ShoppingBag, Search, X,
  MapPin, Phone, User, Clock, Briefcase, UserRound, ArrowRight, Package, Gift, Star, ChevronRight
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
  
  const [cart, setCart] = useState<CartItem[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const saved = localStorage.getItem(`cart_${merchantId}`)
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
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

  // 会员 & 优惠券
  const [customerPoints, setCustomerPoints] = useState(0)
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [availableCoupons, setAvailableCoupons] = useState<UserCoupon[]>([])
  const [allMyCoupons, setAllMyCoupons] = useState<UserCoupon[]>([])
  const [selectedCoupons, setSelectedCoupons] = useState<UserCoupon[]>([])
  const [centerCoupons, setCenterCoupons] = useState<Coupon[]>([])
  const [showVipInfo, setShowVipInfo] = useState(false)
  const [showCouponPicker, setShowCouponPicker] = useState(false)
  const [showLoginBanner, setShowLoginBanner] = useState(false)
  const [showCouponCenter, setShowCouponCenter] = useState(false)
  const [couponCenterTab, setCouponCenterTab] = useState<'claim' | 'unused' | 'used' | 'invalid'>('claim')
  const [claimLoading, setClaimLoading] = useState<string | null>(null)
  // 是否由用户手动切换过优惠券（手动选过后不再自动覆盖）
  const [couponManuallySet, setCouponManuallySet] = useState(false)

  const itemsRef = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    setIsWechatEnv(isWechat())
    loadData()



    // 尝试带出用户信息
    const lastUser = localStorage.getItem(`customer_info_${merchantId}`)
    if (lastUser) {
      try {
        const info = JSON.parse(lastUser)
        setCustomerName(info.name)
        setPhone(info.phone)
        setAddress(info.address)
        loadActiveOrder(info.phone)
        loadCustomerBenefits(info.phone)
      } catch { /* ignore */ }
    } else {
      // 新用户：延迟展示登录悬浮按钮
      setTimeout(() => setShowLoginBanner(true), 1500)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId])

  useEffect(() => {
    localStorage.setItem(`cart_${merchantId}`, JSON.stringify(cart))
  }, [cart, merchantId])

  // 手机号填写完整后（11位）自动加载积分和优惠券
  useEffect(() => {
    if (phone.length === 11) {
      loadCustomerBenefits(phone)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone])

  // 处理登录后重定向自动发券
  useEffect(() => {
    if (customerId) {
      const pendingCouponId = localStorage.getItem('pending_claim_coupon')
      if (pendingCouponId) {
        localStorage.removeItem('pending_claim_coupon')
        // 自动触发领取
        ;(async () => {
          try {
            const { data: cpn } = await supabase.from('coupons').select('*').eq('id', pendingCouponId).single()
            if (cpn) {
              await handleClaimCoupon(cpn, true)
            }
          } catch (e) {
            console.error('自动领券失败', e)
          }
        })()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, merchantId])


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
    const [mRes, cRes, iRes, centerRes] = await Promise.all([
      supabase.from('merchants').select('*').eq('id', merchantId).single(),
      supabase.from('categories').select('*').eq('merchant_id', merchantId).order('sort_order'),
      supabase.from('menu_items').select('*').eq('merchant_id', merchantId).eq('is_available', true),
      // 注意：全局券在新结构中没有 target_type，或者被置为 null 甚至 'all'。这取决于商家前端建券时的保存。
      supabase.from('coupons').select('*').eq('merchant_id', merchantId).eq('status', 'active').order('created_at', { ascending: false })
    ])

    if (mRes.data) setMerchant(mRes.data)
    if (cRes.data) {
      setCategories(cRes.data)
      if (cRes.data.length > 0) setActiveCategory(cRes.data[0].id)
    }
    if (iRes.data) setMenuItems(iRes.data)
    if (centerRes.data) setCenterCoupons(centerRes.data)
    setLoading(false)
  }

  /** 根据手机号加载客户积分和可用优惠券 */
  async function loadCustomerBenefits(ph: string) {
    try {
      const { data: cust } = await supabase
        .from('customers')
        .select('id, points')
        .eq('merchant_id', merchantId)
        .eq('phone', ph)
        .maybeSingle()

      if (!cust) {
        setCustomerId(null)
        setCustomerPoints(0)
        setAvailableCoupons([])
        setAllMyCoupons([])
        return
      }
      setCustomerId(cust.id)
      setCustomerPoints(cust.points ?? 0)

      // 查询用户所有的参与优惠券记录（含已使用、失效等）
      const { data: ucData } = await supabase
        .from('user_coupons')
        .select('*, coupon:coupons(*)')
        .eq('customer_id', cust.id)
        
      if (ucData) {
        setAllMyCoupons(ucData)
        // 从所有记录里过滤出未使用且未过期的有效券
        const valid = ucData.filter(uc => uc.status === 'unused' && new Date(uc.expires_at) > new Date() && uc.coupon?.status === 'active')
        setAvailableCoupons(valid)
      }
    } catch (e) {
      console.error('load benefits error', e)
    }
  }

  // 领券中心 - 领取逻辑
  async function handleClaimCoupon(coupon: Coupon, isAutoClaim = false) {
    if (!customerId) {
      localStorage.setItem('pending_claim_coupon', coupon.id)
      router.push(`/login?redirect=/m/${merchantId}`)
      return
    }
    setClaimLoading(coupon.id)
    try {
      const { data: success, error } = await supabase.rpc('claim_coupon', {
        p_coupon_id: coupon.id,
        p_customer_id: customerId,
        p_expires_at: new Date(Date.now() + coupon.expiry_days * 24 * 60 * 60 * 1000).toISOString()
      })
      if (error) throw error
      if (success) {
        alert(isAutoClaim ? `欢迎回来！为您自动领取了【${coupon.title}】` : '抢券成功！')
        if (phone) loadCustomerBenefits(phone)
        loadData() // 刷新余量
      } else {
        alert(isAutoClaim ? `【${coupon.title}】您已经领过或已被抢光啦` : '抢券失败：您可能已经领过，或者已经被抢完啦！')
      }
    } catch (err: unknown) {
      alert('抢券异常: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setClaimLoading(null)
    }
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

  // 自动选择最优优惠券（最优非叠加券 + 所有可叠加券）
  useEffect(() => {
    if (availableCoupons.length === 0) return
    // 用户手动选过则不自动覆盖
    if (couponManuallySet) return
    const eligible = availableCoupons.filter(uc => uc.coupon && getCouponEligibleAmount(uc.coupon, cart) >= uc.coupon.min_spend)
    const nonStackable = eligible.filter(uc => !uc.coupon?.stackable).sort((a, b) => (b.coupon?.amount ?? 0) - (a.coupon?.amount ?? 0))
    const stackable = eligible.filter(uc => uc.coupon?.stackable)
    const best: UserCoupon[] = []
    if (nonStackable[0]) best.push(nonStackable[0])
    best.push(...stackable)
    setSelectedCoupons(best)
  }, [availableCoupons, cart, couponManuallySet])

  // 计算凑单提示 (优化版：区分全场与定向)
  const couponHint = (() => {
    if (totalCount === 0 || availableCoupons.length === 0) return null
    // 找出尚未满足条件的券中，达成后真正能带来更多优惠的
    const currentNonStackable = selectedCoupons.find(uc => !uc.coupon?.stackable)
    const currentNonStackableAmount = currentNonStackable?.coupon?.amount ?? 0

    const unreached = availableCoupons.filter(uc => {
      const coupon = uc.coupon
      if (!coupon) return false
      // 1. 金额未达标
      if (getCouponEligibleAmount(coupon, cart) >= coupon.min_spend) return false
      // 2. 必须是：能叠加的券 OR 比当前非叠加券更优的券
      const isStackable = coupon.stackable
      const isBetterThanCurrent = coupon.amount > currentNonStackableAmount
      return isStackable || isBetterThanCurrent
    })
    if (unreached.length > 0) {
      unreached.sort((a, b) => {
        const diffA = (a.coupon?.min_spend ?? 0) - getCouponEligibleAmount(a.coupon!, cart)
        const diffB = (b.coupon?.min_spend ?? 0) - getCouponEligibleAmount(b.coupon!, cart)
        return diffA - diffB
      })
      const target = unreached[0]
      const coupon = target.coupon!
      const eligibleAmount = getCouponEligibleAmount(coupon, cart)
      const diff = coupon.min_spend - eligibleAmount
      const isTargeted = coupon.target_type && coupon.target_type !== 'all'
      
      // 如果是一分钱都没达标(没点该分类)的定向券
      if (eligibleAmount === 0 && isTargeted) {
         return { type: '差额', text: `再买 ¥${diff.toFixed(0)}【${coupon.title}】指定商品可用` }
      }
      
      // 如果总额已经够了，但是指定商品不够（定向券）
      if (totalAmount >= coupon.min_spend && isTargeted) {
         return { type: '差额', text: `【${coupon.title}】需指定商品满 ¥${coupon.min_spend}，还差 ¥${diff.toFixed(1)}` }
      }

      return { type: '差额', text: `还差 ¥${diff.toFixed(2)} 即可使用【${coupon.title}】` }
    }
    // 全都满足了
    if (selectedCoupons.length > 0) {
      const titles = selectedCoupons.map(c => c.coupon?.title).join(' 及 ')
      return { type: '达标', text: `已为您自动使用【${titles}】` }
    }
    return null
  })()

  // 折扣计算 (优化：按门槛和定向属性排序，优先应用底券/全场券？不，通常建议定向优先)
  // 此处定义最优计算顺序：将可叠加券（通常是定向/特定商品）放在前面，全场底券放在最后
  const sortedSelectedCoupons = [...selectedCoupons].sort((a, b) => {
    // 可叠加的（定向）优先于非叠加的（底）
    if (a.coupon?.stackable && !b.coupon?.stackable) return -1
    if (!a.coupon?.stackable && b.coupon?.stackable) return 1
    // 门槛高的优先 (或者面额大的优先，这里可以根据业务定，通常门槛高的优先能腾出门槛低的空间)
    return (b.coupon?.min_spend ?? 0) - (a.coupon?.min_spend ?? 0)
  })

  const discountResult = calcDiscount({
    originalAmount: totalAmount,
    points: customerPoints,
    couponAmounts: sortedSelectedCoupons.map(uc => ({
      amount: uc.coupon?.amount ?? 0,
      minSpend: uc.coupon?.min_spend ?? 0,
    })),
  })
  const finalAmount = discountResult.finalAmount
  const vipLevel = discountResult.vipLevel
  const vipDiscountAmount = discountResult.vipDiscountAmount

  // 动态计算底部区域高度（购物车栏56px + 折扣明细区）
  const discountRowCount = totalCount > 0 ? [
    vipLevel.rate < 1,
    !!(selectedCoupons.length > 0 && discountResult.couponDiscountAmount > 0),
    availableCoupons.length > 0 && selectedCoupons.length === 0,
    customerPoints + Math.floor(totalAmount) < 100,
  ].filter(Boolean).length : 0
  const bottomBarHeight = totalCount > 0 ? 56 + (discountRowCount > 0 ? discountRowCount * 22 + 16 : 0) : 0

  async function handleSubmitOrder() {
    if (!customerName || !phone || !address || !scheduledTime) {
      alert('请填写完整的配送信息')
      return
    }
    if (!isValidPhone(phone)) {
      alert('请输入有效的手机号（1开头，11位数字）')
      return
    }
    setSubmitting(true)

    try {
      // 1. 同步/创建客户信息
      let cid = customerId
      const { data: customerData } = await supabase
        .from('customers')
        .select('id, points')
        .eq('merchant_id', merchantId)
        .eq('phone', phone)
        .maybeSingle()

      if (customerData) {
        cid = customerData.id
        // 下单时同步常用信息和积分（每 1元 = 1积分）
        await supabase.from('customers').update({
          name: customerName,
          address,
          points: (customerData.points ?? 0) + Math.floor(finalAmount),
          order_count: (customerData as { order_count?: number }).order_count ?? 0 + 1,
          total_spent: ((customerData as { total_spent?: number }).total_spent ?? 0) + finalAmount,
        }).eq('id', cid)
      } else {
        const { data: newCustomer } = await supabase
          .from('customers')
          .insert({
            merchant_id: merchantId,
            name: customerName,
            phone,
            address,
            order_count: 1,
            total_spent: finalAmount,
            points: Math.floor(finalAmount),
          })
          .select('id')
          .single()
        cid = newCustomer?.id ?? null
      }

      // 保存信息到本地，下次自动带出
      localStorage.setItem(`customer_info_${merchantId}`, JSON.stringify({ name: customerName, phone, address }))

      // 2. 创建订单（带入折扣字段）
      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .insert({
          merchant_id: merchantId,
          customer_id: cid,
          order_type: orderType,
          phone,
          customer_name: customerName,
          address,
          scheduled_time: new Date(scheduledTime).toISOString(),
          // 金额字段
          original_amount: totalAmount,
          total_amount: finalAmount,
          vip_discount_rate: discountResult.vipLevel.rate,
          vip_discount_amount: discountResult.vipDiscountAmount,
          coupon_discount_amount: discountResult.couponDiscountAmount,
          coupon_ids: sortedSelectedCoupons.map(c => c.coupon_id),
          status: 'pending',
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

      // 4. 标记优惠券已使用
      if (selectedCoupons.length > 0) {
        await supabase
          .from('user_coupons')
          .update({ status: 'used', used_at: new Date().toISOString() })
          .in('id', selectedCoupons.map(c => c.id))
      }

      setShowOrderForm(false)
      setCart([])
      setSelectedCoupons([])
      setCouponManuallySet(false) // 下单后重置，下次重新自动选最优
      localStorage.removeItem(`cart_${merchantId}`)
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

  // 过滤出真正可以手动领取的券（排除已领过、已抢光的）
  const claimableCoupons = centerCoupons.filter(c => {
    const isClaimed = allMyCoupons.some((uc: UserCoupon) => uc.coupon_id === c.id)
    const isSoldOut = c.total_quantity !== null && (c.claimed_count || 0) >= c.total_quantity
    return !isClaimed && !isSoldOut
  })

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* 搜索栏 */}
      <header style={{ 
        padding: '16px 16px 12px', background: 'white', 
        borderBottom: '1px solid var(--color-border)', flexShrink: 0 
      }}>
        {/* 商家品牌与信用分展示 (P12-E) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ fontSize: '18px', fontWeight: '800', color: '#1c1917', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {merchant?.shop_name}
            {merchant?.rating && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: '#fef3c7', padding: '2px 6px', borderRadius: '4px' }}>
                <Star fill="#f59e0b" color="#f59e0b" size={12} />
                <span style={{ fontSize: '12px', color: '#d97706', fontWeight: '700' }}>{merchant.rating.toFixed(1)}</span>
              </div>
            )}
          </div>
        </div>

        <div style={{ position: 'relative', marginBottom: (centerCoupons.length > 0 || allMyCoupons.length > 0) ? '12px' : 0 }}>
          <Search size={16} color="#a8a29e" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
          <input 
            className="input" 
            placeholder={`搜索${merchant?.shop_name}的菜品...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: '36px', height: '40px' }}
          />
        </div>

        {/* 首页快捷入口区 */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          {/* 领券中心 */}
          <div 
            onClick={() => setShowCouponCenter(true)}
            style={{ 
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
              background: '#fff7ed', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Gift size={20} color="#ea580c" />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '13px', color: '#c2410c', fontWeight: '600', display: 'flex', alignItems: 'center' }}>
                  领券中心
                  {claimableCoupons.length > 0 && <span style={{ marginLeft: '4px', background: '#ea580c', color: 'white', padding: '1px 4px', borderRadius: '8px', fontSize: '10px' }}>{claimableCoupons.length}待领</span>}
                </span>
                <span style={{ fontSize: '11px', color: '#ea580c', opacity: 0.8 }}>我的卡券 ({availableCoupons.length})</span>
              </div>
            </div>
            <ChevronRight size={14} color="#ea580c" />
          </div>

          {/* 历史订单 */}
          <div 
            onClick={() => router.push(`/m/${merchantId}/orders`)}
            style={{ 
              flexShrink: 0, width: '90px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', 
              background: '#f8fafc', border: '1px solid #f1f5f9', padding: '8px 4px', borderRadius: '8px', cursor: 'pointer', gap: '4px', color: '#475569'
            }}
          >
            <Briefcase size={18} />
            <span style={{ fontSize: '12px', fontWeight: '600' }}>历史订单</span>
          </div>
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
        <div className="menu-items" style={{ paddingBottom: `${bottomBarHeight + 16}px` }}>
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

      {/* 折扣明细栏（独立浮在购物车栏上方） */}
      {totalCount > 0 && (vipLevel.rate < 1 || selectedCoupons.length > 0 || (availableCoupons.length > 0 && selectedCoupons.length === 0) || (customerPoints + Math.floor(totalAmount) < 100) || couponHint) && (
        <div style={{
          position: 'fixed', bottom: '56px', left: 0, right: 0, zIndex: 19,
          background: '#1c1917', padding: '8px 16px',
          display: 'flex', flexDirection: 'column', gap: '4px',
          borderTop: '1px solid rgba(255,255,255,0.08)'
        }}>
          {/* VIP 折扣行 */}
          {vipLevel.rate < 1 && (
            <div
              onClick={() => setShowVipInfo(true)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', cursor: 'pointer' }}
            >
              <span style={{ color: '#4ade80' }}>⭐ {vipLevel.label} {vipLevel.discount}</span>
              <span style={{ color: '#4ade80', fontWeight: '600' }}>-¥{vipDiscountAmount.toFixed(2)}</span>
            </div>
          )}

          {/* 优惠券行 */}
          {selectedCoupons.length > 0 && discountResult.couponDiscountAmount > 0 && (
            <div
              onClick={() => setShowCouponPicker(true)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', cursor: 'pointer' }}
            >
              <span style={{ color: '#fbbf24' }}>🎫 {selectedCoupons.map(c => c.coupon?.title).join(' + ') || '优惠券'}</span>
              <span style={{ color: '#fbbf24', fontWeight: '600' }}>-¥{discountResult.couponDiscountAmount.toFixed(2)}</span>
            </div>
          )}

          {/* 可用券提示 */}
          {(() => {
            if (availableCoupons.length === 0) return null;
            if (selectedCoupons.length > 0) return null;
            const trulyAvailableCount = availableCoupons.filter(uc => uc.coupon && getCouponEligibleAmount(uc.coupon, cart) >= uc.coupon.min_spend).length;
            return (
              <div
                onClick={() => setShowCouponPicker(true)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', cursor: 'pointer' }}
              >
                <span style={{ color: trulyAvailableCount > 0 ? '#fb923c' : '#aaa' }}>🎫 {trulyAvailableCount > 0 ? `有 ${trulyAvailableCount} 张券可用` : '查看不可用券'}</span>
                <ChevronRight size={12} color={trulyAvailableCount > 0 ? '#fb923c' : '#aaa'} />
              </div>
            )
          })()}

          {/* 凑单提示 / 发券提示 (P5-A 修正) */}
          {couponHint && (
            <div
              style={{ fontSize: '11px', color: couponHint.type === '达标' ? '#4ade80' : '#fdba74', textAlign: 'center', paddingTop: '2px', fontWeight: '600' }}
            >
              {couponHint.type === '达标' ? '✅ ' : '🔥 '}{couponHint.text}
            </div>
          )}

          {/* VIP 凑单提示 */}
          {(() => {
            const currentTotalPts = customerPoints + Math.floor(totalAmount);
            const nextLevelInfo = getPointsToNextLevel(currentTotalPts);
            if (!nextLevelInfo) return null;
            return (
              <div
                onClick={() => setShowVipInfo(true)}
                style={{ fontSize: '11px', color: '#fdba74', cursor: 'pointer', textAlign: 'center', paddingTop: '2px' }}
              >
                🔥 再加 ¥{nextLevelInfo.needed.toFixed(0)} 可享 {nextLevelInfo.nextLevel.label} {nextLevelInfo.nextLevel.discount}
              </div>
            )
          })()}
        </div>
      )}

      {/* 全局动效挂载：右侧悬浮领券按钮 (P4) */}
      {claimableCoupons.length > 0 && (
        <div
          onClick={() => setShowCouponCenter(true)}
          className="pulsing-coupon-btn"
          style={{
            position: 'fixed', right: '16px', bottom: activeOrder ? '150px' : totalCount > 0 ? '70px' : '20px',
            zIndex: 40, width: '48px', height: '48px', borderRadius: '50%',
            background: 'linear-gradient(135deg, #ffedd5, #ffedd5)',
            boxShadow: '0 4px 12px rgba(234,88,12,0.3)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', border: '2px solid #ea580c',
            transition: 'bottom 0.3s ease'
          }}
        >
          <Gift size={20} color="#ea580c" style={{ marginBottom: '-2px' }} />
          <span style={{ fontSize: '10px', fontWeight: '800', color: '#ea580c' }}>抢券</span>
          {/* 未读气泡小红点 */}
          <div style={{ position: 'absolute', top: '-4px', right: '-4px', background: '#ef4444', color: 'white', fontSize: '10px', fontWeight: 'bold', width: '18px', height: '18px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid white' }}>
            {claimableCoupons.length}
          </div>
        </div>
      )}

      {/* 购物车底栏 */}
      {totalCount > 0 && (
        <div className="cart-bar animate-slide-up" style={{ display: 'flex', flexDirection: 'column', padding: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '12px 24px' }}>
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
            <div style={{ fontSize: '18px', fontWeight: '700' }}>
              {vipLevel.rate < 1 || selectedCoupons.length > 0 ? (
                <>
                  <span style={{ color: 'var(--color-primary)' }}>{formatPrice(finalAmount)}</span>
                  <span style={{ fontSize: '12px', color: '#aaa', textDecoration: 'line-through', marginLeft: '6px' }}>{formatPrice(totalAmount)}</span>
                </>
              ) : formatPrice(totalAmount)}
            </div>
            <div style={{ fontSize: '11px', color: '#a8a29e' }}>
              {(vipLevel.rate < 1 || selectedCoupons.length > 0)
                ? `已省 ¥${(totalAmount - finalAmount).toFixed(1)}`
                : '另需配送费或自提'}
            </div>
          </div>
          <button
            className="btn btn-primary"
            style={{ borderRadius: '25px', padding: '10px 24px', fontSize: '16px' }}
            onClick={() => {
              setShowOrderForm(true)
              if (phone.length === 11) loadCustomerBenefits(phone)
            }}
          >
            去下单
          </button>
          </div>
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

            {/* 折扣 & 优惠券明细 */}
            <div style={{ marginTop: '12px', padding: '12px', background: '#fafaf9', borderRadius: '10px', borderTop: '1px solid #f0f0f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                <span style={{ color: '#888' }}>商品合计</span>
                <span style={{ fontWeight: '600' }}>{formatPrice(totalAmount)}</span>
              </div>

              {vipLevel.rate < 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                  <span style={{ color: '#22c55e' }}>⭐ {vipLevel.label} {vipLevel.discount}</span>
                  <span style={{ color: '#22c55e', fontWeight: '600' }}>-{formatPrice(vipDiscountAmount)}</span>
                </div>
              )}

              {selectedCoupons.length > 0 && discountResult.couponDiscountAmount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                  <span style={{ color: '#f59e0b' }}>🎫 {selectedCoupons.map(c => c.coupon?.title).join(' + ')}</span>
                  <span style={{ color: '#f59e0b', fontWeight: '600' }}>-{formatPrice(discountResult.couponDiscountAmount)}</span>
                </div>
              )}

              {/* 可用券提示 */}
              {availableCoupons.length > 0 && selectedCoupons.length === 0 && (
                <div
                  onClick={() => { setShowCart(false); setShowCouponPicker(true) }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', marginBottom: '6px', cursor: 'pointer', color: '#ef4444' }}
                >
                  <span>🎫 有 {availableCoupons.length} 张优惠券可用</span>
                  <ChevronRight size={14} />
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '800', fontSize: '16px', marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #e5e5e5' }}>
                <span>合计</span>
                <span style={{ color: 'var(--color-primary)' }}>{formatPrice(finalAmount)}</span>
              </div>
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
                  <input className="input" type="tel" placeholder="重要：配送员将联系此号码" value={phone} onChange={e => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 11)
                    setPhone(v)
                    if (v.length === 11) loadCustomerBenefits(v)
                  }} maxLength={11} />
                  {phone.length > 0 && !isValidPhone(phone) && (
                    <p style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>请输入有效的手机号（1开头，11位数字）</p>
                  )}
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

              {/* VIP 等级权益入口 */}
              <div
                className="card"
                onClick={() => setShowVipInfo(true)}
                style={{ marginBottom: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '10px',
                    background: `linear-gradient(135deg, ${vipLevel.color}, ${vipLevel.color}88)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <Star size={18} color="white" />
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: vipLevel.color }}>
                      {vipLevel.label} · {vipLevel.description}
                      {vipLevel.rate < 1 && <span style={{ fontSize: '12px', marginLeft: '6px' }}>{vipLevel.discount}</span>}
                    </div>
                    <div style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>
                      {customerPoints + Math.floor(totalAmount)} 积分（含本单）
                      {vipLevel.maxPoints !== -1 && (customerPoints + Math.floor(totalAmount)) < vipLevel.maxPoints + 1
                        && ` · 再积 ${vipLevel.maxPoints + 1 - customerPoints - Math.floor(totalAmount)} 分升下一级`}
                    </div>
                  </div>
                </div>
                <ChevronRight size={16} color="#ccc" />
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

                {/* 折扣明细 */}
                {discountResult.vipDiscountAmount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#22c55e', marginTop: '8px' }}>
                    <span>🌟 {vipLevel.label} {vipLevel.discount} 优惠</span>
                    <span>-{formatPrice(discountResult.vipDiscountAmount)}</span>
                  </div>
                )}
                {discountResult.couponDiscountAmount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#f59e0b', marginTop: '4px' }}>
                    <span>🎫 优惠券扣减</span>
                    <span>-{formatPrice(discountResult.couponDiscountAmount)}</span>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '800', fontSize: '18px', marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed #ddd' }}>
                  <span>应付合计</span>
                  <span style={{ color: 'var(--color-primary)' }}>{formatPrice(finalAmount)}</span>
                </div>
              </div>

              {/* 优惠券选择入口 */}
              {availableCoupons.length > 0 && (
                <div
                  className="card"
                  style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                  onClick={() => setShowCouponPicker(true)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                    <Gift size={16} color="#f59e0b" />
                    <span style={{ fontWeight: '600' }}>优惠券</span>
                    {selectedCoupons.length > 0
                      ? <span style={{ color: '#f59e0b', fontWeight: '700' }}>-￥{selectedCoupons.reduce((s, c) => s + (c.coupon?.amount ?? 0), 0).toFixed(2)} ({selectedCoupons.length}张)</span>
                      : <span style={{ color: '#aaa', fontSize: '13px' }}>有 {availableCoupons.length} 张可用</span>}
                  </div>
                  <ChevronRight size={16} color="#bbb" />
                </div>
              )}

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

      {/* 未登录用户悬浮登录拉引刕 */}
      {showLoginBanner && (
        <div
          onClick={() => router.push(`/login?redirect=/m/${merchantId}`)}
          style={{
            position: 'fixed', bottom: totalCount > 0 ? '80px' : '20px', left: '50%',
            transform: 'translateX(-50%)', zIndex: 60,
            background: 'linear-gradient(135deg, #f97316, #ef4444)',
            borderRadius: '40px', padding: '12px 20px',
            display: 'flex', alignItems: 'center', gap: '10px',
            boxShadow: '0 8px 24px rgba(249,115,22,0.4)',
            cursor: 'pointer', whiteSpace: 'nowrap',
            animation: 'slideUp 0.4s ease',
          }}
        >
          <Gift size={18} color="white" />
          <span style={{ color: 'white', fontWeight: '700', fontSize: '14px' }}>登录即领 5 元立减券</span>
          <button
            onClick={(e) => { e.stopPropagation(); setShowLoginBanner(false) }}
            style={{ background: 'rgba(255,255,255,0.3)', border: 'none', borderRadius: '50%', width: 20, height: 20, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <X size={12} color="white" />
          </button>
        </div>
      )}

      {/* VIP 等级详情幕 */}
      {showVipInfo && (
        <>
          <div className="overlay" style={{ zIndex: 200 }} onClick={() => setShowVipInfo(false)} />
          <div className="dialog" style={{ zIndex: 210, maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontWeight: '800', fontSize: '18px' }}>会员等级优惠</h3>
              <button onClick={() => setShowVipInfo(false)} style={{ background: 'none', border: 'none' }}><X size={20} /></button>
            </div>
            <div style={{ fontSize: '13px', color: '#666', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              当前积分：<span style={{ fontWeight: '700', color: '#1c1917' }}>⭐ {customerPoints} </span>
              {totalAmount > 0 && <span style={{ color: '#f97316', fontSize: '12px' }}>(+{Math.floor(finalAmount)} 预得)</span>}
            </div>
            {VIP_LEVELS.slice(1).map(lv => {
              const potentialPoints = customerPoints + Math.floor(totalAmount)
              const targetLevel = getVipLevel(potentialPoints)
              const isTargetLevel = targetLevel.level === lv.level
              const isPastLevel = targetLevel.level > lv.level
              return (
                <div key={lv.level} style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '12px', borderRadius: '12px', marginBottom: '8px',
                  background: isTargetLevel ? '#fff7ed' : '#f9fafb',
                  border: isTargetLevel ? '2px solid #f97316' : '1px solid #f0f0f0',
                  opacity: isPastLevel || isTargetLevel ? 1 : 0.6
                }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '50%',
                    background: lv.color, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', flexShrink: 0,
                  }}>
                    <Star size={18} color="white" fill="white" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '700', fontSize: '15px' }}>{lv.label} · {lv.description}</div>
                    <div style={{ fontSize: '12px', color: '#aaa', marginTop: '2px' }}>
                      {lv.maxPoints === -1 ? `积分 ${lv.minPoints}+` : `积分 ${lv.minPoints}~${lv.maxPoints}`}
                    </div>
                  </div>
                  <div style={{ fontWeight: '800', fontSize: '18px', color: lv.color }}>{lv.discount}</div>
                  {isTargetLevel && (
                    <div style={{ fontSize: '11px', color: '#f97316', fontWeight: '700' }}>{potentialPoints >= lv.minPoints ? '本单达成' : '升级中'}</div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* 领券中心及我的券弹窗 (P5-C) */}
      {showCouponCenter && (
        <>
          <div className="overlay" style={{ zIndex: 200 }} onClick={() => setShowCouponCenter(false)} />
          <div className="dialog" style={{ zIndex: 210, position: 'fixed', bottom: 0, top: 'auto', left: 0, right: 0, transform: 'none', width: '100%', maxWidth: 'none', borderRadius: '20px 20px 0 0', padding: '20px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexShrink: 0 }}>
              <h3 style={{ fontWeight: '800' }}>领券中心</h3>
              <button onClick={() => setShowCouponCenter(false)} style={{ background: 'none', border: 'none' }}><X size={20} /></button>
            </div>
            
            {/* 顶部 4 Tab */}
            <div style={{ display: 'flex', gap: '20px', borderBottom: '1px solid #f5f5f4', marginBottom: '16px', flexShrink: 0 }}>
              {(['claim', 'unused', 'used', 'invalid'] as const).map(tab => (
                <div 
                  key={tab}
                  onClick={() => setCouponCenterTab(tab)}
                  style={{ 
                    padding: '8px 0', fontSize: '13px', fontWeight: couponCenterTab === tab ? '700' : '400',
                    color: couponCenterTab === tab ? '#ea580c' : '#78716c', cursor: 'pointer',
                    borderBottom: couponCenterTab === tab ? '2px solid #ea580c' : '2px solid transparent'
                  }}
                >
                  {tab === 'claim' ? '待领取' : tab === 'unused' ? '未使用' : tab === 'used' ? '已使用' : '已失效'}
                </div>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {couponCenterTab === 'claim' && (
                centerCoupons.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#999', fontSize: '13px', padding: '40px 0' }}>暂无可领取的优惠券</p>
                ) : (
                  centerCoupons.map(c => {
                    const isClaimed = allMyCoupons.some((uc: UserCoupon) => uc.coupon_id === c.id)
                    const isSoldOut = c.total_quantity !== null && c.claimed_count >= c.total_quantity
                    return (
                      <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff7ed', borderRadius: '12px', padding: '16px', marginBottom: '12px', border: '1px solid #ffedd5' }}>
                        <div>
                          <div style={{ fontWeight: '700', fontSize: '16px', color: '#ea580c', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {c.title}
                            {c.stackable && <span style={{ fontSize: '10px', background: '#ede9fe', color: '#7c3aed', padding: '2px 4px', borderRadius: '4px' }}>可叠加</span>}
                          </div>
                          <div style={{ fontSize: '13px', color: '#f97316', marginTop: '4px' }}>
                            {c.min_spend > 0 ? `满 ¥${c.min_spend} 减 ¥${c.amount}` : `无门槛减 ¥${c.amount}`}
                          </div>
                          <div style={{ fontSize: '11px', color: '#f97316', opacity: 0.8, marginTop: '4px' }}>
                            有效期 {c.expiry_days} 天
                            {c.total_quantity !== null && ` · 总量 ${c.total_quantity} 张 · 剩余 ${c.total_quantity - (c.claimed_count || 0)} 张`}
                          </div>
                        </div>
                        <button
                          onClick={() => handleClaimCoupon(c)}
                          disabled={isClaimed || isSoldOut || claimLoading === c.id}
                          style={{
                            padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: '700', border: 'none',
                            background: isClaimed ? '#fdba74' : isSoldOut ? '#e5e5e5' : '#ea580c',
                            color: isClaimed || isSoldOut ? 'white' : 'white',
                            cursor: isClaimed || isSoldOut ? 'not-allowed' : 'pointer',
                            transform: claimLoading === c.id ? 'scale(0.95)' : 'none',
                            transition: 'transform 0.15s ease'
                          }}
                        >
                          {claimLoading === c.id ? '...' : isClaimed ? '已领取' : isSoldOut ? '已抢光' : '抢券'}
                        </button>
                      </div>
                    )
                  })
                )
              )}

              {couponCenterTab === 'unused' && (
                availableCoupons.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#999', fontSize: '13px', padding: '40px 0' }}>暂无可用优惠券</p>
                ) : (
                  availableCoupons.map(uc => {
                    const c = uc.coupon!
                    return (
                      <div key={uc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff7ed', borderRadius: '12px', padding: '16px', marginBottom: '12px', border: '1px solid #ffedd5' }}>
                        <div>
                          <div style={{ fontWeight: '700', fontSize: '16px', color: '#ea580c', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {c.title}
                            {c.stackable && <span style={{ fontSize: '10px', background: '#ede9fe', color: '#7c3aed', padding: '2px 4px', borderRadius: '4px' }}>可叠加</span>}
                          </div>
                          <div style={{ fontSize: '13px', color: '#f97316', marginTop: '4px' }}>
                            {c.min_spend > 0 ? `满 ¥${c.min_spend} 减 ¥${c.amount}` : `无门槛减 ¥${c.amount}`}
                          </div>
                          <div style={{ fontSize: '11px', color: '#f97316', opacity: 0.8, marginTop: '4px' }}>
                            {new Date(uc.expires_at).toLocaleDateString()} 到期
                          </div>
                        </div>
                        <button
                          onClick={() => setShowCouponCenter(false)}
                          style={{
                            padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: '700', border: '1px solid #ea580c',
                            background: 'white', color: '#ea580c', cursor: 'pointer'
                          }}
                        >
                          去使用
                        </button>
                      </div>
                    )
                  })
                )
              )}

              {couponCenterTab === 'used' && (() => {
                const usedCoupons = allMyCoupons.filter((uc: UserCoupon) => uc.status === 'used')
                if (usedCoupons.length === 0) return <p style={{ textAlign: 'center', color: '#999', fontSize: '13px', padding: '40px 0' }}>暂无已使用记录</p>
                return usedCoupons.map((uc: UserCoupon) => {
                  const c = uc.coupon!
                  return (
                    <div key={uc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f5f5f4', borderRadius: '12px', padding: '16px', marginBottom: '12px', border: '1px solid #e7e5e4', opacity: 0.8 }}>
                      <div>
                        <div style={{ fontWeight: '700', fontSize: '16px', color: '#57534e', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {c.title}
                        </div>
                        <div style={{ fontSize: '13px', color: '#78716c', marginTop: '4px' }}>
                          面值 ¥{c.amount}
                        </div>
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: '#999' }}>已使用</div>
                    </div>
                  )
                })
              })()}

              {couponCenterTab === 'invalid' && (() => {
                const invalidCoupons = allMyCoupons.filter((uc: UserCoupon) => uc.status !== 'used' && (new Date(uc.expires_at) <= new Date() || uc.coupon?.status !== 'active'))
                if (invalidCoupons.length === 0) return <p style={{ textAlign: 'center', color: '#999', fontSize: '13px', padding: '40px 0' }}>暂无失效记录</p>
                return invalidCoupons.map((uc: UserCoupon) => {
                  const c = uc.coupon!
                  return (
                    <div key={uc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f5f5f4', borderRadius: '12px', padding: '16px', marginBottom: '12px', border: '1px solid #e7e5e4', opacity: 0.8 }}>
                      <div>
                        <div style={{ fontWeight: '700', fontSize: '16px', color: '#57534e', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {c.title}
                        </div>
                        <div style={{ fontSize: '13px', color: '#78716c', marginTop: '4px' }}>
                          已过期 / 商家已停用
                        </div>
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: '#999' }}>已失效</div>
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        </>
      )}

      {/* 优惠券选择弹窗 */}
      {showCouponPicker && (
        <>
          <div className="overlay" style={{ zIndex: 200 }} onClick={() => setShowCouponPicker(false)} />
          <div className="dialog" style={{ 
            zIndex: 210, position: 'fixed', bottom: 0, top: 'auto', 
            left: 0, right: 0, transform: 'none', width: '100%', 
            maxWidth: 'none', borderRadius: '20px 20px 0 0', padding: '20px',
            maxHeight: '85vh', display: 'flex', flexDirection: 'column' 
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexShrink: 0 }}>
              <h3 style={{ fontWeight: '800' }}>选择优惠券</h3>
              <button onClick={() => setShowCouponPicker(false)} style={{ background: 'none', border: 'none' }}><X size={20} /></button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', marginBottom: selectedCoupons.length > 0 ? '16px' : 0 }}>
              <div
                onClick={() => { setSelectedCoupons([]); setCouponManuallySet(true); setShowCouponPicker(false) }}
                style={{
                  padding: '14px', borderRadius: '12px', marginBottom: '10px', cursor: 'pointer',
                  border: selectedCoupons.length === 0 ? '2px solid #f97316' : '1px solid #eee',
                  background: selectedCoupons.length === 0 ? '#fff7ed' : 'white',
                }}
              >
                <div style={{ fontWeight: '600' }}>不使用优惠券</div>
              </div>
              {(() => {
                const currentNonStackable = selectedCoupons.find(uc => !uc.coupon?.stackable)
                const currentNonStackableAmount = currentNonStackable?.coupon?.amount ?? 0
                
                return availableCoupons.map(uc => {
                  const minSpend = uc.coupon?.min_spend ?? 0
                  const eligibleAmount = uc.coupon ? getCouponEligibleAmount(uc.coupon, cart) : totalAmount
                  const disabled = eligibleAmount < minSpend
                  const gap = minSpend - eligibleAmount
                  const isSelected = selectedCoupons.some(c => c.id === uc.id)
                  const isStackable = uc.coupon?.stackable ?? false
                  const isBetterOrStackable = isStackable || (uc.coupon?.amount ?? 0) > currentNonStackableAmount
                  
                  const renderDisableReason = () => {
                    const coupon = uc.coupon
                    if (!coupon) return ''
                    const isTargeted = coupon.target_type && coupon.target_type !== 'all'
                    
                    // 计算该券如果达成，是否真的能省更多钱
                    if (eligibleAmount === 0 && isTargeted) {
                      return '未添加指定商品'
                    }
                    if (disabled) {
                      // 如果收益不增加，就不要用“还差￥XX”来诱导凑单了，只显示门槛即可
                      if (!isBetterOrStackable && currentNonStackableAmount > 0) {
                        return `满 ¥${minSpend} 可用 (不可叠加)`
                      }

                      if (totalAmount >= minSpend && isTargeted) {
                        return `指定商品还差 ¥${gap.toFixed(0)}（满 ¥${minSpend} 可用）`
                      }
                      return `还差 ¥${gap.toFixed(0)}，满 ¥${minSpend} 可用`
                    }
                    return `满 ¥${minSpend} 可用`
                  }

                  return (
                  <div key={uc.id}
                    onClick={() => {
                      if (disabled) {
                        const isTargeted = uc.coupon?.target_type && uc.coupon.target_type !== 'all'
                        
                        // 如果即便凑够了也没法多省钱
                        if (!isBetterOrStackable && currentNonStackableAmount > 0) {
                          alert(`【${uc.coupon?.title}】不可与当前已选优惠券叠加使用，即便凑满门槛，优惠总额也不会增加哦。`)
                          return
                        }

                        if (eligibleAmount === 0 && isTargeted) {
                          alert(`您还未添加【${uc.coupon?.title}】指定的商品，无法使用此券`)
                        } else if (totalAmount >= minSpend && isTargeted) {
                          alert(`【${uc.coupon?.title}】仅限指定商品参加，目前指定商品还差 ¥${gap.toFixed(0)}（需满 ¥${minSpend}）`)
                        } else {
                          alert(`目前还差 ¥${gap.toFixed(0)} 即可使用此券（满 ¥${minSpend} 可用）`)
                        }
                        return
                      }
                      if (isSelected) {
                        setSelectedCoupons(selectedCoupons.filter(c => c.id !== uc.id))
                        setCouponManuallySet(true)
                      } else {
                        // 非叠加券替换已有非叠加券; 叠加券追加
                        if (uc.coupon?.stackable) {
                          setSelectedCoupons([...selectedCoupons, uc])
                        } else {
                          setSelectedCoupons([uc, ...selectedCoupons.filter(c => c.coupon?.stackable)])
                        }
                        setCouponManuallySet(true)
                      }
                    }}
                    style={{
                      padding: '14px', borderRadius: '12px', marginBottom: '10px',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      border: isSelected ? '2px solid #f97316' : '1px solid #eee',
                      background: disabled ? '#f5f5f4' : isSelected ? '#fff7ed' : 'white',
                      opacity: disabled ? 0.6 : 1,
                      filter: disabled ? 'grayscale(80%)' : 'none'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: '700', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {uc.coupon?.title}
                          {uc.coupon?.stackable && <span style={{ fontSize: '10px', background: '#ede9fe', color: '#7c3aed', padding: '1px 5px', borderRadius: '4px' }}>可叠加</span>}
                        </div>
                        <div style={{ fontSize: '12px', color: disabled ? '#ef4444' : '#aaa', marginTop: '4px', fontWeight: disabled ? '600' : 'normal' }}>
                          {minSpend > 0 ? renderDisableReason() : '无门槛'} · {new Date(uc.expires_at).toLocaleDateString()} 到期
                        </div>
                      </div>
                      <div style={{ fontSize: '22px', fontWeight: '800', color: disabled ? '#ccc' : '#f97316' }}>-￥{uc.coupon?.amount?.toFixed(0)}</div>
                    </div>
                  </div>
                  )
                })
              })()}
            </div>
            {selectedCoupons.length > 0 && (
              <div style={{ flexShrink: 0 }}>
                <button
                  onClick={() => setShowCouponPicker(false)}
                  className="btn btn-primary btn-block"
                >确定（已选 {selectedCoupons.length} 张，省 ¥{selectedCoupons.reduce((s, c) => s + (c.coupon?.amount ?? 0), 0).toFixed(0)}）</button>
              </div>
            )}
          </div>
        </>
      )}

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
