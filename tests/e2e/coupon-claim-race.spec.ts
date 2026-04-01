import { expect, test } from '@playwright/test'

import {
  createCouponAsMerchant,
  createCustomerForMerchant,
  createMerchantAccount,
  createTestClient,
  getCouponByIdAsMerchant,
  getUserCouponsByCustomer,
} from './helpers/supabase'

const EXPIRES_AT = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

async function claimCouponOnce(couponId: string, customerId: string) {
  const client = createTestClient()
  const { data, error } = await client.rpc('claim_coupon', {
    p_coupon_id: couponId,
    p_customer_id: customerId,
    p_expires_at: EXPIRES_AT,
  })

  if (error) {
    throw new Error(`claim coupon rpc failed: ${error.message}`)
  }

  return data
}

test.describe('coupon claim race conditions', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(60_000)

  test('same customer cannot receive the same coupon twice under concurrent claims', async () => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const customer = await createCustomerForMerchant({
      merchantId: merchant.id,
      name: '并发重复领券客户',
    })
    const coupon = await createCouponAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      title: 'E2E 并发重复领券',
      amount: 8,
      totalQuantity: 5,
    })

    const results = await Promise.all([
      claimCouponOnce(coupon.id, customer.id),
      claimCouponOnce(coupon.id, customer.id),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)

    await expect
      .poll(async () => {
        const userCoupons = await getUserCouponsByCustomer(customer.id)
        return userCoupons.filter((item) => item.coupon_id === coupon.id).length
      })
      .toBe(1)

    await expect
      .poll(async () => {
        const latestCoupon = await getCouponByIdAsMerchant({
          couponId: coupon.id,
          merchantPhone,
          merchantPassword,
        })

        return (latestCoupon as typeof latestCoupon & { claimed_count?: number }).claimed_count ?? 0
      })
      .toBe(1)
  })

  test('only one customer can claim the last coupon under concurrent claims', async () => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const firstCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      name: '并发抢最后一张客户A',
    })
    const secondCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      name: '并发抢最后一张客户B',
    })
    const coupon = await createCouponAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      title: 'E2E 最后一张券并发抢',
      amount: 10,
      totalQuantity: 1,
    })

    const results = await Promise.all([
      claimCouponOnce(coupon.id, firstCustomer.id),
      claimCouponOnce(coupon.id, secondCustomer.id),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)

    await expect
      .poll(async () => {
        const firstCount = (await getUserCouponsByCustomer(firstCustomer.id)).filter((item) => item.coupon_id === coupon.id).length
        const secondCount = (await getUserCouponsByCustomer(secondCustomer.id)).filter((item) => item.coupon_id === coupon.id).length
        return firstCount + secondCount
      })
      .toBe(1)

    await expect
      .poll(async () => {
        const latestCoupon = await getCouponByIdAsMerchant({
          couponId: coupon.id,
          merchantPhone,
          merchantPassword,
        })

        return (latestCoupon as typeof latestCoupon & { claimed_count?: number }).claimed_count ?? 0
      })
      .toBe(1)
  })
})
