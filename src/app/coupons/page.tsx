'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Merchant, Category, Customer, Coupon, MenuItem } from '@/lib/types'
import { ArrowLeft, Plus, X, Tag, Users, Search, ChevronRight } from 'lucide-react'
import Link from 'next/link'

export default function CouponsPage() {
  const supabase = createClient()
  const router = useRouter()
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [couponStats, setCouponStats] = useState<Record<string, {used: number, pending: number, expired: number}>>({})
  const [loading, setLoading] = useState(true)

  // 创建表单
  const [showForm, setShowForm] = useState(false)
  const [newCoupon, setNewCoupon] = useState({
    title: '',
    amount: 5,
    min_spend: 30,
    expiry_days: 7,
    is_global: false,
    target_type: 'all' as 'all' | 'category' | 'customer',
    target_category_id: null as string | null,
    target_customer_ids: [] as string[],
    target_item_ids: [] as string[],
    stackable: false,
    total_quantity: null as number | null,
  })

  // 客户搜索
  const [custSearch, setCustSearch] = useState('')
  
  // 预览用状态
  const [viewingCoupon, setViewingCoupon] = useState<Coupon | null>(null)

  // 树形选择器展开的分类
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: m } = await supabase.from('merchants').select('*').eq('user_id', user.id).single()
    if (!m) return
    setMerchant(m)

    const [cpnRes, catRes, itemRes, custRes] = await Promise.all([
      supabase.from('coupons').select('*').eq('merchant_id', m.id).order('created_at', { ascending: false }),
      supabase.from('categories').select('*').eq('merchant_id', m.id).order('sort_order'),
      supabase.from('menu_items').select('*').eq('merchant_id', m.id).order('name'),
      supabase.from('customers').select('*').eq('merchant_id', m.id).order('name'),
    ])
    setCoupons(cpnRes.data || [])
    setCategories(catRes.data || [])
    setMenuItems(itemRes.data || [])
    setCustomers(custRes.data || [])

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
    let mounted = true
    loadData().then(() => {
      if (!mounted) return
    })
    return () => { mounted = false }
  }, [loadData])

  async function addCoupon() {
    if (!merchant || !newCoupon.title) return
    const insertData: Record<string, unknown> = {
      merchant_id: merchant.id,
      title: newCoupon.title,
      amount: newCoupon.amount,
      min_spend: newCoupon.min_spend,
      expiry_days: newCoupon.expiry_days,
      is_global: newCoupon.is_global,
      target_type: newCoupon.target_type,
      stackable: newCoupon.stackable,
      status: 'active',
    }
    if (newCoupon.total_quantity !== null) insertData.total_quantity = newCoupon.total_quantity
    if (newCoupon.target_type === 'category') {
      insertData.target_category_id = newCoupon.target_category_id
      if (newCoupon.target_item_ids.length > 0) insertData.target_item_ids = newCoupon.target_item_ids
    }
    if (newCoupon.target_type === 'customer') insertData.target_customer_ids = newCoupon.target_customer_ids

    const { error } = await supabase.from('coupons').insert(insertData)
    if (error) alert(error.message)
    else {
      setShowForm(false)
      setNewCoupon({ title: '', amount: 5, min_spend: 30, expiry_days: 7, is_global: false, target_type: 'all', target_category_id: null, target_customer_ids: [], target_item_ids: [], stackable: false, total_quantity: null })
      loadData()
    }
  }

  async function toggleStatus(id: string, current: string) {
    await supabase.from('coupons').update({ status: current === 'active' ? 'disabled' : 'active' }).eq('id', id)
    loadData()
  }

  async function deleteCoupon(id: string) {
    const stats = couponStats[id] || { used: 0, pending: 0, expired: 0 }
    if (stats.pending > 0) {
      alert(`删除失败：当前还有 ${stats.pending} 张被客户领取但仍有效的优惠券！\n如果不想继续发放或使用，请先将该券设置「禁用/下架」。只有当所有领取的券都核销或过期后才能物理删除。`)
      return
    }
    if (!confirm('确定删除此优惠券？相关的过期/核销记录也将被物理清除，建议优先使用「禁用」功能隐藏它。')) return
    await supabase.from('coupons').delete().eq('id', id)
    loadData()
  }

  // 树形选择器：切换分类
  function toggleCategory(catId: string) {
    const itemsInCat = menuItems.filter(i => i.category_id === catId)
    const allSelected = itemsInCat.every(i => newCoupon.target_item_ids.includes(i.id))
    if (allSelected) {
      // 取消全选
      setNewCoupon({...newCoupon, target_item_ids: newCoupon.target_item_ids.filter(id => !itemsInCat.some(i => i.id === id))})
    } else {
      // 全选
      const ids = new Set([...newCoupon.target_item_ids, ...itemsInCat.map(i => i.id)])
      setNewCoupon({...newCoupon, target_item_ids: Array.from(ids)})
    }
  }

  function toggleItem(itemId: string) {
    const ids = newCoupon.target_item_ids.includes(itemId)
      ? newCoupon.target_item_ids.filter(id => id !== itemId)
      : [...newCoupon.target_item_ids, itemId]
    setNewCoupon({...newCoupon, target_item_ids: ids})
  }

  function getCatState(catId: string): 'none' | 'partial' | 'all' {
    const itemsInCat = menuItems.filter(i => i.category_id === catId)
    if (itemsInCat.length === 0) return 'none'
    const selected = itemsInCat.filter(i => newCoupon.target_item_ids.includes(i.id))
    if (selected.length === 0) return 'none'
    if (selected.length === itemsInCat.length) return 'all'
    return 'partial'
  }

  // 客户搜索过滤
  const filteredCustomers = custSearch
    ? customers.filter(c => c.name.includes(custSearch) || c.phone.includes(custSearch))
    : customers

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><span className="spinner" /></div>

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <header style={{
        background: 'white', padding: '14px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Link href="/dashboard"><ArrowLeft size={22} color="#1c1917" /></Link>
          <span style={{ fontWeight: '700', fontSize: '17px' }}>优惠券管理</span>
        </div>
        {!viewingCoupon ? (
          <button onClick={() => {
            setNewCoupon({ title: '', amount: 5, min_spend: 30, expiry_days: 7, is_global: false, target_type: 'all', target_category_id: null, target_customer_ids: [], target_item_ids: [], stackable: false, total_quantity: null });
            setShowForm(true);
          }} className="btn btn-primary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Plus size={14} /> 创建
          </button>
        ) : (
          <button onClick={() => setViewingCoupon(null)} className="btn btn-primary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Plus size={14} /> 返回列表
          </button>
        )}
      </header>

      <div style={{ padding: '16px 20px 100px' }}>
        {coupons.length === 0 ? (
          <div className="empty-state">
            <Tag />
            <p>暂无优惠券</p>
            <p style={{ fontSize: '13px', marginTop: '4px' }}>点击右上角创建您的第一张优惠券</p>
          </div>
        ) : coupons.map(c => (
          <div 
            key={c.id} 
            className="card" 
            style={{ marginBottom: '10px', padding: '14px', cursor: 'pointer' }}
            onClick={() => {
              setNewCoupon({
                title: c.title,
                amount: c.amount,
                min_spend: c.min_spend,
                expiry_days: c.expiry_days,
                is_global: c.is_global,
                target_type: c.target_type,
                target_category_id: c.target_category_id,
                target_customer_ids: c.target_customer_ids || [],
                target_item_ids: c.target_item_ids || [],
                stackable: c.stackable,
                total_quantity: c.total_quantity
              });
              setViewingCoupon(c);
              
              const initialExpanded = new Set<string>()
              if (c.target_category_id) initialExpanded.add(c.target_category_id)
              if (c.target_item_ids) {
                c.target_item_ids.forEach(itemId => {
                  const item = menuItems.find(i => i.id === itemId)
                  if (item) initialExpanded.add(item.category_id)
                })
              }
              setExpandedCats(initialExpanded)
              
              setShowForm(true);
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontWeight: '700', fontSize: '15px' }}>{c.title}</span>
                  <span style={{ fontSize: '18px', fontWeight: '800', color: '#f97316' }}>-¥{c.amount}</span>
                </div>
                <div style={{ fontSize: '12px', color: '#999', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {c.min_spend > 0 && <span>满¥{c.min_spend}可用</span>}
                  <span>有效{c.expiry_days}天</span>
                  {c.is_global && <span style={{ color: '#22c55e' }}>🆕 新客自动领</span>}
                  {c.stackable && <span style={{ color: '#8b5cf6' }}>🔗 可叠加</span>}
                  <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {c.target_type === 'category' && (
                      <span style={{ fontSize: '10px', background: '#eff6ff', color: '#3b82f6', padding: '1px 6px', borderRadius: '4px' }}>
                        <Tag size={9} style={{ verticalAlign: 'middle' }} /> 指定分类
                        {c.target_item_ids?.length > 0 && ` + ${c.target_item_ids.length}个菜品`}
                      </span>
                    )}
                    {c.target_type === 'customer' && (
                      <span style={{ fontSize: '10px', background: '#faf5ff', color: '#8b5cf6', padding: '1px 6px', borderRadius: '4px' }}>
                        <Users size={9} style={{ verticalAlign: 'middle' }} /> 指定用户 ({c.target_customer_ids?.length || 0}人)
                      </span>
                    )}
                  </div>
                  {/* 商家端统计数据小仪表面板 */}
                  <div style={{ marginTop: '12px', background: '#f5f5f4', padding: '10px 14px', borderRadius: '8px', display: 'flex', gap: '24px', fontSize: '12px', width: 'fit-content' }}>
                    <div>
                      <div style={{ color: '#78716c', marginBottom: '4px', fontSize: '11px' }}>发行量</div>
                      <div style={{ fontWeight: '700', fontSize: '14px', color: '#1c1917' }}>{c.total_quantity || '不限量'}</div>
                    </div>
                    <div>
                      <div style={{ color: '#78716c', marginBottom: '4px', fontSize: '11px' }}>待使用</div>
                      <div style={{ fontWeight: '700', fontSize: '14px', color: '#3b82f6' }}>{couponStats[c.id]?.pending || 0}</div>
                    </div>
                    <div>
                      <div style={{ color: '#78716c', marginBottom: '4px', fontSize: '11px' }}>已使用</div>
                      <div style={{ fontWeight: '700', fontSize: '14px', color: '#10b981' }}>{couponStats[c.id]?.used || 0}</div>
                    </div>
                    <div>
                      <div style={{ color: '#78716c', marginBottom: '4px', fontSize: '11px' }}>已过期</div>
                      <div style={{ fontWeight: '700', fontSize: '14px', color: '#9ca3af' }}>{couponStats[c.id]?.expired || 0}</div>
                    </div>
                    {(c.claimed_count || 0) > 0 && (
                      <div>
                        <div style={{ color: '#78716c', marginBottom: '4px', fontSize: '11px' }}>领取转化率</div>
                        <div style={{ fontWeight: '700', fontSize: '14px', color: '#6366f1' }}>{(((couponStats[c.id]?.used || 0) / c.claimed_count) * 100).toFixed(1)}%</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button onClick={(e) => { e.stopPropagation(); toggleStatus(c.id, c.status); }} style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px',
                  color: c.status === 'active' ? '#10b981' : '#a8a29e'
                }}>
                  {c.status === 'active' ? '✅ 生效' : '⏸ 禁用'}
                </button>
                <button onClick={(e) => { e.stopPropagation(); deleteCoupon(c.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '12px' }}>
                  删除
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 创建/详情 优惠券弹窗 */}
      {showForm && (
        <>
          <div className="overlay" onClick={() => { setShowForm(false); setViewingCoupon(null); }} />
          <div className="dialog" style={{ maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontWeight: '700' }}>{viewingCoupon ? '优惠券详情 (只读)' : '创建优惠券'}</h3>
              <button onClick={() => { setShowForm(false); setViewingCoupon(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
            </div>
            <fieldset disabled={!!viewingCoupon} style={{ border: 'none', padding: 0, margin: 0, opacity: viewingCoupon ? 0.9 : 1 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* 基础信息 */}
              <div>
                <label style={{ fontSize: '12px', color: '#666', marginBottom: '4px', display: 'block' }}>优惠券名称</label>
                <input className="input" placeholder="例：新客立减券" value={newCoupon.title} onChange={e => setNewCoupon({...newCoupon, title: e.target.value})} />
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', color: '#666', marginBottom: '4px', display: 'block' }}>面额 (元)</label>
                  <input className="input" type="number" value={newCoupon.amount} onChange={e => setNewCoupon({...newCoupon, amount: Number(e.target.value)})} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', color: '#666', marginBottom: '4px', display: 'block' }}>门槛 (元)</label>
                  <input className="input" type="number" value={newCoupon.min_spend} onChange={e => setNewCoupon({...newCoupon, min_spend: Number(e.target.value)})} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', color: '#666', marginBottom: '4px', display: 'block' }}>有效期 (天)</label>
                  <input className="input" type="number" value={newCoupon.expiry_days} onChange={e => setNewCoupon({...newCoupon, expiry_days: Number(e.target.value)})} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', color: '#666', marginBottom: '4px', display: 'block' }}>限量 (张)</label>
                  <input className="input" type="number" placeholder="不填=不限量" value={newCoupon.total_quantity ?? ''} onChange={e => setNewCoupon({...newCoupon, total_quantity: e.target.value ? Number(e.target.value) : null})} />
                </div>
              </div>

              {/* 开关区 */}
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
                  <input type="checkbox" checked={newCoupon.is_global} onChange={e => setNewCoupon({...newCoupon, is_global: e.target.checked})} />
                  新客自动领券
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
                  <input type="checkbox" checked={newCoupon.stackable} onChange={e => setNewCoupon({...newCoupon, stackable: e.target.checked})} />
                  可叠加使用
                </label>
              </div>

              {/* 定向类型 */}
              <div>
                <label style={{ fontSize: '12px', color: '#666', marginBottom: '6px', display: 'block' }}>适用范围</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {([['all', '全场通用'], ['category', '指定分类/菜品'], ['customer', '指定用户']] as const).map(([type, label]) => (
                    <button
                      key={type}
                      onClick={() => setNewCoupon({...newCoupon, target_type: type})}
                      style={{
                        flex: 1, padding: '8px', border: '1px solid', fontSize: '12px', borderRadius: '8px', cursor: 'pointer',
                        borderColor: newCoupon.target_type === type ? '#f97316' : '#e5e5e5',
                        background: newCoupon.target_type === type ? '#fff7ed' : 'white',
                        color: newCoupon.target_type === type ? '#f97316' : '#666',
                        fontWeight: newCoupon.target_type === type ? '600' : '400',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 树形分类/菜品选择器 */}
              {newCoupon.target_type === 'category' && (
                <div>
                  <label style={{ fontSize: '12px', color: '#666', marginBottom: '4px', display: 'block' }}>选择分类和菜品</label>
                  <div style={{ border: '1px solid #e5e5e5', borderRadius: '8px', maxHeight: '250px', overflowY: 'auto' }}>
                    {categories.map(cat => {
                      const catState = getCatState(cat.id)
                      const isExpanded = expandedCats.has(cat.id)
                      const itemsInCat = menuItems.filter(i => i.category_id === cat.id)
                      return (
                        <div key={cat.id}>
                          <div
                            style={{
                              display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px',
                              borderBottom: '1px solid #f5f5f4', cursor: 'pointer',
                              background: catState !== 'none' ? '#fff7ed' : 'white',
                            }}
                          >
                            <input
                              type="checkbox"
                              ref={(el) => { if (el) el.indeterminate = catState === 'partial' }}
                              checked={catState === 'all'}
                              onChange={() => { if (!viewingCoupon) toggleCategory(cat.id); }}
                              style={{ cursor: 'pointer' }}
                            />
                            <div
                              style={{ flex: 1, fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                              onClick={() => {
                                const next = new Set(expandedCats)
                                if (isExpanded) { next.delete(cat.id) } else { next.add(cat.id) }
                                setExpandedCats(next)
                              }}
                            >
                              <span>{cat.name}</span>
                              <ChevronRight size={14} color="#999" style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: '0.2s' }} />
                            </div>
                          </div>
                          {isExpanded && itemsInCat.map(item => (
                            <label
                              key={item.id}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px 8px 36px',
                                borderBottom: '1px solid #fafafa', cursor: 'pointer', fontSize: '13px',
                                background: newCoupon.target_item_ids.includes(item.id) ? '#fffbeb' : 'white',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={newCoupon.target_item_ids.includes(item.id)}
                                onChange={() => { if (!viewingCoupon) toggleItem(item.id); }}
                              />
                              <span>{item.name}</span>
                              <span style={{ color: '#aaa', fontSize: '11px', marginLeft: 'auto' }}>¥{item.price}</span>
                            </label>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                  {newCoupon.target_item_ids.length > 0 && (
                    <p style={{ fontSize: '11px', color: '#f97316', marginTop: '4px' }}>已选 {newCoupon.target_item_ids.length} 个菜品</p>
                  )}
                </div>
              )}

              {/* 指定用户 + 模糊搜索 */}
              {newCoupon.target_type === 'customer' && (
                <div>
                  <label style={{ fontSize: '12px', color: '#666', marginBottom: '4px', display: 'block' }}>搜索客户</label>
                  <div style={{ position: 'relative', marginBottom: '8px' }}>
                    <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#999' }} />
                    <input
                      className="input"
                      placeholder="输入手机号或称呼搜索..."
                      value={custSearch}
                      onChange={e => setCustSearch(e.target.value)}
                      style={{ paddingLeft: '32px' }}
                    />
                  </div>
                  {/* 已选标签 */}
                  {newCoupon.target_customer_ids.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                      {newCoupon.target_customer_ids.map(id => {
                        const c = customers.find(cu => cu.id === id)
                        return c ? (
                          <span key={id} style={{
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                            background: '#fff7ed', color: '#f97316', padding: '3px 8px', borderRadius: '12px', fontSize: '12px',
                          }}>
                            {c.name}
                            {!viewingCoupon && <X size={12} style={{ cursor: 'pointer' }} onClick={() => setNewCoupon({...newCoupon, target_customer_ids: newCoupon.target_customer_ids.filter(x => x !== id)})} />}
                          </span>
                        ) : null
                      })}
                    </div>
                  )}
                  <div style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid #e5e5e5', borderRadius: '8px', padding: '4px' }}>
                    {filteredCustomers.length === 0 ? (
                      <p style={{ fontSize: '12px', color: '#999', textAlign: 'center', padding: '10px' }}>
                        {custSearch ? '未找到匹配客户' : '暂无客户'}
                      </p>
                    ) : filteredCustomers.map(cust => (
                      <label key={cust.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', cursor: 'pointer', borderRadius: '6px', fontSize: '13px' }}>
                          <input
                            type="checkbox"
                            checked={newCoupon.target_customer_ids.includes(cust.id)}
                            onChange={e => {
                              if (viewingCoupon) return;
                              const ids = e.target.checked
                                ? [...newCoupon.target_customer_ids, cust.id]
                                : newCoupon.target_customer_ids.filter(id => id !== cust.id)
                              setNewCoupon({...newCoupon, target_customer_ids: ids})
                            }}
                          />
                        <span>{cust.name}</span>
                        <span style={{ color: '#aaa', fontSize: '11px' }}>{cust.phone}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            </fieldset>
            {viewingCoupon ? (
              <button onClick={() => { setShowForm(false); setViewingCoupon(null); }} className="btn btn-block" style={{ marginTop: '20px', background: '#f5f5f4', color: '#444' }}>关闭</button>
            ) : (
              <button onClick={addCoupon} className="btn btn-primary btn-block" style={{ marginTop: '16px' }}>立即创建</button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
