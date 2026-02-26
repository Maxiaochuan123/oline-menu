'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Merchant, Customer } from '@/lib/types'
import { formatPrice } from '@/lib/utils'
import { ArrowLeft, Search, Trophy, Phone, MapPin, ShoppingBag } from 'lucide-react'
import Link from 'next/link'

export default function CustomersPage() {
  const supabase = createClient()
  const router = useRouter()
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: m } = await supabase.from('merchants').select('*').eq('user_id', user.id).single()
    if (!m) return
    setMerchant(m)
    const { data: c } = await supabase.from('customers').select('*').eq('merchant_id', m.id).order('points', { ascending: false })
    setCustomers(c || [])
    setLoading(false)
  }, [supabase, router])

  useEffect(() => { loadData() }, [loadData])

  const filtered = customers.filter(c =>
    c.name.includes(search) || c.phone.includes(search)
  )

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><span className="spinner" /></div>
  }

  const rankColors = ['#f59e0b', '#9ca3af', '#b45309']

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <header style={{
        background: 'white', padding: '14px 20px',
        display: 'flex', alignItems: 'center', gap: '10px',
        borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <Link href="/dashboard"><ArrowLeft size={22} color="#1c1917" /></Link>
        <span style={{ fontWeight: '700', fontSize: '17px' }}>客户管理</span>
        <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>({customers.length})</span>
      </header>

      {/* 搜索 */}
      <div style={{ padding: '12px 20px' }}>
        <div style={{ position: 'relative' }}>
          <Search size={16} color="#a8a29e" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
          <input className="input" placeholder="搜索客户名称或手机号" value={search} onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: '36px' }} />
        </div>
      </div>

      {/* 积分排行 */}
      <div style={{ padding: '0 20px 100px' }}>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <Trophy />
            <p>暂无客户</p>
            <p style={{ fontSize: '13px', marginTop: '4px' }}>客户下单后会自动出现在这里</p>
          </div>
        ) : (
          filtered.map((customer, idx) => (
            <div key={customer.id} className="card animate-fade-in" style={{ marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {/* 排名 */}
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%',
                  background: idx < 3 ? rankColors[idx] : '#e7e5e4',
                  color: idx < 3 ? 'white' : '#78716c',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: '700', fontSize: '14px', flexShrink: 0,
                }}>
                  {idx < 3 ? <Trophy size={16} /> : idx + 1}
                </div>
                {/* 信息 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: '600', fontSize: '15px' }}>{customer.name}</div>
                  <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                      <Phone size={11} /> {customer.phone}
                    </span>
                    {customer.address && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <MapPin size={11} /> {customer.address}
                      </span>
                    )}
                  </div>
                </div>
                {/* 统计 */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontWeight: '700', color: '#f97316', fontSize: '16px' }}>
                    {customer.points} 分
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>
                    <ShoppingBag size={10} /> {customer.order_count}单 · {formatPrice(Number(customer.total_spent))}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
