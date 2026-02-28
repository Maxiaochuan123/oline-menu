'use client'

import { useState, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { UtensilsCrossed, Gift, Phone } from 'lucide-react'
import { isValidPhone } from '@/lib/utils'

// ── 客户快速登记表单（从点餐页跳来） ──────────────────────────
function CustomerLoginForm({ merchantId, redirectTo }: { merchantId: string; redirectTo: string }) {
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValidPhone(phone)) {
      alert('请输入有效的手机号（1开头，11位数字）')
      return
    }
    setLoading(true)

    try {
      // 查找或创建客户记录
      const { data: existing } = await supabase
        .from('customers')
        .select('id, points')
        .eq('merchant_id', merchantId)
        .eq('phone', phone)
        .maybeSingle()

      let customerId = existing?.id

      if (!existing) {
        // 新客户：创建记录
        const { data: newCust, error: insertErr } = await supabase
          .from('customers')
          .insert({ merchant_id: merchantId, phone })
          .select('id')
          .single()
        if (insertErr) throw insertErr
        customerId = newCust.id

        // 【修正】新客发放所有已激活的全局全员券 (is_global=true)
        const { data: globalCoupons, error: fetchErr } = await supabase
          .from('coupons')
          .select('id, expiry_days, total_quantity, claimed_count, title')
          .eq('merchant_id', merchantId)
          .eq('is_global', true)
          .eq('status', 'active')
          
        if (fetchErr) {
          console.error("fetch global coupons error:", fetchErr)
        }

        if (globalCoupons && globalCoupons.length > 0 && customerId) {
          const now = new Date()
          let claimedCount = 0
          const claimedNames: string[] = []
          let lastRpcError = null
          
          for (const coupon of globalCoupons) {
            const expiresAt = new Date(now)
            expiresAt.setDate(expiresAt.getDate() + (coupon.expiry_days ?? 7))
            
            // 调用安全领券 RPC，防止突破总发放量
            const { data: success, error: rpcErr } = await supabase.rpc('claim_coupon', {
              p_coupon_id: coupon.id,
              p_customer_id: customerId,
              p_expires_at: expiresAt.toISOString()
            })
            
            if (rpcErr) lastRpcError = rpcErr
            if (success) {
              claimedCount++
              claimedNames.push(coupon.title)
            }
          }
          
          if (claimedCount > 0) {
            window.alert(`欢迎新朋友！已为您自动发放新人专属优惠券：\n${claimedNames.join('、')}`)
          } else if (lastRpcError) {
            console.error("Claim coupon rpc error: ", lastRpcError)
          }
        }
        // no-op for existing customer
      }

      // 保存到本地，点餐页自动带出
      localStorage.setItem(
        `customer_info_${merchantId}`,
        JSON.stringify({ phone, address: '' })
      )

      router.push(redirectTo)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 50%, #fed7aa 100%)',
      padding: '16px',
    }}>
      <div className="animate-slide-up" style={{
        width: '100%', maxWidth: '400px', background: 'white',
        borderRadius: '20px', padding: '40px 32px',
        boxShadow: '0 20px 60px rgba(249, 115, 22, 0.12)',
      }}>
        {/* 顶部礼物图标 */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '64px', height: '64px',
            background: 'linear-gradient(135deg, #f97316, #ea580c)',
            borderRadius: '16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <Gift size={32} color="white" />
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1c1917' }}>领取专属优惠</h1>
          <p style={{ color: '#78716c', fontSize: '14px', marginTop: '6px' }}>
            登记即领 <strong style={{ color: '#f97316' }}>5 元立减券</strong>，下单直接抵扣
          </p>
        </div>

        <form onSubmit={handleSubmit}>


          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: '#44403c' }}>
              <Phone size={14} /> 手机号
            </label>
            <input
              className="input"
              type="tel"
              placeholder="11 位手机号"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
              required
              maxLength={11}
            />
            {phone.length > 0 && !isValidPhone(phone) && (
              <p style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>请输入有效的手机号</p>
            )}
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={loading}
            style={{ height: '48px', fontSize: '16px', borderRadius: '24px' }}
          >
            {loading ? <span className="spinner" /> : '确认领券并返回点餐 🎁'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: '12px', color: '#aaa', marginTop: '16px' }}>
          仅用于积分和优惠券管理，不会泄露您的信息
        </p>
      </div>
    </div>
  )
}

// ── 商家登录/注册表单 ──────────────────────────────────────────
function MerchantLoginForm({ redirectTo }: { redirectTo: string }) {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [isRegister, setIsRegister] = useState(false)
  const [shopName, setShopName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValidPhone(phone)) {
      setError('请输入有效的手机号（1开头，11位数字）')
      return
    }
    setLoading(true)
    setError('')

    const virtualEmail = `${phone}@merchant.app`

    try {
      if (isRegister) {
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: virtualEmail,
          password,
        })
        if (authError) throw authError

        if (authData.user) {
          const { error: merchantError } = await supabase.from('merchants').insert({
            user_id: authData.user.id,
            email: phone,
            shop_name: shopName || '我的小店',
          })
          if (merchantError) throw merchantError
        }
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: virtualEmail,
          password,
        })
        if (authError) throw authError
      }

      router.push(redirectTo)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 50%, #fed7aa 100%)',
      padding: '16px',
    }}>
      <div className="animate-slide-up" style={{
        width: '100%', maxWidth: '400px', background: 'white',
        borderRadius: '20px', padding: '40px 32px',
        boxShadow: '0 20px 60px rgba(249, 115, 22, 0.12)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '64px', height: '64px',
            background: 'linear-gradient(135deg, #f97316, #ea580c)',
            borderRadius: '16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <UtensilsCrossed size={32} color="white" />
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#1c1917' }}>在线点餐系统</h1>
          <p style={{ color: '#78716c', fontSize: '14px', marginTop: '4px' }}>
            {isRegister ? '创建商家账号' : '商家登录'}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {isRegister && (
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#44403c' }}>店铺名称</label>
              <input className="input" type="text" placeholder="例：王姐家常菜" value={shopName} onChange={(e) => setShopName(e.target.value)} required />
            </div>
          )}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#44403c' }}>手机号</label>
            <input className="input" type="tel" placeholder="请输入手机号" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))} required maxLength={11} />
            {phone.length > 0 && !isValidPhone(phone) && (
              <p style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>请输入有效的手机号</p>
            )}
          </div>
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#44403c' }}>密码</label>
            <input className="input" type="password" placeholder="至少 6 位" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>

          {error && (
            <div style={{ background: '#fef2f2', color: '#dc2626', padding: '10px 14px', borderRadius: '10px', fontSize: '13px', marginBottom: '16px' }}>
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-block" disabled={loading} style={{ height: '44px', fontSize: '15px' }}>
            {loading ? <span className="spinner" /> : (isRegister ? '注册' : '登录')}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <button onClick={() => { setIsRegister(!isRegister); setError('') }}
            style={{ background: 'none', border: 'none', color: '#f97316', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}>
            {isRegister ? '已有账号？去登录' : '没有账号？注册'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 主路由：根据 redirect 参数区分客户 / 商家 ─────────────────
function LoginRouter() {
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect') || '/dashboard'

  // redirect 以 /m/ 开头 → 客户登记流程
  const isCustomerFlow = redirectTo.startsWith('/m/')
  const merchantId = isCustomerFlow ? redirectTo.split('/')[2] : null

  if (isCustomerFlow && merchantId) {
    return <CustomerLoginForm merchantId={merchantId} redirectTo={redirectTo} />
  }

  return <MerchantLoginForm redirectTo={redirectTo} />
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <span className="spinner" />
      </div>
    }>
      <LoginRouter />
    </Suspense>
  )
}
