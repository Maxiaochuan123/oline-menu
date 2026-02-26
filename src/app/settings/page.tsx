'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Merchant, DisabledDate } from '@/lib/types'
import { ArrowLeft, Upload, Trash2, Calendar, Plus, X, Power, PowerOff } from 'lucide-react'
import Link from 'next/link'

export default function SettingsPage() {
  const supabase = createClient()
  const router = useRouter()
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [disabledDates, setDisabledDates] = useState<DisabledDate[]>([])
  const [shopName, setShopName] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [isAccepting, setIsAccepting] = useState(true)
  const [newDate, setNewDate] = useState('')
  const [newReason, setNewReason] = useState('')
  const [showDateForm, setShowDateForm] = useState(false)
  const [wechatFile, setWechatFile] = useState<File | null>(null)
  const [alipayFile, setAlipayFile] = useState<File | null>(null)
  const [wechatPreview, setWechatPreview] = useState<string | null>(null)
  const [alipayPreview, setAlipayPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: m } = await supabase.from('merchants').select('*').eq('user_id', user.id).single()
    if (!m) return
    setMerchant(m)
    setShopName(m.shop_name)
    setAnnouncement(m.announcement || '')
    setIsAccepting(m.is_accepting_orders)
    // 初始化收款码预览（已有URL）
    if (m.payment_qr_urls?.wechat) setWechatPreview(m.payment_qr_urls.wechat)
    if (m.payment_qr_urls?.alipay) setAlipayPreview(m.payment_qr_urls.alipay)

    const { data: dates } = await supabase.from('disabled_dates').select('*').eq('merchant_id', m.id).order('disabled_date')
    setDisabledDates(dates || [])
    setLoading(false)
  }, [supabase, router])

  useEffect(() => { loadData() }, [loadData])

  async function uploadQr(file: File, merchant: Merchant, label: string): Promise<string | null> {
    const ext = file.name.split('.').pop() || 'jpg'
    const fileName = `${merchant.id}/qr_${label}_${Date.now()}.${ext}`
    const { data: uploadData } = await supabase.storage.from('menu-images').upload(fileName, file)
    if (uploadData) {
      const { data: urlData } = supabase.storage.from('menu-images').getPublicUrl(uploadData.path)
      return urlData.publicUrl
    }
    return null
  }

  async function saveSettings() {
    if (!merchant) return
    setSaving(true)

    const currentUrls = merchant.payment_qr_urls || {}
    let wechatUrl = currentUrls.wechat || null
    let alipayUrl = currentUrls.alipay || null

    if (wechatFile) {
      const url = await uploadQr(wechatFile, merchant, 'wechat')
      if (url) wechatUrl = url
    }
    if (alipayFile) {
      const url = await uploadQr(alipayFile, merchant, 'alipay')
      if (url) alipayUrl = url
    }

    await supabase.from('merchants').update({
      shop_name: shopName,
      announcement,
      is_accepting_orders: isAccepting,
      payment_qr_urls: { wechat: wechatUrl, alipay: alipayUrl },
    }).eq('id', merchant.id)

    setSaving(false)
    alert('保存成功！')
    loadData()
  }

  async function addDisabledDate() {
    if (!merchant || !newDate) return
    await supabase.from('disabled_dates').insert({
      merchant_id: merchant.id,
      disabled_date: newDate,
      reason: newReason || null,
    })
    setNewDate('')
    setNewReason('')
    setShowDateForm(false)
    loadData()
  }

  async function removeDisabledDate(id: string) {
    await supabase.from('disabled_dates').delete().eq('id', id)
    loadData()
  }

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><span className="spinner" /></div>
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <header style={{
        background: 'white', padding: '14px 20px',
        display: 'flex', alignItems: 'center', gap: '10px',
        borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <Link href="/dashboard"><ArrowLeft size={22} color="#1c1917" /></Link>
        <span style={{ fontWeight: '700', fontSize: '17px' }}>店铺设置</span>
      </header>

      <div style={{ padding: '16px 20px 100px' }}>
        {/* 基本信息 */}
        <div className="card" style={{ marginBottom: '16px' }}>
          <h3 style={{ fontWeight: '700', fontSize: '15px', marginBottom: '12px' }}>基本信息</h3>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '13px', fontWeight: '600', marginBottom: '4px', display: 'block' }}>店铺名称</label>
            <input className="input" value={shopName} onChange={e => setShopName(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: '13px', fontWeight: '600', marginBottom: '4px', display: 'block' }}>公告内容</label>
            <textarea className="input" rows={3} placeholder="不接单时向客户展示的公告..." value={announcement} onChange={e => setAnnouncement(e.target.value)}
              style={{ resize: 'vertical' }} />
          </div>
        </div>

        {/* 接单控制 */}
        <div className="card" style={{ marginBottom: '16px' }}>
          <h3 style={{ fontWeight: '700', fontSize: '15px', marginBottom: '12px' }}>接单控制</h3>
          <button
            onClick={() => setIsAccepting(!isAccepting)}
            className={`btn btn-block ${isAccepting ? 'btn-primary' : 'btn-danger'}`}
            style={{ height: '48px', fontSize: '15px' }}
          >
            {isAccepting ? <><Power size={18} /> 正在接单</> : <><PowerOff size={18} /> 暂停接单</>}
          </button>
        </div>

        {/* 收款码 */}
        <div className="card" style={{ marginBottom: '16px' }}>
          <h3 style={{ fontWeight: '700', fontSize: '15px', marginBottom: '16px' }}>收款码</h3>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {/* 微信 */}
            <div style={{ flex: '1', minWidth: '140px', maxWidth: '200px', textAlign: 'center' }}>
              <div style={{
                width: '100%', paddingBottom: '100%', position: 'relative',
                background: '#f5f5f4', borderRadius: '12px', overflow: 'hidden',
                border: '2px dashed #d1fae5', marginBottom: '8px',
              }}>
                {wechatPreview
                  ? <img src={wechatPreview} alt="微信收款码" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', padding: '8px' }} />
                  : <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#a8a29e' }}>
                      <Upload size={24} style={{ marginBottom: '4px' }} />
                      <span style={{ fontSize: '12px' }}>点击上传</span>
                    </div>
                }
              </div>
              <label style={{
                display: 'block', cursor: 'pointer',
                background: '#f0fdf4', border: '1px solid #bbf7d0',
                borderRadius: '8px', padding: '6px 10px',
                fontSize: '13px', fontWeight: '600', color: '#15803d',
              }}>
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
                  const f = e.target.files?.[0] || null
                  setWechatFile(f)
                  if (f) setWechatPreview(URL.createObjectURL(f))
                }} />
                <Upload size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                微信收款码
              </label>
            </div>

            {/* 支付宝 */}
            <div style={{ flex: '1', minWidth: '140px', maxWidth: '200px', textAlign: 'center' }}>
              <div style={{
                width: '100%', paddingBottom: '100%', position: 'relative',
                background: '#f5f5f4', borderRadius: '12px', overflow: 'hidden',
                border: '2px dashed #bae6fd', marginBottom: '8px',
              }}>
                {alipayPreview
                  ? <img src={alipayPreview} alt="支付宝收款码" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', padding: '8px' }} />
                  : <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#a8a29e' }}>
                      <Upload size={24} style={{ marginBottom: '4px' }} />
                      <span style={{ fontSize: '12px' }}>点击上传</span>
                    </div>
                }
              </div>
              <label style={{
                display: 'block', cursor: 'pointer',
                background: '#eff6ff', border: '1px solid #bfdbfe',
                borderRadius: '8px', padding: '6px 10px',
                fontSize: '13px', fontWeight: '600', color: '#1d4ed8',
              }}>
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
                  const f = e.target.files?.[0] || null
                  setAlipayFile(f)
                  if (f) setAlipayPreview(URL.createObjectURL(f))
                }} />
                <Upload size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                支付宝收款码
              </label>
            </div>
          </div>
        </div>

        {/* 禁用日期 */}
        <div className="card" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ fontWeight: '700', fontSize: '15px' }}>不接单日期</h3>
            <button onClick={() => setShowDateForm(true)} style={{ background: 'none', border: 'none', color: '#f97316', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
              <Plus size={14} style={{ verticalAlign: 'middle' }} /> 添加
            </button>
          </div>
          {disabledDates.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>暂无禁用日期</p>
          ) : (
            disabledDates.map(d => (
              <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f5f5f4' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Calendar size={14} color="#f97316" />
                  <span style={{ fontSize: '14px' }}>{d.disabled_date}</span>
                  {d.reason && <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>({d.reason})</span>}
                </div>
                <button onClick={() => removeDisabledDate(d.id)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                  <Trash2 size={14} color="#ef4444" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* 保存按钮 */}
        <button onClick={saveSettings} className="btn btn-primary btn-block" disabled={saving} style={{ height: '48px', fontSize: '15px' }}>
          {saving ? <span className="spinner" /> : '保存设置'}
        </button>
      </div>

      {/* 添加禁用日期弹窗 */}
      {showDateForm && (
        <>
          <div className="overlay" onClick={() => setShowDateForm(false)} />
          <div className="dialog">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontWeight: '700' }}>添加不接单日期</h3>
              <button onClick={() => setShowDateForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input className="input" type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
              <input className="input" placeholder="原因（可选）" value={newReason} onChange={e => setNewReason(e.target.value)} />
            </div>
            <button onClick={addDisabledDate} className="btn btn-primary btn-block" style={{ marginTop: '16px' }}>添加</button>
          </div>
        </>
      )}
    </div>
  )
}
