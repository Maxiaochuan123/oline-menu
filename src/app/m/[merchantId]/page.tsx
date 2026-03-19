'use client'

import { useState, useEffect, useRef, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Merchant, Category, MenuItem, CartItem, Order, UserCoupon, Coupon, DisabledDate } from '@/lib/types'
import { formatPrice, isWechat, isValidPhone, cn } from '@/lib/utils'
import { calcDiscount, getVipLevel, VIP_LEVELS, getPointsToNextLevel, getCouponEligibleAmount } from '@/lib/membership'
import {
  Plus, Minus, ShoppingBag, Search, X, CheckCircle,
  MapPin, Phone, User, Clock, Briefcase, UserRound, ArrowRight, Package, Gift, Star, ChevronRight
} from 'lucide-react'
import { format } from 'date-fns'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/common/Toast'
import WechatGuide from '@/components/customer/WechatGuide'
import NewItemsCarousel from '@/components/customer/NewItemsCarousel'
import MenuSkeleton from '@/components/customer/MenuSkeleton'
import DraggableCouponButton from '@/components/customer/DraggableCouponButton'

export default function ClientMenuPage({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = use(params)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [disabledDates, setDisabledDates] = useState<DisabledDate[]>([])
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
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false)

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
  const [formError, setFormError] = useState(false)

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
    const [mRes, cRes, iRes, centerRes, dRes] = await Promise.all([
      supabase.from('merchants').select('*').eq('id', merchantId).single(),
      supabase.from('categories').select('*').eq('merchant_id', merchantId).order('sort_order'),
      supabase.from('menu_items').select('*').eq('merchant_id', merchantId).eq('is_available', true),
      // 注意：全局券在新结构中没有 target_type，或者被置为 null 甚至 'all'。这取决于商家前端建券时的保存。
      supabase.from('coupons').select('*').eq('merchant_id', merchantId).eq('status', 'active').order('created_at', { ascending: false }),
      supabase.from('disabled_dates').select('*').eq('merchant_id', merchantId)
    ])

    if (mRes.data) setMerchant(mRes.data)
    if (cRes.data) {
      setCategories(cRes.data)
      if (cRes.data.length > 0) setActiveCategory(cRes.data[0].id)
    }
    if (iRes.data) setMenuItems(iRes.data)
    if (centerRes.data) setCenterCoupons(centerRes.data)
    if (dRes.data) setDisabledDates(dRes.data)
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
        toast(isAutoClaim ? `欢迎回来！为您自动领取了【${coupon.title}】` : '抢券成功！', 'success')
        if (phone) loadCustomerBenefits(phone)
        loadData() // 刷新余量
      } else {
        toast(isAutoClaim ? `【${coupon.title}】您已经领过或已被抢光啦` : '抢券失败：您可能已经领过，或者已经被抢完啦！', 'warning')
      }
    } catch (err: unknown) {
      toast('抢券异常: ' + (err instanceof Error ? err.message : String(err)), 'error')
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
    !!couponHint,
    (customerPoints + Math.floor(totalAmount) < 100) || !!getPointsToNextLevel(customerPoints + Math.floor(totalAmount)),
  ].filter(Boolean).length : 0
  
  // 基础 56px + (每行32px + 底部留白20px)
  const bottomBarHeight = totalCount > 0 ? 72 + (discountRowCount > 0 ? discountRowCount * 32 + 24 : 0) : 0

  async function handleSubmitOrder() {
    if (!customerName || !phone || !address || !scheduledTime) {
      setFormError(true)
      toast('请完善红色高亮的配送信息', 'warning')
      return
    }
    if (!isValidPhone(phone)) {
      toast('手机号格式不正确', 'error')
      return
    }
    setSubmitting(true)

    try {
      // 1. 同步/创建客户信息
      let cid = customerId
      const { data: customerData } = await supabase
        .from('customers')
        .select('id, points, order_count, total_spent')
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
      setCouponManuallySet(false)
      localStorage.removeItem(`cart_${merchantId}`)
      localStorage.setItem(`last_order_${merchantId}`, order.id)
      
      // 显示成功仪式感动画
      setShowSuccessAnimation(true)
      toast('下单成功，正在飞速为您备菜...', 'success')
      setTimeout(() => {
        router.push(`/m/${merchantId}/order/${order.id}`)
      }, 1500)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '下单失败'
      toast(`下单失败: ${msg}`, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // 校验营业状态
  const checkIsStoreOpen = () => {
    if (!merchant) return { isOpen: true } // 初始加载中不拦截
    
    // 1. 手动强制关店优先级最高
    if (merchant.is_accepting_orders === false) return { isOpen: false, reason: 'merchant' }
    
    // 2. 停业日期检查
    const todayStr = format(new Date(), 'yyyy-MM-dd')
    const disabledDate = disabledDates.find(d => d.disabled_date === todayStr)
    if (disabledDate) return { isOpen: false, reason: 'disabled_date', msg: disabledDate.reason }
    
    // 3. 自动定时开启检查
    if (merchant.business_hours?.is_enabled) {
      const now = new Date()
      const nowStr = format(now, 'HH:mm')
      const { open_time, close_time } = merchant.business_hours
      if (open_time && close_time && (nowStr < open_time || nowStr > close_time)) {
        return { isOpen: false, reason: 'hours', open_time, close_time }
      }
    }
    
    return { isOpen: true }
  }

  if (loading) return <MenuSkeleton />

  if (isWechatEnv) return <WechatGuide />

  const openStatus = checkIsStoreOpen()

  if (!openStatus.isOpen) {
    return (
      <div className="overlay" style={{ background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="dialog" style={{ position: 'relative', top: 'auto', left: 'auto', transform: 'none', width: '85%', maxWidth: '320px', borderRadius: '24px' }}>
          <div style={{ textAlign: 'center', padding: '10px' }}>
            <div style={{ padding: '20px', background: '#fff7ed', borderRadius: '100px', width: 'fit-content', margin: '0 auto 20px' }}>
              <Clock size={40} color="#f97316" />
            </div>
            
            <h2 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '8px', color: '#1c1917' }}>
              {openStatus.reason === 'hours' ? '尚未开始营业' : '暂停接单中'}
            </h2>
            
            <p style={{ fontSize: '14px', color: '#78716c', marginBottom: '20px', lineHeight: '1.6' }}>
              {openStatus.reason === 'hours' && `本店营业时间：${openStatus.open_time} - ${openStatus.close_time}`}
              {openStatus.reason === 'disabled_date' && (openStatus.msg || '今日店休')}
              {openStatus.reason === 'merchant' && (merchant?.announcement || '商家目前忙碌中，请稍后再来点餐~')}
            </p>

            <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #f1f5f9' }}>
              <p style={{ color: '#999', fontSize: '12px' }}>您可以收藏本页，等开店后再次访问</p>
            </div>
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
    <div className="h-[100dvh] flex flex-col bg-slate-50 font-sans overflow-hidden">
      {/* 搜索栏与头部 */}
      <header className="bg-white/80 backdrop-blur-md px-4 pt-4 pb-3 border-b border-slate-100 shrink-0 z-20">
        {/* 商家品牌与信用分展示 */}
        <div className="flex items-center justify-between mb-4">
          <div className="text-[17px] font-black text-slate-900 flex items-center gap-2">
            {merchant?.shop_name}
            {merchant?.rating && (
              <div className="flex items-center gap-0.5 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-100 shadow-sm">
                <Star fill="#f59e0b" className="text-amber-500" size={12} />
                <span className="text-[11px] text-amber-600 font-bold">{merchant.rating.toFixed(1)}</span>
              </div>
            )}
          </div>
        </div>

        <div className={cn("relative", (centerCoupons.length > 0 || allMyCoupons.length > 0) ? "mb-3" : "mb-0")}>
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            className="w-full bg-slate-100/50 border-transparent focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 rounded-2xl pl-9 pr-4 py-2.5 text-sm transition-all" 
            placeholder={`搜索${merchant?.shop_name}的菜品...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* 首页快捷入口区 */}
        <div className="flex gap-2 mt-3">
          {/* 领券中心 */}
          <div 
            onClick={() => setShowCouponCenter(true)}
            className="flex-1 flex items-center justify-between bg-gradient-to-r from-orange-50 to-orange-100/50 p-2.5 rounded-2xl cursor-pointer active:scale-95 transition-all shadow-sm border border-orange-100/50"
          >
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-white rounded-xl shadow-sm">
                <Gift size={18} className="text-orange-500" />
              </div>
              <div className="flex flex-col items-start">
                <span className="text-sm text-orange-700 font-black flex items-center tracking-tight">
                  领券中心
                  {claimableCoupons.length > 0 && (
                    <span className="ml-1.5 bg-orange-500 text-white px-1.5 py-0.5 rounded-full text-[9px] shadow-sm animate-pulse">
                      {claimableCoupons.length}待领
                    </span>
                  )}
                </span>
                <span className="text-[10px] text-orange-600/80 font-bold mt-0.5">我的卡券 ({availableCoupons.length})</span>
              </div>
            </div>
            <ChevronRight size={16} className="text-orange-400 mr-1" />
          </div>

          {/* 历史订单 */}
          <div 
            onClick={() => router.push(`/m/${merchantId}/orders`)}
            className="shrink-0 w-[72px] flex flex-col items-center justify-center bg-white border border-slate-100 rounded-2xl cursor-pointer active:scale-95 transition-all shadow-sm gap-1"
          >
            <Briefcase size={16} className="text-slate-500" />
            <span className="text-[10px] font-black text-slate-600 tracking-tighter">历史订单</span>
          </div>
        </div>
      </header>

      {/* 客户端主布局 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧分类 */}
        {!search && (
          <div className="w-[84px] bg-slate-100/50 overflow-y-auto custom-scrollbar shrink-0 pb-32">
            {categories.map(cat => (
              <div 
                key={cat.id} 
                className={cn(
                  "px-3 py-4 text-[13px] font-bold transition-all cursor-pointer relative",
                  activeCategory === cat.id 
                    ? "bg-white text-slate-900" 
                    : "text-slate-500 hover:bg-slate-100"
                )}
                onClick={() => {
                  setActiveCategory(cat.id)
                  itemsRef.current[cat.id]?.scrollIntoView({ behavior: 'smooth' })
                }}
              >
                {activeCategory === cat.id && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-orange-500 rounded-r-full" />
                )}
                {cat.name}
              </div>
            ))}
          </div>
        )}

        {/* 右侧菜品 */}
        <div className="flex-1 overflow-y-auto px-3 pb-32 scroll-smooth bg-white" style={{ paddingBottom: `${bottomBarHeight + 16}px` }}>
          {categories.map(cat => {
            const itemsInCat = filteredItems.filter(i => i.category_id === cat.id)
            if (itemsInCat.length === 0) return null
            return (
              <div key={cat.id} ref={el => { itemsRef.current[cat.id] = el }} className="pt-2">
                <h3 className="text-sm font-black text-slate-800 py-3 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
                  {cat.name}
                </h3>
                <div className="space-y-4">
                  {itemsInCat.map(item => (
                    <div key={item.id} className="flex gap-3 relative group">
                      <div className="w-[88px] h-[88px] rounded-2xl bg-slate-100 shrink-0 overflow-hidden relative">
                        {item.image_url ? (
                          <div className="w-full h-full bg-center bg-cover transition-transform duration-500 group-active:scale-105" style={{ backgroundImage: `url(${item.image_url})` }} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-300">
                            <span className="text-[10px] uppercase font-bold tracking-widest">No img</span>
                          </div>
                        )}
                        {item.is_new && (!item.new_until || new Date(item.new_until) > new Date()) && (
                          <div className="absolute top-0 left-0 bg-rose-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-br-lg rounded-tl-2xl">新品</div>
                        )}
                      </div>
                      
                      <div className="flex-1 flex flex-col min-w-0 py-0.5">
                        <div className="font-black text-[15px] text-slate-900 leading-tight mb-1">{item.name}</div>
                        <div className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed flex-1">
                          {item.description || '暂无描述'}
                        </div>
                        
                        <div className="flex justify-between items-center mt-2">
                          <span className="text-orange-500 font-black text-base flex items-baseline">
                            <span className="text-[11px] mr-0.5">¥</span>
                            {item.price}
                          </span>
                          
                          <div className="flex items-center gap-3">
                            {cart.find(i => i.menuItem.id === item.id) && (
                              <>
                                <button 
                                  onClick={() => removeFromCart(item.id)}
                                  className="size-6 rounded-full border border-slate-200 bg-white flex items-center justify-center text-slate-600 active:scale-90 transition-transform shadow-sm"
                                >
                                  <Minus size={14} />
                                </button>
                                <span className="text-[13px] font-black w-4 text-center">
                                  {cart.find(i => i.menuItem.id === item.id)?.quantity}
                                </span>
                              </>
                            )}
                            <button 
                              onClick={() => addToCart(item)}
                              className="size-6 rounded-full bg-orange-500 flex items-center justify-center text-white active:scale-90 transition-transform shadow-md shadow-orange-200"
                            >
                              <Plus size={14} strokeWidth={3} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 折扣明细栏（独立浮在购物车栏上方） */}
      {totalCount > 0 && (vipLevel.rate < 1 || selectedCoupons.length > 0 || (availableCoupons.length > 0 && selectedCoupons.length === 0) || (customerPoints + Math.floor(totalAmount) < 100) || couponHint) && (
        <div className="fixed bottom-[calc(72px+env(safe-area-inset-bottom,0px))] left-0 right-0 z-20 bg-[#1c1917] pt-3 px-4 pb-5 flex flex-col gap-1 border-t border-white/5 shadow-[0_-4px_12px_rgba(0,0,0,0.2)]">
          {/* VIP 折扣行 */}
          {vipLevel.rate < 1 && (
            <div
              onClick={() => setShowVipInfo(true)}
              className="flex justify-between items-center text-xs cursor-pointer hover:opacity-80 transition-opacity"
            >
              <span className="text-emerald-400 font-medium">⭐ {vipLevel.label} {vipLevel.discount}</span>
              <span className="text-emerald-400 font-bold">-¥{vipDiscountAmount.toFixed(2)}</span>
            </div>
          )}

          {/* 优惠券行 */}
          {selectedCoupons.length > 0 && discountResult.couponDiscountAmount > 0 && (
            <div
              onClick={() => setShowCouponPicker(true)}
              className="flex justify-between items-center text-xs cursor-pointer hover:opacity-80 transition-opacity"
            >
              <span className="text-amber-400 font-medium">🎫 {selectedCoupons.map(c => c.coupon?.title).join(' + ') || '优惠券'}</span>
              <span className="text-amber-400 font-bold">-¥{discountResult.couponDiscountAmount.toFixed(2)}</span>
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
                className="flex justify-between items-center text-xs cursor-pointer text-amber-500/80"
              >
                <span className={cn(trulyAvailableCount > 0 ? 'text-orange-400' : 'text-stone-500')}>
                  🎫 {trulyAvailableCount > 0 ? `有 ${trulyAvailableCount} 张券可用` : '查看不可用券'}
                </span>
                <ChevronRight size={12} />
              </div>
            )
          })()}

          {/* 凑单提示 / 发券提示 */}
          {couponHint && (
            <div className={cn(
              "text-[11px] text-center pt-0.5 font-bold",
              couponHint.type === '达标' ? "text-emerald-400" : "text-orange-300"
            )}>
              {couponHint.type === '达标' ? '✅ ' : '🔥 '}{couponHint.text}
            </div>
          )}

          {/* VIP 凑单提示 (优化版：更显眼的渐变背景与进度引导) */}
          {(() => {
            const currentTotalPts = customerPoints + Math.floor(totalAmount);
            const nextLevelInfo = getPointsToNextLevel(currentTotalPts);
            if (!nextLevelInfo) return null;

            return (
              <div
                onClick={() => setShowVipInfo(true)}
                className="mt-1 py-2 px-3 bg-gradient-to-r from-amber-500/10 to-orange-500/10 rounded-lg border border-orange-500/20 flex items-center justify-center gap-1.5 cursor-pointer animate-pulse"
              >
                <span className="text-xs">🔥</span>
                <span className="text-[11px] text-orange-400 font-bold">
                  再加 ¥{nextLevelInfo.needed.toFixed(0)} 可享 {nextLevelInfo.nextLevel.label} {nextLevelInfo.nextLevel.discount}
                </span>
                <ChevronRight size={10} className="text-orange-400" />
              </div>
            )
          })()}
        </div>
      )}

      {/* 全局动效挂载：悬浮领券按钮 (已封装支持拖拽和吸附) */}
      {claimableCoupons.length > 0 && (
        <DraggableCouponButton 
          count={claimableCoupons.length} 
          onClick={() => setShowCouponCenter(true)} 
          bottomOffset={activeOrder ? 130 : totalCount > 0 ? 50 : 0}
        />
      )}

      {/* 购物车底栏 */}
      {totalCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white shadow-[0_-8px_30px_rgba(0,0,0,0.08)] animate-in slide-in-from-bottom duration-300 z-50">
          <div className="flex items-center w-full px-4 py-3 pb-safe max-w-2xl mx-auto">
            <div
              className="relative w-12 h-12 rounded-full bg-slate-900 flex items-center justify-center -mt-8 border-[5px] border-slate-50 cursor-pointer shadow-lg z-10 transition-transform active:scale-95"
              onClick={() => setShowCart(true)}
            >
              <ShoppingBag size={22} className="text-white" />
              <div className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full border-2 border-slate-900">
                {totalCount}
              </div>
            </div>
            
            <div className="ml-3 flex-1 cursor-pointer flex flex-col justify-center" onClick={() => setShowCart(true)}>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-black text-slate-900">
                  {vipLevel.rate < 1 || selectedCoupons.length > 0 ? (
                    <>
                      <span className="text-orange-500 mr-1">{formatPrice(finalAmount)}</span>
                      <span className="text-[11px] text-slate-400 line-through">{formatPrice(totalAmount)}</span>
                    </>
                  ) : formatPrice(totalAmount)}
                </span>
              </div>
              <div className="text-[10px] text-slate-500 font-bold tracking-tight">
                {(vipLevel.rate < 1 || selectedCoupons.length > 0)
                  ? `已为您节省 ¥${(totalAmount - finalAmount).toFixed(1)}`
                  : '另需配送费或自提'}
              </div>
            </div>
            
            <button
              className="bg-orange-500 text-white rounded-full px-6 py-2.5 text-sm font-black active:scale-95 transition-all shadow-md shadow-orange-200"
              onClick={() => {
                setShowOrderForm(true)
                if (phone.length === 11) loadCustomerBenefits(phone)
              }}
            >
              去结算
            </button>
          </div>
        </div>
      )}

      {/* 购物车弹窗 */}
      {showCart && (
        <>
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 transition-opacity animate-in fade-in" onClick={() => setShowCart(false)} />
          <div className="fixed bottom-0 left-0 right-0 max-w-2xl mx-auto bg-slate-50 rounded-t-[2rem] z-50 animate-in slide-in-from-bottom pb-safe shadow-2xl flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 flex justify-between items-center bg-white rounded-t-[2rem] border-b border-slate-100 shrink-0">
              <h3 className="font-black text-slate-900 text-lg">已选菜品</h3>
              <button onClick={() => setShowCart(false)} className="p-2 -mr-2 bg-slate-100 rounded-full text-slate-500 active:scale-90 transition-transform">
                <X size={18} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto px-5 py-2 bg-white custom-scrollbar">
              <div className="flex justify-end pt-2 pb-3">
                <button onClick={() => setCart([])} className="text-xs font-bold text-slate-400 flex items-center gap-1 active:text-rose-500 transition-colors">
                  清空购物车
                </button>
              </div>
              <div className="space-y-4">
                {cart.map(item => (
                  <div key={item.menuItem.id} className="flex items-center gap-3">
                    <div className="w-14 h-14 rounded-2xl bg-slate-100 shrink-0 relative overflow-hidden">
                       {item.menuItem.image_url ? (
                         <div className="w-full h-full bg-center bg-cover" style={{ backgroundImage: `url(${item.menuItem.image_url})` }} />
                       ) : (
                         <div className="w-full h-full flex items-center justify-center text-slate-300">
                            <span className="text-[8px] uppercase font-bold tracking-widest">No img</span>
                         </div>
                       )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-[15px] text-slate-900 truncate">{item.menuItem.name}</div>
                      <div className="text-orange-500 font-black text-[14px] mt-0.5">
                        <span className="text-[10px] mr-0.5">¥</span>{item.menuItem.price}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => removeFromCart(item.menuItem.id)} className="size-7 rounded-full border border-slate-200 bg-white flex items-center justify-center text-slate-600 active:scale-90 transition-transform shadow-sm">
                        <Minus size={14} />
                      </button>
                      <span className="text-[14px] font-black w-4 text-center">{item.quantity}</span>
                      <button onClick={() => addToCart(item.menuItem)} className="size-7 rounded-full bg-orange-500 flex items-center justify-center text-white active:scale-90 transition-transform shadow-md shadow-orange-200">
                        <Plus size={14} strokeWidth={3} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 折扣 & 优惠券明细 */}
            <div className="bg-slate-50 p-5 shrink-0 mb-[72px]">
              <div className="bg-white rounded-3xl p-4 shadow-sm border border-slate-100/50 space-y-2.5">
                <div className="flex justify-between items-center text-[13px]">
                  <span className="text-slate-500 font-medium">商品合计</span>
                  <span className="font-black text-slate-700">¥{totalAmount.toFixed(2)}</span>
                </div>

                {vipLevel.rate < 1 && (
                  <div className="flex justify-between items-center text-[13px]">
                    <span className="text-emerald-500 font-bold flex items-center gap-1">
                      <Star size={12} fill="currentColor" /> 
                      {vipLevel.label} {vipLevel.discount}
                    </span>
                    <span className="text-emerald-500 font-black">-¥{vipDiscountAmount.toFixed(2)}</span>
                  </div>
                )}

                {selectedCoupons.length > 0 && discountResult.couponDiscountAmount > 0 && (
                  <div className="flex justify-between items-center text-[13px]">
                    <span className="text-amber-500 font-bold flex items-center gap-1">
                      <Gift size={12} />
                      {selectedCoupons.map(c => c.coupon?.title).join(' + ')}
                    </span>
                    <span className="text-amber-500 font-black">-¥{discountResult.couponDiscountAmount.toFixed(2)}</span>
                  </div>
                )}

                {/* 可用券提示 */}
                {availableCoupons.length > 0 && selectedCoupons.length === 0 && (
                  <div
                    onClick={() => { setShowCart(false); setShowCouponPicker(true) }}
                    className="flex justify-between items-center text-[13px] text-rose-500 font-bold cursor-pointer bg-rose-50 p-2 rounded-xl active:scale-[0.98] transition-transform"
                  >
                    <span className="flex items-center gap-1"><Gift size={12} /> 有 {availableCoupons.length} 张优惠券可用</span>
                    <ChevronRight size={14} />
                  </div>
                )}

                <div className="flex justify-between items-end pt-3 mt-1 border-t border-dashed border-slate-200">
                  <span className="font-black text-slate-800 text-sm">应付合计</span>
                  <span className="text-orange-500 font-black text-xl leading-none">
                    <span className="text-sm mr-0.5">¥</span>{finalAmount.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 下单表单弹窗 */}
      {showOrderForm && (
        <>
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 transition-opacity animate-in fade-in" onClick={() => setShowOrderForm(false)} />
          <div className="fixed inset-0 z-50 bg-slate-50 flex flex-col animate-in slide-in-from-bottom duration-300">
            <header className="bg-white/80 backdrop-blur-md px-5 py-3 flex items-center justify-between border-b border-slate-100 shrink-0 sticky top-0 z-10">
              <h3 className="font-black text-slate-900 text-lg">确认订单</h3>
              <button onClick={() => setShowOrderForm(false)} className="p-2 -mr-2 bg-slate-100 rounded-full text-slate-500 active:scale-90 transition-transform">
                <X size={20} />
              </button>
            </header>
            
            <div className="flex-1 overflow-y-auto px-4 py-5 custom-scrollbar pb-32">
              {/* 类型选择 */}
              <div className="flex bg-white p-1 rounded-2xl mb-5 shadow-sm border border-slate-100">
                <button 
                  onClick={() => setOrderType('personal')}
                  className={cn(
                    "flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition-all",
                    orderType === 'personal' ? "bg-slate-900 text-white shadow-md" : "text-slate-500 hover:bg-slate-50 active:bg-slate-100"
                  )}
                >
                  <UserRound size={16} /> 个人
                </button>
                <button 
                  onClick={() => setOrderType('company')}
                  className={cn(
                    "flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition-all",
                    orderType === 'company' ? "bg-slate-900 text-white shadow-md" : "text-slate-500 hover:bg-slate-50 active:bg-slate-100"
                  )}
                >
                  <Briefcase size={16} /> 公司
                </button>
              </div>

              {/* 信息表单 */}
              <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100 mb-5 space-y-4">
                <div>
                  <label className="flex items-center gap-1.5 text-[13px] font-black text-slate-700 mb-2">
                    <User size={14} className="text-orange-500" /> 您的称呼
                  </label>
                  <input 
                    className={cn(
                      "w-full bg-slate-50 border-transparent focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 rounded-2xl px-4 py-3 text-sm transition-all",
                      formError && !customerName && "border-rose-500 bg-rose-50 placeholder:text-rose-300 animate-shake"
                    )}
                    placeholder="怎么称呼您？" 
                    value={customerName} 
                    onChange={e => setCustomerName(e.target.value)} 
                  />
                </div>
                <div>
                  <label className="flex items-center gap-1.5 text-[13px] font-black text-slate-700 mb-2">
                    <Phone size={14} className="text-orange-500" /> 联系手机
                  </label>
                  <input 
                    className={cn(
                      "w-full bg-slate-50 border-transparent focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 rounded-2xl px-4 py-3 text-sm transition-all",
                      (formError && !phone) || (phone.length > 0 && !isValidPhone(phone)) ? "border-rose-500 bg-rose-50 animate-shake" : ""
                    )}
                    type="tel" 
                    placeholder="重要：配送员将联系此号码" 
                    value={phone} 
                    onChange={e => {
                      const v = e.target.value.replace(/\D/g, '').slice(0, 11)
                      setPhone(v)
                      if (v.length === 11) loadCustomerBenefits(v)
                    }} 
                    maxLength={11} 
                  />
                  {phone.length > 0 && !isValidPhone(phone) && (
                    <p className="text-[11px] font-bold text-rose-500 mt-1.5 ml-1">请输入有效的手机号（1开头，11位数字）</p>
                  )}
                </div>
                <div>
                  <label className="flex items-center gap-1.5 text-[13px] font-black text-slate-700 mb-2">
                    <Clock size={14} className="text-orange-500" /> 预定时间
                  </label>
                  <input 
                    className={cn(
                      "w-full bg-slate-50 border-transparent focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 rounded-2xl px-4 py-3 text-sm transition-all",
                      formError && !scheduledTime && "border-rose-500 bg-rose-50 animate-shake"
                    )}
                    type="datetime-local" 
                    value={scheduledTime} 
                    onChange={e => setScheduledTime(e.target.value)} 
                  />
                </div>
                <div>
                  <label className="flex items-center gap-1.5 text-[13px] font-black text-slate-700 mb-2">
                    <MapPin size={14} className="text-orange-500" /> 详细地址
                  </label>
                  <textarea 
                    className={cn(
                      "w-full bg-slate-50 border-transparent focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 rounded-2xl px-4 py-3 text-sm transition-all resize-none",
                      formError && !address && "border-rose-500 bg-rose-50 placeholder:text-rose-300 animate-shake"
                    )}
                    placeholder="请输入您的详细配送地址..." 
                    rows={2} 
                    value={address} 
                    onChange={e => setAddress(e.target.value)} 
                  />
                </div>
              </div>

              {/* VIP 等级权益入口 */}
              <div
                onClick={() => setShowVipInfo(true)}
                className="bg-white rounded-3xl p-4 shadow-sm border border-slate-100 mb-5 cursor-pointer flex items-center justify-between active:scale-[0.98] transition-transform"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-inner" style={{ background: `linear-gradient(135deg, ${vipLevel.color}, ${vipLevel.color}dd)` }}>
                    <Star size={20} className="text-white" />
                  </div>
                  <div>
                    <div className="text-sm font-black flex items-center gap-1.5" style={{ color: vipLevel.color }}>
                      {vipLevel.label} · {vipLevel.description}
                      {vipLevel.rate < 1 && <span className="bg-white/80 px-1.5 py-0.5 rounded text-[10px] shadow-sm">{vipLevel.discount}</span>}
                    </div>
                    <div className="text-[11px] text-slate-400 font-bold mt-0.5">
                      {customerPoints + Math.floor(totalAmount)} 积分（含本单）
                      {vipLevel.maxPoints !== -1 && (customerPoints + Math.floor(totalAmount)) < vipLevel.maxPoints + 1
                        && ` · 再积 ${vipLevel.maxPoints + 1 - customerPoints - Math.floor(totalAmount)} 分升下一级`}
                    </div>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-300" />
              </div>

              {/* 订单预览 */}
              <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100 mb-4">
                <h4 className="text-sm font-black text-slate-900 border-b border-slate-100 pb-3 mb-4">菜品详情</h4>
                <div className="space-y-3 mb-4">
                  {cart.map(item => (
                    <div key={item.menuItem.id} className="flex justify-between items-center text-sm">
                      <span className="text-slate-700 font-bold">{item.menuItem.name} <span className="text-slate-400 font-medium ml-1">x{item.quantity}</span></span>
                      <span className="font-black text-slate-900">¥{formatPrice(item.menuItem.price * item.quantity).replace('¥', '')}</span>
                    </div>
                  ))}
                </div>

                {/* 折扣明细 */}
                <div className="space-y-2 mt-4 bg-slate-50 rounded-2xl p-3 border border-slate-100/50">
                  {discountResult.vipDiscountAmount > 0 && (
                    <div className="flex justify-between text-[13px]">
                      <span className="text-emerald-600 font-bold flex items-center gap-1"><Star size={12} fill="currentColor"/> {vipLevel.label} {vipLevel.discount}</span>
                      <span className="text-emerald-600 font-black">-¥{formatPrice(discountResult.vipDiscountAmount).replace('¥', '')}</span>
                    </div>
                  )}
                  {discountResult.couponDiscountAmount > 0 && (
                    <div className="flex justify-between text-[13px]">
                      <span className="text-amber-500 font-bold flex items-center gap-1"><Gift size={12} /> 优惠券扣减</span>
                      <span className="text-amber-500 font-black">-¥{formatPrice(discountResult.couponDiscountAmount).replace('¥', '')}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-end pt-3 mt-1 border-t border-dashed border-slate-200">
                    <span className="font-black text-slate-800 text-sm">应付合计</span>
                    <span className="text-orange-500 font-black text-xl leading-none">
                      <span className="text-sm mr-0.5">¥</span>{finalAmount.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* 结算页升级提醒（临单提醒） */}
                {(() => {
                  const currentTotalPts = customerPoints + Math.floor(totalAmount);
                  const nextLevelInfo = getPointsToNextLevel(currentTotalPts);
                  if (nextLevelInfo && nextLevelInfo.needed <= 50) { 
                    return (
                      <div 
                        onClick={() => setShowOrderForm(false)}
                        className="mt-4 p-3 bg-gradient-to-r from-orange-50 to-orange-100/50 border border-orange-200 border-dashed rounded-2xl text-center cursor-pointer active:scale-95 transition-transform"
                      >
                        <div className="text-[13px] text-orange-700 font-black flex items-center justify-center gap-1">
                          <Gift size={14} /> 仅差 ¥{nextLevelInfo.needed.toFixed(0)} 升级 {nextLevelInfo.nextLevel.label}！
                        </div>
                        <div className="text-[11px] text-orange-600/80 font-bold mt-1">返回凑单，本单立享 {nextLevelInfo.nextLevel.discount}</div>
                      </div>
                    )
                  }
                  return null
                })()}
              </div>

              {/* 优惠券选择入口 */}
              {availableCoupons.length > 0 && (
                <div
                  className="bg-white rounded-3xl p-4 shadow-sm border border-slate-100 mb-5 flex items-center justify-between cursor-pointer active:scale-[0.98] transition-transform"
                  onClick={() => setShowCouponPicker(true)}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 bg-amber-50 rounded-xl">
                      <Gift size={18} className="text-amber-500" />
                    </div>
                    <span className="font-black text-slate-800 text-sm">优惠券</span>
                    {selectedCoupons.length > 0 ? (
                      <span className="bg-rose-50 text-rose-600 font-black text-[11px] px-2 py-0.5 rounded-lg border border-rose-100 ml-1">
                        -¥{selectedCoupons.reduce((s, c) => s + (c.coupon?.amount ?? 0), 0).toFixed(2)} ({selectedCoupons.length}张)
                      </span>
                    ) : (
                      <span className="text-slate-400 font-bold text-xs ml-1">有 {availableCoupons.length} 张可用</span>
                    )}
                  </div>
                  <ChevronRight size={18} className="text-slate-300" />
                </div>
              )}

              <div className="bg-rose-50 p-4 rounded-2xl border border-rose-100/50">
                <div className="flex items-start gap-2 text-rose-500">
                  <Clock size={16} className="shrink-0 mt-0.5" />
                  <p className="text-[11px] font-bold leading-relaxed">
                    <span className="font-black mr-1 text-rose-600">取消规则:</span> 
                    商家接单后 3 分钟内可极速免责取消。超出 3 分钟后将根据制作时长收取 5%-80% 的食材损耗费。
                  </p>
                </div>
              </div>
            </div>

            <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 p-4 pb-safe z-20">
              <button 
                className="w-full bg-slate-900 text-white rounded-full h-[52px] text-[15px] font-black flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-70 disabled:scale-100 shadow-xl shadow-slate-200"
                onClick={handleSubmitOrder}
                disabled={submitting}
              >
                {submitting ? <span className="spinner border-white border-t-transparent" /> : <>确认并模拟支付 <ArrowRight size={18} /></>}
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
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 transition-opacity animate-in fade-in" onClick={() => setShowVipInfo(false)} />
          <div className="fixed bottom-0 left-0 right-0 max-w-2xl mx-auto bg-slate-50 rounded-t-[2rem] z-50 animate-in slide-in-from-bottom pb-safe shadow-2xl flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 flex justify-between items-center bg-white rounded-t-[2rem] border-b border-slate-100 shrink-0">
              <h3 className="font-black text-slate-900 text-lg">会员等级优惠</h3>
              <button onClick={() => setShowVipInfo(false)} className="p-2 -mr-2 bg-slate-100 rounded-full text-slate-500 active:scale-90 transition-transform">
                <X size={18} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto px-5 py-5 custom-scrollbar">
              <div className="text-[13px] text-slate-500 font-bold mb-4 flex items-center gap-1.5">
                当前积分：<span className="font-black text-slate-900 flex items-center gap-0.5"><Star size={12} fill="#f59e0b" className="text-amber-500" /> {customerPoints} </span>
                {totalAmount > 0 && <span className="text-orange-500 text-[11px]">(+{Math.floor(finalAmount)} 预得)</span>}
              </div>

              <div className="space-y-3">
                {VIP_LEVELS.slice(1).map(lv => {
                  const potentialPoints = customerPoints + Math.floor(totalAmount)
                  const targetLevel = getVipLevel(potentialPoints)
                  const isTargetLevel = targetLevel.level === lv.level
                  const isPastLevel = targetLevel.level > lv.level
                  
                  return (
                    <div key={lv.level} className={cn(
                      "flex items-center gap-3 p-4 rounded-3xl border transition-all",
                      isTargetLevel ? "bg-orange-50/50 border-orange-200 shadow-sm" : "bg-white border-slate-100",
                      !(isPastLevel || isTargetLevel) && "opacity-60"
                    )}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-inner" style={{ background: `linear-gradient(135deg, ${lv.color}, ${lv.color}dd)` }}>
                        <Star size={20} className="text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-black text-slate-900 text-[15px] truncate">{lv.label} · {lv.description}</div>
                        <div className="text-[11px] text-slate-400 font-bold mt-0.5">
                          {lv.maxPoints === -1 ? `积分 ${lv.minPoints}+` : `积分 ${lv.minPoints}~${lv.maxPoints}`}
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        <div className="font-black text-lg" style={{ color: lv.color }}>{lv.discount}</div>
                        {isTargetLevel && (
                          <div className="text-[10px] text-orange-500 font-black mt-0.5 bg-orange-100 px-1.5 py-0.5 rounded uppercase tracking-wider">
                            {potentialPoints >= lv.minPoints ? '本单达成' : '升级中'}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 领券中心及我的券弹窗 (P5-C) */}
      {showCouponCenter && (
        <>
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 transition-opacity animate-in fade-in" onClick={() => setShowCouponCenter(false)} />
          <div className="fixed bottom-0 left-0 right-0 max-w-2xl mx-auto bg-slate-50 rounded-t-[2rem] z-50 animate-in slide-in-from-bottom pb-safe shadow-2xl flex flex-col h-[85vh]">
            <div className="px-5 py-4 flex justify-between items-center bg-white rounded-t-[2rem] shrink-0">
              <h3 className="font-black text-slate-900 text-lg flex items-center gap-2"><Gift className="text-orange-500" size={20} />领券中心</h3>
              <button onClick={() => setShowCouponCenter(false)} className="p-2 -mr-2 bg-slate-100 rounded-full text-slate-500 active:scale-90 transition-transform">
                <X size={18} />
              </button>
            </div>
            
            {/* 顶部 4 Tab */}
            <div className="flex px-5 bg-white border-b border-slate-100 shrink-0 mb-3 sticky top-0 z-10">
              {(['claim', 'unused', 'used', 'invalid'] as const).map(tab => (
                <div 
                  key={tab}
                  onClick={() => setCouponCenterTab(tab)}
                  className={cn(
                    "flex-1 text-center py-3 text-[13px] font-bold cursor-pointer transition-all border-b-2",
                    couponCenterTab === tab ? "text-orange-500 border-orange-500" : "text-slate-400 border-transparent hover:text-slate-600"
                  )}
                >
                  {tab === 'claim' ? '待领取' : tab === 'unused' ? '未使用' : tab === 'used' ? '已使用' : '已失效'}
                </div>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-2 custom-scrollbar">
              {couponCenterTab === 'claim' && (
                centerCoupons.length === 0 ? (
                  <div className="py-20 flex flex-col items-center justify-center text-slate-400">
                    <Gift size={48} className="opacity-20 mb-3" />
                    <p className="text-[13px] font-bold">暂无可领取的优惠券</p>
                  </div>
                ) : (
                  centerCoupons.map(c => {
                    const isClaimed = allMyCoupons.some((uc: UserCoupon) => uc.coupon_id === c.id)
                    const isSoldOut = c.total_quantity !== null && c.claimed_count >= c.total_quantity
                    return (
                      <div key={c.id} className="relative bg-white rounded-3xl p-4 mb-3 shadow-sm border border-orange-100 overflow-hidden flex justify-between items-center">
                        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-orange-500" />
                        <div className="pl-3">
                          <div className="font-black text-base text-slate-900 flex items-center gap-2">
                            {c.title}
                            {c.stackable && <span className="bg-purple-50 text-purple-600 text-[9px] px-1.5 py-0.5 rounded-md border border-purple-100">可叠加</span>}
                          </div>
                          <div className="text-[13px] text-orange-600 font-bold mt-1">
                            {c.min_spend > 0 ? `满 ¥${c.min_spend} 减 ¥${c.amount}` : `无门槛减 ¥${c.amount}`}
                          </div>
                          <div className="text-[10px] text-slate-400 font-medium mt-1.5">
                            有效期 {c.expiry_days} 天
                            {c.total_quantity !== null && ` · 剩 ${c.total_quantity - (c.claimed_count || 0)} 张`}
                          </div>
                        </div>
                        <button
                          onClick={() => handleClaimCoupon(c)}
                          disabled={isClaimed || isSoldOut || claimLoading === c.id}
                          className={cn(
                            "px-4 py-2 rounded-full text-xs font-black transition-all",
                            isClaimed ? "bg-slate-100 text-slate-400" : 
                            isSoldOut ? "bg-slate-100 text-slate-400" : 
                            "bg-orange-500 text-white shadow-md shadow-orange-200 active:scale-95"
                          )}
                        >
                          {claimLoading === c.id ? <div className="spinner size-3 border-2" /> : isClaimed ? '已领取' : isSoldOut ? '已抢光' : '抢券'}
                        </button>
                      </div>
                    )
                  })
                )
              )}

              {couponCenterTab === 'unused' && (
                availableCoupons.length === 0 ? (
                  <div className="py-20 flex flex-col items-center justify-center text-slate-400">
                    <Gift size={48} className="opacity-20 mb-3" />
                    <p className="text-[13px] font-bold">暂无可用优惠券</p>
                  </div>
                ) : (
                  availableCoupons.map(uc => {
                    const c = uc.coupon!
                    return (
                      <div key={uc.id} className="relative bg-white rounded-3xl p-4 mb-3 shadow-sm border border-orange-100 overflow-hidden flex justify-between items-center">
                        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-orange-500" />
                        <div className="pl-3">
                          <div className="font-black text-base text-slate-900 flex items-center gap-2">
                            {c.title}
                            {c.stackable && <span className="bg-purple-50 text-purple-600 text-[9px] px-1.5 py-0.5 rounded-md border border-purple-100">可叠加</span>}
                          </div>
                          <div className="text-[13px] text-orange-600 font-bold mt-1">
                            {c.min_spend > 0 ? `满 ¥${c.min_spend} 减 ¥${c.amount}` : `无门槛减 ¥${c.amount}`}
                          </div>
                          <div className="text-[10px] text-slate-400 font-medium mt-1.5">
                            {new Date(uc.expires_at).toLocaleDateString()} 到期
                          </div>
                        </div>
                        <button
                          onClick={() => setShowCouponCenter(false)}
                          className="px-4 py-2 rounded-full text-xs font-black transition-all bg-white border border-orange-500 text-orange-500 active:bg-orange-50 active:scale-95"
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
                if (usedCoupons.length === 0) return <div className="py-20 text-center text-slate-400 text-[13px] font-bold">暂无已使用记录</div>
                return usedCoupons.map((uc: UserCoupon) => {
                  const c = uc.coupon!
                  return (
                    <div key={uc.id} className="relative bg-slate-50/50 rounded-3xl p-4 mb-3 border border-slate-100 overflow-hidden flex justify-between items-center opacity-70">
                      <div className="pl-2">
                        <div className="font-black text-base text-slate-500">{c.title}</div>
                        <div className="text-[13px] text-slate-400 font-bold mt-1">面值 ¥{c.amount}</div>
                      </div>
                      <div className="text-[13px] font-black text-slate-400 mr-2">已使用</div>
                    </div>
                  )
                })
              })()}

              {couponCenterTab === 'invalid' && (() => {
                const invalidCoupons = allMyCoupons.filter((uc: UserCoupon) => uc.status !== 'used' && (new Date(uc.expires_at) <= new Date() || uc.coupon?.status !== 'active'))
                if (invalidCoupons.length === 0) return <div className="py-20 text-center text-slate-400 text-[13px] font-bold">暂无失效记录</div>
                return invalidCoupons.map((uc: UserCoupon) => {
                  const c = uc.coupon!
                  return (
                    <div key={uc.id} className="relative bg-slate-50/50 rounded-3xl p-4 mb-3 border border-slate-100 overflow-hidden flex justify-between items-center opacity-70">
                      <div className="pl-2">
                        <div className="font-black text-base text-slate-500">{c.title}</div>
                        <div className="text-[13px] text-slate-400 font-bold mt-1">已过期 / 商家已停用</div>
                      </div>
                      <div className="text-[13px] font-black text-slate-400 mr-2">已失效</div>
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
                          toast(`该券不可与当前券叠加，凑满也无法增加优惠`, 'info')
                          return
                        }

                        if (eligibleAmount === 0 && isTargeted) {
                          toast(`未添加该券指定商品`, 'warning')
                        } else if (totalAmount >= minSpend && isTargeted) {
                          toast(`指定商品还差 ¥${gap.toFixed(0)}`, 'warning')
                        } else {
                          toast(`还差 ¥${gap.toFixed(0)} 即可使用`, 'info')
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
          className="fixed right-4 bottom-20 z-50 bg-white rounded-[20px] shadow-[0_4px_20px_rgba(0,0,0,0.15)] px-4 py-2.5 flex items-center gap-2.5 cursor-pointer border-[1.5px] border-orange-500 max-w-[220px] animate-in fade-in duration-300"
        >
          <div className="size-8 rounded-full bg-orange-50 flex items-center justify-center shrink-0">
            {activeOrder.status === 'pending' && <Clock size={16} className="text-orange-500" />}
            {activeOrder.status === 'preparing' && <Package size={16} className="text-blue-500" />}
            {activeOrder.status === 'delivering' && <ArrowRight size={16} className="text-emerald-500" />}
          </div>
          <div className="min-w-0">
            <div className="text-[11px] text-slate-400 font-bold">我的订单</div>
            <div className={cn(
              "text-[13px] font-bold truncate",
              activeOrder.status === 'pending' ? 'text-orange-500' :
              activeOrder.status === 'preparing' ? 'text-blue-500' : 'text-emerald-500'
            )}>
              {activeOrder.status === 'pending' && '等待商家接单...'}
              {activeOrder.status === 'preparing' && '制作中✨'}
              {activeOrder.status === 'delivering' && '配送中 😋'}
            </div>
          </div>
        </div>
      )}

      {/* 提交成功仪式感弹窗 (仪式感 优化) */}
      {showSuccessAnimation && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(255,255,255,0.95)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(5px)',
          animation: 'fadeIn 0.3s ease'
        }}>
          <div style={{
            width: '80px', height: '80px', borderRadius: '50%', background: '#22c55e',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: '28px', color: 'white',
            boxShadow: '0 8px 24px rgba(34, 197, 94, 0.3)',
            animation: 'popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
          }}>
            <CheckCircle size={48} />
          </div>
          <h2 style={{ fontSize: '26px', fontWeight: '900', color: '#111827', marginBottom: '8px' }}>下单成功！</h2>
          <p style={{ fontSize: '15px', color: '#6b7280' }}>正在为您跳转到订单状态页</p>
          
          <div style={{
            marginTop: '40px', padding: '16px 24px', background: '#f0fdf4',
            borderRadius: '20px', color: '#15803d', fontSize: '14px', fontWeight: '700',
            border: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', gap: '8px'
          }}>
            <span>🏃</span> 商家已收到提醒，将尽快为您备餐
          </div>
        </div>
      )}
    </div>
  )
}
