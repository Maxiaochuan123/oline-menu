import { expect, test } from '@playwright/test'

import {
  createCouponAsMerchant,
  createMerchantAccount,
  getCouponByIdAsMerchant,
  getLatestCouponByTitleAsMerchant,
} from './helpers/supabase'

async function loginAsMerchant(page: import('@playwright/test').Page, phone: string, password: string) {
  await page.goto('/login')
  await page.locator('input[type="tel"]').fill(phone)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('form button[type="submit"]').click()
  await page.waitForURL(/\/dashboard$/)
}

async function openCouponsPage(page: import('@playwright/test').Page) {
  await page.goto('/coupons', { waitUntil: 'networkidle' })

  // 视为“页面就绪”的两个条件：顶部标题渲染，且空态按钮或列表卡片出现任一。
  const readySelector = '[data-testid="coupon-open-create"], [data-testid^="coupon-card-"]'

  await Promise.all([
    page.getByRole('heading', { name: /优惠券/ }).waitFor({ state: 'visible', timeout: 20_000 }),
    page.waitForSelector(readySelector, { timeout: 25_000 }),
  ])
}

test.describe('coupon management', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(60_000)

  test('merchant can create a universal coupon from the coupons page', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const couponTitle = `E2E通用券${Date.now().toString().slice(-6)}`

    await loginAsMerchant(page, phone, password)
    await openCouponsPage(page)

    await page.getByTestId('coupon-open-create').click()
    await expect(page.getByTestId('coupon-form-dialog')).toBeVisible()

    await page.locator('input[name="title"]').fill(couponTitle)
    await page.getByTestId('coupon-amount-input').fill('8')
    await page.getByTestId('coupon-min-spend-input').fill('30')
    await page.locator('input[name="expiry_days"]').fill('9')
    await page.getByRole('button', { name: '确认发行' }).click()

    await expect.poll(async () => {
      const coupon = await getLatestCouponByTitleAsMerchant({
        merchantId: merchant.id,
        title: couponTitle,
        merchantPhone: phone,
        merchantPassword: password,
      })
      return JSON.stringify({
        title: coupon.title,
        amount: coupon.amount,
        minSpend: coupon.min_spend,
        status: coupon.status,
      })
    }, { timeout: 10_000 }).toBe(JSON.stringify({
      title: couponTitle,
      amount: 8,
      minSpend: 30,
      status: 'active',
    }))
  })

  test('merchant can disable a coupon from the list', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const coupon = await createCouponAsMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      title: `E2E状态券${Date.now().toString().slice(-6)}`,
      amount: 6,
      minSpend: 20,
    })

    await loginAsMerchant(page, phone, password)
    await openCouponsPage(page)

    await expect(page.getByTestId(`coupon-card-${coupon.id}`)).toBeVisible({ timeout: 15_000 })
    const toggle = page.getByTestId(`coupon-toggle-${coupon.id}`)
    await expect(toggle).toBeVisible({ timeout: 15_000 })

    await toggle.click()
    await expect.poll(async () => {
      const latestCoupon = await getCouponByIdAsMerchant({
        couponId: coupon.id,
        merchantPhone: phone,
        merchantPassword: password,
      })
      return latestCoupon.status
    }, { timeout: 10_000 }).toBe('disabled')
  })

})
