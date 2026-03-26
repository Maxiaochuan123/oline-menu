'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Merchant, Category, Customer, Coupon, MenuItem, DisabledDate } from '@/lib/types'
import { ArrowLeft, Plus, Tag, Users, Search, ChevronRight, Gift, Calendar, Ticket, AlertTriangle, Check, Trash2, LayoutGrid, X, Clock, Eye, EyeOff, Timer } from 'lucide-react'
import Link from 'next/link'
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { Label } from "@/components/ui/label"
import { useToast } from '@/components/common/Toast'
import { cn } from '@/lib/utils'
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { BusinessDateTimePicker } from "@/components/common/BusinessDateTimePicker"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"

/**
 * 动态倒计时组件
 * 提供秒级跳动更新，提升系统“实时感知”和高级感
 */
function LiveCountdown({ targetDate, onEnd }: { targetDate: Date, onEnd?: () => void }) {
  const [timeLeft, setTimeLeft] = useState<string>('')
  const [isNear, setIsNear] = useState(false)
  const hasEnded = useRef(false)

  useEffect(() => {
    const update = () => {
      const now = new Date()
      const diff = targetDate.getTime() - now.getTime()

      if (diff <= 0) {
        setTimeLeft('正在生效...')
        if (!hasEnded.current) {
          hasEnded.current = true
          onEnd?.()
        }
        return
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24))
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24)
      const minutes = Math.floor((diff / (1000 * 60)) % 60)
      const seconds = Math.floor((diff / 1000) % 60)

      setIsNear(days === 0 && hours === 0 && minutes < 60)

      if (days > 0) {
        setTimeLeft(`${days}天 ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`)
      } else {
        setTimeLeft(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`)
      }
    }

    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [targetDate, onEnd])

  return (
    <span className={cn(
      "text-sm font-black tracking-tight tabular-nums transition-colors duration-500",
      isNear ? "text-violet-600" : "text-indigo-500"
    )}>
      {timeLeft}
    </span>
  )
}

function getScheduledStartTime(startTime: string | null): Date | null {
  if (!startTime) return null

  const date = new Date(startTime)
  return date > new Date() ? date : null
}

const couponSchema = z.object({
  title: z.string().min(1, "请输入卡券名称"),
  amount: z.any()
    .refine((v) => v !== '' && v != null && v !== undefined, "请输入抵扣面额")
    .refine((v) => !isNaN(Number(v)) && Number(v) > 0, "面额必须大于0"),
  min_spend: z.any()
    .refine((v) => v !== '' && v != null && v !== undefined, "请输入消费门槛")
    .refine((v) => !isNaN(Number(v)) && Number(v) >= 0, "门槛不能为负数"),
  expiry_days: z.any()
    .refine((v) => v !== '' && v != null && v !== undefined, "请输入有效期天数")
    .refine((v) => !isNaN(Number(v)) && Number(v) >= 1, "有效期至少1天"),
  is_newcomer_reward: z.boolean().default(false),
  target_type: z.enum(['all', 'category', 'customer']),
  start_time: z.date().nullable().optional(),
  target_category_id: z.string().nullable().optional(),
  target_customer_ids: z.array(z.string()).default([]),
  target_item_ids: z.array(z.string()).default([]),
  stackable: z.boolean().default(false),
  total_quantity: z.any().optional(),
  is_unlimited: z.boolean().default(false),
}).refine((data) => {
  if (!data.is_unlimited) {
    return data.total_quantity !== '' && data.total_quantity != null && !isNaN(Number(data.total_quantity)) && Number(data.total_quantity) >= 1;
  }
  return true;
}, {
  message: "请输入发放总量 (至少1张)",
  path: ["total_quantity"],
}).refine((data) => {
  if (data.target_type === 'category') {
    return data.target_item_ids.length > 0;
  }
  return true;
}, {
  message: "请至少选择一个定向菜品",
  path: ["target_item_ids"],
}).refine((data) => {
  if (data.target_type === 'customer') {
    return data.target_customer_ids.length > 0;
  }
  return true;
}, {
  message: "请至少选择一个定向用户",
  path: ["target_customer_ids"],
});

type CouponFormValues = z.infer<typeof couponSchema>
type CouponFormInput = z.input<typeof couponSchema>

export default function CouponsPage() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [disabledDates, setDisabledDates] = useState<DisabledDate[]>([])
  const [couponStats, setCouponStats] = useState<Record<string, {used: number, pending: number, expired: number}>>({})
  const [loading, setLoading] = useState(true)

  const form = useForm<CouponFormInput>({
    resolver: zodResolver(couponSchema),
    defaultValues: {
      title: '',
      amount: '' as unknown as number,
      min_spend: '' as unknown as number,
      expiry_days: '' as unknown as number,
      is_newcomer_reward: false,
      target_type: 'all',
      target_category_id: null,
      target_customer_ids: [],
      target_item_ids: [],
      stackable: false,
      total_quantity: '' as unknown as number,
      is_unlimited: false,
      start_time: null,
    },
  })

  // 客户搜索
  const [custSearch, setCustSearch] = useState('')
  
  // 表单显示控制
  const [showForm, setShowForm] = useState(false)
  
  // 预览用状态
  const [viewingCoupon, setViewingCoupon] = useState<Coupon | null>(null)

  // 删除确认弹窗
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // 树形选择器展开的分类
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())

  const { control, handleSubmit, reset, setValue, getValues, formState: { errors } } = form

  const targetType = useWatch({ control, name: 'target_type' })
  const targetItemIds = useWatch({ control, name: 'target_item_ids' }) || []
  const targetCustomerIds = useWatch({ control, name: 'target_customer_ids' }) || []
  const isUnlimited = useWatch({ control, name: 'is_unlimited' })

  const { toast } = useToast()

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: m } = await supabase.from('merchants').select('*').eq('user_id', user.id).single()
    if (!m) return
    setMerchant(m)

    const [cpnRes, catRes, itemRes, custRes, dRes] = await Promise.all([
      supabase.from('coupons').select('*').eq('merchant_id', m.id).order('created_at', { ascending: false }),
      supabase.from('categories').select('*').eq('merchant_id', m.id).order('sort_order'),
      supabase.from('menu_items').select('*').eq('merchant_id', m.id).order('name'),
      supabase.from('customers').select('*').eq('merchant_id', m.id).order('name'),
      supabase.from('disabled_dates').select('*').eq('merchant_id', m.id),
    ])
    setCoupons(cpnRes.data || [])
    setCategories(catRes.data || [])
    setMenuItems(itemRes.data || [])
    setCustomers(custRes.data || [])
    setDisabledDates(dRes.data || [])

    if (cpnRes.data && cpnRes.data.length > 0) {
      const cpnIds = cpnRes.data.map(c => c.id)
      const { data: ucData } = await supabase.from('user_coupons').select('coupon_id, status, expires_at').in('coupon_id', cpnIds)
      if (ucData) {
        const stats: Record<string, {used: number, pending: number, expired: number}> = {}
        const now = new Date()
        ucData.forEach(uc => {
          if (!stats[uc.coupon_id]) stats[uc.coupon_id] = { used: 0, pending: 0, expired: 0 }
          if (uc.status === 'used') {
            stats[uc.coupon_id].used++
          } else {
            if (new Date(uc.expires_at) < now) {
              stats[uc.coupon_id].expired++
            } else {
              stats[uc.coupon_id].pending++
            }
          }
        })
        setCouponStats(stats)
      }
    }

    setLoading(false)
  }, [supabase, router])

  useEffect(() => {
    const init = async () => {
      await loadData()
    }
    init()
  }, [loadData])

  const onInvalid = () => {
    toast('请填写表单信息', 'warning')
  }

  async function onSubmit(values: CouponFormValues) {
    if (viewingCoupon) {
      setShowForm(false);
      setViewingCoupon(null);
      return;
    }
    if (!merchant) return

    const insertData: Record<string, unknown> = {
      merchant_id: merchant.id,
      title: values.title,
      amount: Number(values.amount),
      min_spend: Number(values.min_spend),
      expiry_days: Number(values.expiry_days),
      is_newcomer_reward: values.is_newcomer_reward,
      target_type: values.target_type,
      stackable: values.stackable,
      status: 'active',
      start_time: values.start_time ? values.start_time.toISOString() : null,
    }

    if (values.is_unlimited) {
      insertData.total_quantity = null
    } else if (values.total_quantity !== undefined) {
      insertData.total_quantity = values.total_quantity
    } else {
      toast('请指定发行量或开启不限量', 'warning')
      return 
    }
    if (values.target_type === 'category') {
      if (values.target_item_ids.length > 0) insertData.target_item_ids = values.target_item_ids
    }
    if (values.target_type === 'customer') insertData.target_customer_ids = values.target_customer_ids

    const { error } = await supabase.from('coupons').insert(insertData)
    if (error) toast('创建失败: ' + error.message, 'error')
    else {
      toast('优惠券创建成功')
      setShowForm(false)
      reset()
      loadData()
    }
  }

  async function toggleStatus(id: string, current: string) {
    const { error } = await supabase.from('coupons').update({ status: current === 'active' ? 'disabled' : 'active' }).eq('id', id)
    if (error) toast('操作失败', 'error')
    else {
      toast(current === 'active' ? '已禁用优惠券' : '已启用优惠券')
      loadData()
    }
  }

  async function deleteCoupon(id: string) {
    const stats = couponStats[id] || { used: 0, pending: 0, expired: 0 }
    if (stats.pending > 0) {
      toast(`删除失败：还有 ${stats.pending} 张有效券未核销`, 'error')
      return
    }
    setDeleteConfirmId(id)
  }

  async function confirmDelete() {
    if (!deleteConfirmId) return
    const { count } = await supabase
      .from('user_coupons')
      .select('id', { count: 'exact', head: true })
      .eq('coupon_id', deleteConfirmId)

    if ((count ?? 0) > 0) {
      await supabase.from('coupons').update({ status: 'disabled' }).eq('id', deleteConfirmId)
      toast(`包含历史数据，已转为下架状态`, 'info')
    } else {
      await supabase.from('coupons').delete().eq('id', deleteConfirmId)
      toast('卡券已成功删除')
    }
    setDeleteConfirmId(null)
    loadData()
  }

  // 树形选择器：切换分类
  function toggleCategory(catId: string) {
    const itemsInCat = menuItems.filter(i => i.category_id === catId)
    const currentIds = getValues('target_item_ids') || []
    const allSelected = itemsInCat.every(i => currentIds.includes(i.id))
    
    if (allSelected) {
      setValue('target_item_ids', currentIds.filter(id => !itemsInCat.some(i => i.id === id)))
    } else {
      const ids = new Set([...currentIds, ...itemsInCat.map(i => i.id)])
      setValue('target_item_ids', Array.from(ids))
    }
  }

  function toggleItem(itemId: string) {
    const currentIds = getValues('target_item_ids') || []
    const ids = currentIds.includes(itemId)
      ? currentIds.filter(id => id !== itemId)
      : [...currentIds, itemId]
    setValue('target_item_ids', ids)
  }

  function getCatState(catId: string, currentIds: string[]): 'none' | 'partial' | 'all' {
    const itemsInCat = menuItems.filter(i => i.category_id === catId)
    if (itemsInCat.length === 0) return 'none'
    const selected = itemsInCat.filter(i => currentIds.includes(i.id))
    if (selected.length === 0) return 'none'
    if (selected.length === itemsInCat.length) return 'all'
    return 'partial'
  }

  // 客户搜索过滤
  const filteredCustomers = custSearch
    ? customers.filter(c => c.name.includes(custSearch) || c.phone.includes(custSearch))
    : customers

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50/50 font-sans pb-20 text-slate-900">
      <header className="fixed top-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center justify-between px-5 py-3 shadow-sm shadow-black/5">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="p-2 -ml-2 hover:bg-slate-100 rounded-full transition-colors">
            <ArrowLeft size={20} className="text-slate-600" />
          </Link>
          <div className="flex flex-col">
            <h1 className="text-base font-black tracking-tight leading-none">优惠券管理</h1>
          </div>
        </div>
        <Button 
          size="sm" 
          onClick={() => {
            reset({ 
              title: '', 
              amount: '' as unknown as number, 
              min_spend: '' as unknown as number, 
              expiry_days: '' as unknown as number, 
              is_newcomer_reward: false, 
              target_type: 'all', 
              target_category_id: null, 
              target_customer_ids: [], 
              target_item_ids: [], 
              stackable: false, 
              total_quantity: '' as unknown as number, 
              is_unlimited: false, 
              start_time: null 
            });
            setShowForm(true);
          }}
          className="rounded-full bg-slate-900 hover:bg-slate-800 text-white font-black text-xs px-4"
        >
          <Plus size={14} className="mr-1" /> 发行卡券
        </Button>
      </header>

      <main className="pt-20 px-5 max-w-2xl mx-auto space-y-6">
        {coupons.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[500px] text-center p-8 space-y-6">
            <div className="relative group">
              <div className="absolute inset-0 bg-orange-200 rounded-full blur-3xl opacity-20 group-hover:opacity-40 transition-opacity duration-1000 scale-150" />
              <div className="relative size-40 rounded-[48px] bg-gradient-to-br from-white to-slate-50 shadow-[0_20px_50px_rgba(0,0,0,0.06)] flex items-center justify-center rotate-3 transition-transform group-hover:rotate-0 duration-700">
                <Gift size={80} className="text-orange-500 drop-shadow-2xl" strokeWidth={1.5} />
              </div>
            </div>
            <div className="space-y-2 max-w-[280px]">
              <h2 className="text-2xl font-black tracking-tighter text-slate-900 leading-none">暂无发放中的卡券</h2>
              <p className="text-[13px] font-medium text-slate-400 leading-relaxed">
                还没有发行任何优惠券呢。通过发行券来刺激老客回头、新客光顾吧！
              </p>
            </div>
            <Button 
              onClick={() => {
                reset({ title: '', amount: '' as unknown as number, min_spend: '' as unknown as number, expiry_days: 7, is_newcomer_reward: false, target_type: 'all', target_category_id: null, target_customer_ids: [], target_item_ids: [], stackable: false, total_quantity: 100, is_unlimited: false, start_time: null });
                setShowForm(true);
              }}
              className="h-14 px-10 rounded-2xl bg-orange-600 hover:bg-orange-500 text-white font-black text-[15px] shadow-xl shadow-orange-100 transition-all active:scale-95 flex gap-2"
            >
              <Plus size={20} /> 现在就开始
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            {coupons.map((c) => {
              const stats = couponStats[c.id] || { used: 0, pending: 0, expired: 0 }
              const usageRate = c.claimed_count > 0 ? (stats.used / c.claimed_count) * 100 : 0
              const scheduledStartTime = getScheduledStartTime(c.start_time)
              
              return (
                <Card 
                  key={c.id} 
                  className={cn(
                    "group relative transition-all duration-300 hover:shadow-[0_20px_40px_rgba(0,0,0,0.06)] hover:-translate-y-1 active:scale-[0.98] cursor-pointer",
                    "rounded-[24px] border-none p-0 bg-white shadow-sm ring-1 ring-black/5",
                    c.status !== 'active' && "opacity-60 saturate-50 grayscale-[0.2]"
                  )}
                  onClick={() => {
                    setViewingCoupon(c);
                    reset({
                      title: c.title,
                      amount: c.amount,
                      min_spend: c.min_spend,
                      expiry_days: c.expiry_days,
                      is_newcomer_reward: c.is_newcomer_reward,
                      target_type: c.target_type,
                      target_category_id: c.target_category_id,
                      target_customer_ids: c.target_customer_ids || [],
                      target_item_ids: c.target_item_ids || [],
                      stackable: c.stackable,
                      total_quantity: c.total_quantity ?? (c.total_quantity === null ? '' : ''),
                      is_unlimited: c.total_quantity === null,
                      // 详情回填和列表展示保持一致：只要 start_time 还在未来，就视为“定时生效”
                      // 已过生效时间的券在详情里按已激活展示，避免同一张券出现列表显示预热、详情却显示非定时的状态分叉
                      start_time: scheduledStartTime
                    });

                    if (c.target_type === 'category' && c.target_item_ids?.length) {
                      const expanded = new Set<string>();
                      menuItems.forEach(item => {
                        if (c.target_item_ids?.includes(item.id)) {
                          expanded.add(item.category_id);
                        }
                      });
                      setExpandedCats(expanded);
                    } else {
                      setExpandedCats(new Set());
                    }

                    setShowForm(true);
                  }}
                >
                  <CardContent className="p-0 flex h-40 relative bg-white rounded-[24px] overflow-hidden">
                    {/* 左侧面值装饰区 */}
                    <div className={cn(
                      "w-28 sm:w-32 py-5 flex flex-col items-center justify-center text-white shrink-0 relative transition-all duration-500 rounded-l-[24px]",
                      scheduledStartTime ? "bg-gradient-to-br from-violet-600 to-indigo-500 shadow-lg shadow-violet-100/50" :
                      c.target_type === 'all' ? "bg-gradient-to-r from-orange-600 to-orange-500" :
                      c.target_type === 'category' ? "bg-gradient-to-r from-indigo-600 to-indigo-500" :
                      "bg-gradient-to-r from-emerald-600 to-emerald-500"
                    )}>
                      {/* 背景纹理/光影 */}
                      <div className="absolute inset-0 opacity-10 pointer-events-none overflow-hidden rounded-l-[24px]">
                        <div className="absolute top-0 right-0 size-20 bg-white rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl font-black" />
                      </div>

                      <div className="relative flex flex-col items-center z-10">
                        <div className="flex items-baseline gap-0.5">
                          <span className="text-sm font-black leading-none opacity-80 -mt-2">¥</span>
                          <span className="text-4xl font-black tracking-tighter leading-none">{c.amount}</span>
                        </div>
                        <span className="text-[10px] sm:text-[11px] font-black mt-2 uppercase tracking-widest opacity-90 block">
                          {c.min_spend > 0 ? `满 ¥${c.min_spend} 可用` : "无门槛限制"}
                        </span>
                      </div>
                    </div>

                    <div className="absolute top-0 bottom-0 left-28 sm:left-32 w-4 bg-gradient-to-r from-black/5 to-transparent pointer-events-none z-10" />

                    {/* 右侧信息区 */}
                    <div className="flex-1 px-5 py-3.5 pb-5 flex flex-col justify-between bg-white relative">
                      {scheduledStartTime && (
                        <div className="absolute top-0 right-0 px-3 py-1 bg-violet-600 text-white rounded-bl-2xl flex items-center gap-1.5 shadow-sm">
                           <Timer size={10} strokeWidth={4} className="animate-spin-slow" />
                           <span className="text-[9px] font-black uppercase tracking-widest leading-none">预热发放中</span>
                        </div>
                      )}
                      
                      <div className={cn("space-y-1", scheduledStartTime && "mt-1.5")}>
                        <div className="flex items-start justify-between">
                          <h3 className="font-black text-[17px] text-slate-900 leading-[1.2] tracking-tight truncate pr-2 flex-1 group-hover:text-orange-600 transition-colors">
                            {c.title}
                          </h3>
                          <div className="flex items-center gap-1.5 shrink-0 ml-1">
                            <button 
                                className={cn(
                                    "size-8 rounded-xl flex items-center justify-center transition-all active:scale-95",
                                    c.status === 'active' ? "text-emerald-500 bg-emerald-50 active:bg-emerald-100" : "text-slate-400 bg-slate-50 active:bg-slate-100"
                                )} 
                                onClick={(e) => { e.stopPropagation(); toggleStatus(c.id, c.status); }}
                            >
                              {c.status === 'active' ? <Eye size={16} /> : <EyeOff size={16} />}
                            </button>
                            {c.claimed_count === 0 && (
                              <button 
                                className="size-8 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center active:bg-rose-100 active:scale-95 transition-all"
                                onClick={(e) => { e.stopPropagation(); deleteCoupon(c.id); }}
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          <Badge className="bg-slate-50 text-slate-500 font-black text-[9px] h-5 py-0 border-none rounded-full flex gap-1 uppercase tracking-tighter">
                            <Clock size={10} strokeWidth={3} /> {c.expiry_days}天有效期
                          </Badge>
                          {c.is_newcomer_reward && (
                            <Badge className="bg-blue-50 text-blue-600 font-black text-[9px] h-5 py-0 border-none rounded-full uppercase tracking-tighter">新客专享</Badge>
                          )}
                          {c.target_type === 'category' && (
                            <Badge className="bg-violet-50 text-violet-600 font-black text-[9px] h-5 py-0 border-none rounded-full uppercase tracking-tighter">指定菜品</Badge>
                          )}
                        </div>
                      </div>

                      {/* 统计迷你条 / 倒计时 */}
                      {scheduledStartTime ? (
                        <div className="flex items-center justify-between mt-3 py-2.5 px-4 rounded-2xl bg-gradient-to-r from-violet-50 to-indigo-50/30 border border-violet-100/50 shadow-inner">
                           <div className="flex flex-col">
                             <div className="flex items-center gap-1.5 mb-0.5">
                               <Timer size={12} className="text-violet-500" />
                               <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">生效倒计时</span>
                             </div>
                              <LiveCountdown targetDate={scheduledStartTime} onEnd={loadData} />
                           </div>
                           <div className="size-8 rounded-full bg-violet-100 flex items-center justify-center">
                              <Timer size={16} className="text-violet-600 animate-pulse" />
                           </div>
                        </div>
                      ) : (
                        <div className="space-y-2 mt-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <div className="size-1.5 rounded-full bg-orange-500 animate-pulse" />
                              <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">核销概览</span>
                            </div>
                            <span className="text-[12px] font-black text-slate-900 tabular-nums">{usageRate.toFixed(1)}%</span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex gap-0.5">
                            <div className="h-full bg-orange-500" style={{ width: `${usageRate}%` }} />
                            <div className="h-full bg-amber-400" style={{ width: `${((stats.pending as number) / (c.total_quantity || 100)) * 100}%` }} />
                          </div>
                          <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-tighter">
                            <span className="flex items-center gap-1"><Ticket size={12} strokeWidth={2.5} /> {stats.used}/{c.total_quantity || '∞'} 已用</span>
                            <span className="flex items-center gap-1"><Users size={12} strokeWidth={2.5} /> {c.claimed_count} 人领取</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </main>

      {/* 创建/详情 Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); setViewingCoupon(null); } }}>
        <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden border-none rounded-[24px] shadow-2xl bg-slate-50 [&>button]:hidden">
          
          <div className="bg-white px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 relative z-10">
            <h3 className="font-black text-[17px] text-slate-900 flex items-center gap-2">
              <Gift className="text-orange-500" size={18} />
              {viewingCoupon ? "卡券详情回顾" : "发行新优惠券"}
            </h3>
            <Button size="icon" variant="ghost" className="size-8 text-slate-400 rounded-full hover:bg-slate-100" onClick={() => { setShowForm(false); setViewingCoupon(null); }}>
              <X size={18} />
            </Button>
          </div>

          <Form {...form}>
            <form onSubmit={handleSubmit(onSubmit as Parameters<typeof handleSubmit>[0], onInvalid)} className="relative flex flex-col max-h-[85vh]">
              <div className="flex-1 w-full overflow-y-auto overscroll-contain custom-scrollbar">
                <fieldset disabled={!!viewingCoupon} className={cn("p-5 space-y-5 pb-28 border-none m-0", viewingCoupon && "opacity-90")}>
                  <div className="space-y-6">
                    {/* 核心面值 */}
                    <Card className="bg-white border-none shadow-md shadow-slate-200/50 p-5 rounded-3xl space-y-5">
                      <div className="flex items-center gap-2 px-1">
                        <div className="size-2 h-4 bg-orange-500 rounded-full" />
                        <span className="text-[11px] font-black text-slate-900 uppercase tracking-wider">价值设定</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="amount"
                          render={({ field }) => (
                            <FormItem className="space-y-1.5">
                              <FormLabel className="text-[10px] font-black text-slate-500 uppercase tracking-tighter ml-1">抵扣面额 (¥)</FormLabel>
                              <FormControl>
                                <Input 
                                  type="number" 
                                  pattern="[0-9]*"
                                  inputMode="decimal"
                                  placeholder="例: 5"
                                  className="h-12 text-lg font-bold rounded-2xl border-white bg-white shadow-sm focus-visible:ring-orange-500 placeholder:text-sm placeholder:font-normal placeholder:text-slate-400" 
                                  {...field}
                                  value={field.value ?? ''}
                                  onChange={e => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
                                />
                              </FormControl>
                              <FormMessage className="text-[10px] ml-1" />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="min_spend"
                          render={({ field }) => (
                            <FormItem className="space-y-1.5">
                              <FormLabel className="text-[10px] font-black text-slate-500 uppercase tracking-tighter ml-1">消费门槛 (¥)</FormLabel>
                              <FormControl>
                                <Input 
                                  type="number" 
                                  pattern="[0-9]*"
                                  inputMode="decimal"
                                  placeholder="例: 30 (0为无门槛)"
                                  className="h-12 text-lg font-bold rounded-2xl border-white bg-white shadow-sm focus-visible:ring-orange-500 placeholder:text-sm placeholder:font-normal placeholder:text-slate-400" 
                                  {...field}
                                  value={field.value ?? ''}
                                  onChange={e => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
                                />
                              </FormControl>
                              <FormMessage className="text-[10px] ml-1" />
                            </FormItem>
                          )}
                        />
                      </div>
                      <FormField
                        control={form.control}
                        name="title"
                        render={({ field }) => (
                          <FormItem className="space-y-1.5">
                            <FormLabel className="text-[10px] font-black text-slate-500 uppercase tracking-tighter ml-1">卡券名称</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="给卡券起个名字，如：新客专享红包" 
                                className="h-12 font-medium rounded-2xl border-white bg-white shadow-sm focus-visible:ring-orange-500 placeholder:text-sm placeholder:font-normal placeholder:text-slate-400" 
                                {...field}
                              />
                            </FormControl>
                            <FormMessage className="text-[10px] ml-1" />
                          </FormItem>
                        )}
                      />
                    </Card>

                    {/* 规则设置 */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 px-1">
                        <div className="size-2 h-4 bg-slate-400 rounded-full" />
                        <span className="text-[11px] font-black text-slate-900 uppercase tracking-wider">周期与额度</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="expiry_days"
                          render={({ field }) => (
                            <FormItem className="space-y-1.5">
                              <FormLabel className="text-[10px] font-black text-slate-500 uppercase tracking-tighter ml-1 flex items-center gap-1">
                                <Calendar size={10} /> 有效期 (天)
                              </FormLabel>
                              <FormControl>
                                 <Input 
                                  type="number" 
                                  inputMode="numeric"
                                  placeholder="必填天数 (例: 7)"
                                  className="h-11 rounded-xl font-bold border-slate-100 placeholder:text-sm placeholder:font-normal placeholder:text-slate-400" 
                                  {...field}
                                  value={field.value ?? ''}
                                  onChange={e => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
                                />
                              </FormControl>
                              <FormMessage className="text-[10px] ml-1" />
                            </FormItem>
                          )}
                        />
                        <div className="space-y-1.5 flex-1 flex flex-col">
                          <div className="flex items-center justify-between mb-0.5">
                            <Label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter ml-1 flex items-center gap-1">
                              <Ticket size={10} /> 总发行量
                            </Label>
                            <FormField
                              control={form.control}
                              name="is_unlimited"
                              render={({ field }) => (
                                <div className="flex items-center gap-2 pr-1">
                                  <span className="text-[10px] font-black text-slate-400">不限量</span>
                                  <Switch 
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                    className="scale-75 data-[state=checked]:bg-orange-500"
                                  />
                                </div>
                              )}
                            />
                          </div>
                          <FormField
                            control={form.control}
                            name="total_quantity"
                            render={({ field }) => (
                              <FormItem className="space-y-0">
                                <FormControl>
                                   <Input 
                                    type="number" 
                                    placeholder={isUnlimited ? "∞ 不限量发放" : "必填发行数量"}
                                    disabled={isUnlimited}
                                    className={cn(
                                      "h-11 rounded-xl font-bold border-slate-100 placeholder:text-sm placeholder:font-normal placeholder:text-slate-400 transition-all",
                                      isUnlimited && "bg-slate-50 text-slate-300 font-medium opacity-50"
                                    )}
                                    {...field}
                                    value={field.value ?? ''}
                                    onChange={e => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
                                  />
                                </FormControl>
                                <FormMessage className="text-[10px] ml-1 mt-1" />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                      
                      {/* 定时生效开关和选择器 */}
                      <FormField
                        control={form.control}
                        name="start_time"
                        render={({ field }) => (
                          <FormItem className="space-y-3 p-4 rounded-2xl bg-violet-50/50 border border-violet-100">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="size-9 bg-violet-100 rounded-xl flex items-center justify-center text-violet-600">
                                  <Timer size={18} />
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-sm font-black text-violet-950">定时生效</span>
                                  <span className="text-[10px] text-violet-400 font-bold leading-none">指定卡券自动激活的时间</span>
                                </div>
                              </div>
                              <FormControl>
                                <Switch 
                                  checked={!!field.value}
                                  onCheckedChange={(checked) => field.onChange(checked ? new Date() : null)}
                                  className="data-[state=checked]:bg-violet-500"
                                />
                              </FormControl>
                            </div>
                            
                            {field.value && (
                              <div className="animate-in slide-in-from-top-2 duration-300 pt-2 space-y-3">
                                <BusinessDateTimePicker 
                                  value={field.value}
                                  onChange={field.onChange}
                                  merchant={merchant}
                                  disabledDates={disabledDates}
                                  placeholder="选择生效日期"
                                  minTimeBuffer={0} 
                                  onHolidaySelect={(name, duration) => {
                                    // 自动设置节日推荐有效期并通知商户
                                    form.setValue('expiry_days', String(duration));
                                    toast(`✨ ${name}：有效期已设为 ${duration}天`, "info");
                                  }}
                                />
                                <div className="px-3 py-2 bg-violet-100/50 rounded-xl">
                                  <p className="text-[10px] text-violet-600 font-black uppercase tracking-wider text-center">
                                    卡券将在 {format(field.value, "PPP p", { locale: zhCN })} 准时生效
                                  </p>
                                </div>
                              </div>
                            )}
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2 px-1 mb-1">
                        <div className="size-2 h-4 bg-blue-400 rounded-full" />
                        <span className="text-[11px] font-black text-slate-900 uppercase tracking-wider">智能助手</span>
                      </div>
                      <FormField
                        control={control}
                        name="is_newcomer_reward"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between p-4 rounded-2xl bg-white border border-slate-100 shadow-sm transition-all active:scale-[0.98] group hover:border-blue-200">
                            <div className="flex items-center gap-4">
                              <div className="size-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-500 shrink-0 group-hover:bg-blue-100 transition-colors">
                                <Users size={20} />
                              </div>
                              <div className="flex flex-col text-left">
                                <span className="text-[14px] font-black text-slate-900 tracking-tight leading-none">新客直发单</span>
                                <span className="text-[10px] font-bold text-slate-400 mt-1.5 uppercase tracking-wide">系统将自动发放给新注册用户</span>
                              </div>
                            </div>
                            <FormControl>
                              <Switch 
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                className="data-[state=checked]:bg-blue-500 shadow-sm scale-110"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={control}
                        name="stackable"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between p-4 rounded-2xl bg-white border border-slate-100 shadow-sm transition-all active:scale-[0.98] group hover:border-violet-200">
                            <div className="flex items-center gap-4">
                              <div className="size-10 rounded-xl bg-violet-50 flex items-center justify-center text-violet-500 shrink-0 group-hover:bg-violet-100 transition-colors">
                                <LayoutGrid size={20} />
                              </div>
                              <div className="flex flex-col text-left">
                                <span className="text-[14px] font-black text-slate-900 tracking-tight leading-none">多券叠叠乐</span>
                                <span className="text-[10px] font-bold text-slate-400 mt-1.5 uppercase tracking-wide">允许与其它折扣促销共同使用</span>
                              </div>
                            </div>
                            <FormControl>
                              <Switch 
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                className="data-[state=checked]:bg-violet-500 shadow-sm scale-110"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="space-y-4 pb-2">
                      <div className="flex items-center gap-2 px-1">
                        <span className="text-[11px] font-black text-slate-400">定向推广券</span>
                        <Separator className="flex-1 opacity-50" />
                      </div>

                      <FormField
                        control={control}
                        name="target_type"
                        render={({ field }) => (
                          <div className="flex p-1.5 bg-slate-200/50 rounded-2xl gap-1">
                            {[
                              { id: 'all', label: '全场通用', icon: <Check size={14} /> },
                              { id: 'category', label: '定向菜品', icon: <Tag size={13} /> },
                              { id: 'customer', label: '定向用户', icon: <Users size={14} /> }
                            ].map((btn) => (
                              <button
                                key={btn.id}
                                type="button"
                                onClick={() => field.onChange(btn.id)}
                                className={cn(
                                  "flex-1 flex flex-col items-center gap-1.5 py-3 rounded-[14px] transition-all",
                                  field.value === btn.id 
                                    ? "bg-white shadow-md text-slate-900" 
                                    : "text-slate-400 hover:text-slate-600"
                                )}
                              >
                                <span className={cn("size-7 rounded-lg flex items-center justify-center transition-all", field.value === btn.id ? "bg-slate-900 text-white scale-110" : "bg-slate-200")}>
                                  {btn.icon}
                                </span>
                                <span className="text-[10px] font-black tracking-tight leading-none">{btn.label}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      />

                      {targetType === 'category' && (
                        <div className="space-y-2">
                          {categories.length === 0 ? (
                            <div className="p-8 border border-dashed border-slate-200 rounded-3xl bg-slate-50 flex flex-col items-center justify-center space-y-4">
                              <div className="size-16 rounded-[24px] bg-white shadow-sm flex items-center justify-center text-slate-300">
                                <Tag size={32} />
                              </div>
                              <div className="text-center">
                                <p className="text-xs font-black text-slate-900 tracking-tight">暂未发现菜品数据</p>
                                <p className="text-[10px] text-slate-400 font-bold mt-1">需先添加菜品才能设置定向券</p>
                              </div>
                              <Link href="/menu">
                                <Button size="sm" variant="outline" className="h-9 rounded-full border-slate-900 bg-slate-900 text-white font-black text-[11px] px-6 hover:bg-slate-800">
                                  去添加菜品 (加个菜)
                                </Button>
                              </Link>
                            </div>
                          ) : (
                            <Card className="border-none shadow-none ring-1 ring-slate-100 rounded-2xl overflow-hidden">
                              <div className="h-48 overflow-y-auto overscroll-contain custom-scrollbar">
                                <div className="divide-y divide-slate-50">
                                  {categories.map(cat => {
                                  const catState = getCatState(cat.id, targetItemIds)
                                  const isExpanded = expandedCats.has(cat.id)
                                  const itemsInCat = menuItems.filter(i => i.category_id === cat.id)
                                  return (
                                    <div key={cat.id} className="text-left">
                                      <div className="flex items-center gap-3 p-3 bg-slate-50/30">
                                        <Checkbox 
                                          checked={catState === 'all' || catState === 'partial'}
                                          onCheckedChange={() => toggleCategory(cat.id)}
                                        />
                                        <div 
                                            className="flex-1 flex items-center justify-between cursor-pointer group"
                                            onClick={() => {
                                              const next = new Set(expandedCats)
                                              if (isExpanded) next.delete(cat.id)
                                              else next.add(cat.id)
                                              setExpandedCats(next)
                                            }}
                                        >
                                            <span className="font-black text-xs text-slate-700">{cat.name}</span>
                                            <ChevronRight size={14} className={cn("text-slate-400 transition-transform", isExpanded && "rotate-90")} />
                                        </div>
                                      </div>
                                      {isExpanded && (
                                        <div className="bg-white">
                                          {itemsInCat.map(item => (
                                            <div key={item.id} className="flex items-center gap-3 py-2.5 px-3 pl-10 border-b border-slate-50 transition-colors hover:bg-orange-50/30">
                                              <Checkbox 
                                                  checked={targetItemIds.includes(item.id)}
                                                  onCheckedChange={() => toggleItem(item.id)}
                                              />
                                              <span className="text-[13px] font-bold text-slate-600">{item.name}</span>
                                              <span className="text-[10px] font-medium text-slate-400 ml-auto">¥{item.price}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                );
                              })}
                            </div>
                          </div>
                        </Card>
                      )}
                      {errors.target_item_ids?.message && (
                        <p className="text-[10px] ml-1 text-rose-500 font-bold">
                          {errors.target_item_ids?.message.toString()}
                        </p>
                      )}
                    </div>
                  )}

                      {targetType === 'customer' && (
                        <div className="space-y-3">
                          {customers.length === 0 ? (
                            <div className="p-8 border border-dashed border-slate-200 rounded-3xl bg-slate-50 flex flex-col items-center justify-center space-y-4">
                              <div className="size-16 rounded-[24px] bg-white shadow-sm flex items-center justify-center text-slate-300">
                                <Users size={32} />
                              </div>
                              <div className="text-center">
                                <p className="text-xs font-black text-slate-900 tracking-tight">暂无活跃顾客</p>
                                <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-wider">还没有用户下单哦 (系统将自动同步)</p>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="relative group">
                                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                                  <Input 
                                    placeholder="寻找特定用户..." 
                                    className="h-11 pl-10 rounded-xl"
                                   value={custSearch}
                                    onChange={e => setCustSearch(e.target.value)}
                                  />
                              </div>

                              {targetCustomerIds.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 min-h-6">
                                  {targetCustomerIds.map(id => {
                                    const c = customers.find(cu => cu.id === id)
                                    return c && (
                                      <Badge key={id} variant="secondary" className="bg-orange-50 text-orange-600 font-black text-[9px] py-0 px-2 h-5 border-none rounded-full flex gap-1 items-center">
                                        {c.name}
                                        <X size={10} className="cursor-pointer" onClick={() => {
                                          const next = targetCustomerIds.filter(idx => idx !== id)
                                          setValue('target_customer_ids', next)
                                        }} />
                                      </Badge>
                                    )
                                  })}
                                </div>
                              )}

                              <div className="h-48 overflow-y-auto overscroll-contain custom-scrollbar space-y-1 pr-1">
                                {filteredCustomers.map(c => (
                                  <div 
                                    key={c.id} 
                                    className={cn(
                                      "flex items-center justify-between p-3 rounded-2xl border transition-all cursor-pointer",
                                      targetCustomerIds.includes(c.id) 
                                        ? "bg-orange-50 border-orange-200 shadow-sm" 
                                        : "bg-white border-slate-100 hover:border-orange-200"
                                    )}
                                    onClick={() => {
                                      const next = targetCustomerIds.includes(c.id)
                                        ? targetCustomerIds.filter(id => id !== c.id)
                                        : [...targetCustomerIds, c.id]
                                      setValue('target_customer_ids', next)
                                    }}
                                  >
                                    <div className="flex items-center gap-3">
                                      <Avatar className="size-8 rounded-full">
                                        <AvatarImage src={c.avatar_url || ''} />
                                        <AvatarFallback className="bg-orange-100 text-orange-600 font-black text-[10px]">
                                          {c.name.slice(0, 1)}
                                        </AvatarFallback>
                                      </Avatar>
                                      <div className="flex flex-col text-left">
                                        <span className="text-xs font-black text-slate-900 tracking-tight leading-none">{c.name}</span>
                                        <span className="text-[10px] font-bold text-slate-400 mt-1">{c.phone}</span>
                                      </div>
                                    </div>
                                    <div className={cn(
                                      "size-5 rounded-full flex items-center justify-center transition-all",
                                      targetCustomerIds.includes(c.id) ? "bg-orange-500 text-white" : "bg-slate-100 text-slate-300"
                                    )}>
                                      <Check size={12} strokeWidth={3} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                          {errors.target_customer_ids?.message && (
                            <p className="text-[10px] ml-1 text-rose-500 font-bold">
                              {errors.target_customer_ids?.message.toString()}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </fieldset>
              </div>
 
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-white border-t border-slate-100 z-10 w-full shrink-0 shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
                {viewingCoupon ? (
                  <Button type="button" className="w-full h-12 rounded-[14px] bg-slate-900 font-black text-[15px] shadow-sm" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowForm(false); setViewingCoupon(null); }}>
                    我知道了
                  </Button>
                ) : (
                  <Button type="submit" className="w-full h-12 rounded-[14px] bg-slate-900 font-black text-[15px] shadow-sm transition-transform active:scale-95">
                    确认发行
                  </Button>
                )}
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <DialogContent className="sm:max-w-[400px] p-8 pb-7 rounded-[32px] border-none shadow-2xl grid gap-6">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="size-20 rounded-3xl bg-rose-50 flex items-center justify-center text-rose-500 mb-2 shadow-inner">
              <AlertTriangle size={40} strokeWidth={2.5} />
            </div>
            <DialogHeader>
              <DialogTitle className="text-2xl font-black tracking-tighter text-slate-900">确认删除？</DialogTitle>
              <DialogDescription className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-2">
                当前操作不可撤销
              </DialogDescription>
            </DialogHeader>
            <p className="text-[14px] font-medium text-slate-500 leading-relaxed px-4">
              确定要删除该优惠券吗？删除后正在进行的营销活动将立即终止。
            </p>
          </div>
          <div className="flex gap-4 pt-2">
            <Button variant="ghost" className="flex-1 h-14 rounded-2xl font-black text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all" onClick={() => setDeleteConfirmId(null)}>取消</Button>
            <Button className="flex-1 h-14 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-black shadow-xl shadow-rose-200 transition-all active:scale-95" onClick={confirmDelete}>确认删除</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
