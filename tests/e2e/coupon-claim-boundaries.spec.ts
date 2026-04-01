import { expect, test } from '@playwright/test'

import {
  claimCouponForCustomer,
  createCouponAsMerchant,
  createCustomerForMerchant,
  createMenuItemForMerchant,
  createMerchantAccount,
  getUserCouponsByCustomer,
  updateCouponAsMerchant,
} from './helpers/supabase'

const POLL_TIMEOUT_MS = 20_000

async function openMenu(page: import('@playwright/test').Page, merchantId: string, itemId: string) {
  const itemLocator = page.getByTestId(`menu-item-${itemId}`)

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto(`/m/${merchantId}`, { waitUntil: 'networkidle' })
    if ((await itemLocator.count()) > 0) {
      await expect(itemLocator).toBeVisible({ timeout: POLL_TIMEOUT_MS })
      return
    }
    await page.waitForTimeout(2_000 * (attempt + 1))
  }

  await expect(itemLocator).toBeVisible({ timeout: POLL_TIMEOUT_MS })
}

async function openCouponCenter(page: import('@playwright/test').Page) {
  await page.getByText('领券中心').first().click()
  await expect(page.getByRole('heading', { name: '领券中心' })).toBeVisible()
}

async function loginForClaim(page: import('@playwright/test').Page, phone: string) {
  await page.getByRole('button', { name: '抢券' }).click()
  await expect(page.getByTestId('login-phone-input')).toBeVisible()
  await page.getByTestId('login-phone-input').fill(phone)
  await page.getByTestId('login-submit-button').click()
}

test.describe('coupon claim boundaries', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(90_000)

  test('customer sees 已领取 after claiming once and only gets one record', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 领券边界商品 A',
      price: 18,
    })
    const customer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `134${Date.now().toString().slice(-8)}`,
      name: '重复领券客户',
    })
    const coupon = await createCouponAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      title: 'E2E 单次领取券',
      amount: 5,
      minSpend: 0,
      totalQuantity: 5,
    })

    await openMenu(page, merchant.id, menuItem.id)
    await openCouponCenter(page)

    await expect(page.getByText(coupon.title)).toBeVisible()
    await loginForClaim(page, customer.phone!)

    await expect(page.getByRole('button', { name: '已领取' })).toBeVisible({ timeout: POLL_TIMEOUT_MS })
    await expect
      .poll(async () => (await getUserCouponsByCustomer(customer.id)).filter((item) => item.coupon_id === coupon.id).length, {
        timeout: POLL_TIMEOUT_MS,
      })
      .toBe(1)

    await page.reload()
    await openCouponCenter(page)
    await expect(page.getByText(coupon.title)).toBeVisible()
    await expect(page.getByRole('button', { name: '已领取' })).toBeVisible()
    await expect(
      (await getUserCouponsByCustomer(customer.id)).filter((item) => item.coupon_id === coupon.id),
    ).toHaveLength(1)
  })

  test('sold out coupon cannot be claimed by another customer', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 领券边界商品 B',
      price: 20,
    })
    const firstCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `133${Date.now().toString().slice(-8)}`,
      name: '首位领券客户',
    })
    const secondCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `132${Date.now().toString().slice(-8)}`,
      name: '后续领券客户',
    })
    const coupon = await createCouponAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      title: 'E2E 已抢光券',
      amount: 6,
      minSpend: 0,
      totalQuantity: 1,
    })

    await expect(claimCouponForCustomer({
      couponId: coupon.id,
      customerId: firstCustomer.id,
    })).resolves.toBe(true)

    await page.addInitScript(
      ({ merchantId, phone, name }: { merchantId: string; phone: string; name: string }) => {
        localStorage.setItem(
          `customer_info_${merchantId}`,
          JSON.stringify({ phone, name, address: '上海市浦东新区已抢光测试路 66 号' }),
        )
      },
      { merchantId: merchant.id, phone: secondCustomer.phone!, name: secondCustomer.name ?? '后续领券客户' },
    )

    await openMenu(page, merchant.id, menuItem.id)
    await openCouponCenter(page)

    await expect(page.getByText(coupon.title)).toBeVisible()
    await expect(page.getByRole('button', { name: '已抢光' })).toBeVisible({ timeout: POLL_TIMEOUT_MS })
    await expect(page.getByTestId('login-phone-input')).toHaveCount(0)
    await expect(
      (await getUserCouponsByCustomer(secondCustomer.id)).filter((item) => item.coupon_id === coupon.id),
    ).toHaveLength(0)
  })

  test('concurrent claims from the same customer still create only one coupon record', async ({ browser }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 同客并发抢券商品',
      price: 21,
    })
    const customer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `131${Date.now().toString().slice(-8)}`,
      name: '同客并发抢券顾客',
    })
    const coupon = await createCouponAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      title: 'E2E 同客并发抢券',
      amount: 5,
      minSpend: 0,
      totalQuantity: 5,
    })

    const [contextA, contextB] = await Promise.all([browser.newContext(), browser.newContext()])
    const [pageA, pageB] = await Promise.all([contextA.newPage(), contextB.newPage()])

    try {
      await Promise.all([
        openMenu(pageA, merchant.id, menuItem.id),
        openMenu(pageB, merchant.id, menuItem.id),
      ])

      await Promise.all([
        openCouponCenter(pageA),
        openCouponCenter(pageB),
      ])

      await expect(pageA.getByText(coupon.title, { exact: true })).toBeVisible()
      await expect(pageB.getByText(coupon.title, { exact: true })).toBeVisible()

      await Promise.all([
        loginForClaim(pageA, customer.phone!),
        loginForClaim(pageB, customer.phone!),
      ])

      await expect
        .poll(async () => (await getUserCouponsByCustomer(customer.id)).filter((item) => item.coupon_id === coupon.id).length, {
          message: 'expected concurrent claims from the same customer to create only one user coupon record',
          timeout: POLL_TIMEOUT_MS,
        })
        .toBe(1)

      await Promise.all([pageA.reload(), pageB.reload()])
      await Promise.all([openCouponCenter(pageA), openCouponCenter(pageB)])
      await expect(pageA.getByRole('button', { name: '已领取' })).toBeVisible()
      await expect(pageB.getByRole('button', { name: '已领取' })).toBeVisible()
    } finally {
      await Promise.all([contextA.close(), contextB.close()])
    }
  })

  test('concurrent claims from different customers only let one customer get the last coupon', async ({ browser }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 异客并发抢最后一张商品',
      price: 23,
    })
    const firstCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `130${Date.now().toString().slice(-8)}`,
      name: '异客并发抢券顾客A',
    })
    const secondCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `129${Date.now().toString().slice(-8)}`,
      name: '异客并发抢券顾客B',
    })
    const coupon = await createCouponAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      title: 'E2E 异客并发最后一张券',
      amount: 6,
      minSpend: 0,
      totalQuantity: 1,
    })

    const [contextA, contextB] = await Promise.all([browser.newContext(), browser.newContext()])
    const [pageA, pageB] = await Promise.all([contextA.newPage(), contextB.newPage()])

    try {
      await Promise.all([
        openMenu(pageA, merchant.id, menuItem.id),
        openMenu(pageB, merchant.id, menuItem.id),
      ])

      await Promise.all([
        openCouponCenter(pageA),
        openCouponCenter(pageB),
      ])

      await expect(pageA.getByText(coupon.title, { exact: true })).toBeVisible()
      await expect(pageB.getByText(coupon.title, { exact: true })).toBeVisible()

      await Promise.all([
        loginForClaim(pageA, firstCustomer.phone!),
        loginForClaim(pageB, secondCustomer.phone!),
      ])

      await expect
        .poll(async () => {
          const [firstCount, secondCount] = await Promise.all([
            getUserCouponsByCustomer(firstCustomer.id),
            getUserCouponsByCustomer(secondCustomer.id),
          ])

          return (
            firstCount.filter((item) => item.coupon_id === coupon.id).length +
            secondCount.filter((item) => item.coupon_id === coupon.id).length
          )
        }, {
          message: 'expected concurrent claims from different customers to produce only one user coupon record for the last coupon',
          timeout: POLL_TIMEOUT_MS,
        })
        .toBe(1)

      const [firstCoupons, secondCoupons] = await Promise.all([
        getUserCouponsByCustomer(firstCustomer.id),
        getUserCouponsByCustomer(secondCustomer.id),
      ])
      const firstWon = firstCoupons.some((item) => item.coupon_id === coupon.id)
      const secondWon = secondCoupons.some((item) => item.coupon_id === coupon.id)

      expect(Number(firstWon) + Number(secondWon)).toBe(1)

      await Promise.all([pageA.reload(), pageB.reload()])
      await Promise.all([openCouponCenter(pageA), openCouponCenter(pageB)])

      if (firstWon) {
        await expect(pageA.getByRole('button', { name: '已领取' })).toBeVisible()
        await expect(pageB.getByRole('button', { name: '已抢光' })).toBeVisible()
      } else {
        await expect(pageA.getByRole('button', { name: '已抢光' })).toBeVisible()
        await expect(pageB.getByRole('button', { name: '已领取' })).toBeVisible()
      }
    } finally {
      await Promise.all([contextA.close(), contextB.close()])
    }
  })

  test('disabled coupon disappears from coupon center after merchant updates it', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 停用券前台同步商品',
      price: 22,
    })
    const coupon = await createCouponAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      title: 'E2E 停用后前台消失券',
      amount: 7,
      minSpend: 0,
      totalQuantity: 5,
    })

    await openMenu(page, merchant.id, menuItem.id)
    await openCouponCenter(page)
    await expect(page.getByText(coupon.title)).toBeVisible()

    await updateCouponAsMerchant({
      couponId: coupon.id,
      merchantPhone,
      merchantPassword,
      patch: {
        status: 'disabled',
      },
    })

    await page.reload()
    await openCouponCenter(page)
    await expect(page.getByText(coupon.title)).toHaveCount(0)
  })

  test('coupon center shows the latest amount after merchant edits the coupon', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 券面额同步商品',
      price: 24,
    })
    const coupon = await createCouponAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      title: 'E2E 面额更新券',
      amount: 5,
      minSpend: 0,
      totalQuantity: 5,
    })

    await openMenu(page, merchant.id, menuItem.id)
    await openCouponCenter(page)
    await expect(page.getByText(coupon.title)).toBeVisible()
    await expect(page.getByText('无门槛减 ¥5')).toBeVisible()

    await updateCouponAsMerchant({
      couponId: coupon.id,
      merchantPhone,
      merchantPassword,
      patch: {
        amount: 9,
      },
    })

    await page.reload()
    await openCouponCenter(page)
    await expect(page.getByText(coupon.title)).toBeVisible()
    await expect(page.getByText('无门槛减 ¥9')).toBeVisible()
    await expect(page.getByText('无门槛减 ¥5')).toHaveCount(0)
  })

  test('coupon center shows the latest min-spend rule after merchant edits the coupon', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 券门槛同步商品',
      price: 25,
    })
    const coupon = await createCouponAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      title: 'E2E 门槛更新券',
      amount: 6,
      minSpend: 0,
      totalQuantity: 5,
    })

    await openMenu(page, merchant.id, menuItem.id)
    await openCouponCenter(page)
    await expect(page.getByText(coupon.title)).toBeVisible()
    await expect(page.getByText('无门槛减 ¥6')).toBeVisible()

    await updateCouponAsMerchant({
      couponId: coupon.id,
      merchantPhone,
      merchantPassword,
      patch: {
        min_spend: 30,
      },
    })

    await page.reload()
    await openCouponCenter(page)
    await expect(page.getByText(coupon.title)).toBeVisible()
    await expect(page.getByText('满 ¥30 减 ¥6')).toBeVisible()
    await expect(page.getByText('无门槛减 ¥6')).toHaveCount(0)
  })

  test('coupon center shows sold-out state after merchant reduces available quantity to zero', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 券库存同步商品',
      price: 26,
    })
    const coupon = await createCouponAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      title: 'E2E 库存更新券',
      amount: 4,
      minSpend: 0,
      totalQuantity: 5,
    })

    await openMenu(page, merchant.id, menuItem.id)
    await openCouponCenter(page)
    await expect(page.getByText(coupon.title)).toBeVisible()
    await expect(page.getByRole('button', { name: '抢券' })).toBeVisible()

    await updateCouponAsMerchant({
      couponId: coupon.id,
      merchantPhone,
      merchantPassword,
      patch: {
        total_quantity: 0,
      },
    })

    await page.reload()
    await openCouponCenter(page)
    await expect(page.getByText(coupon.title)).toBeVisible()
    await expect(page.getByRole('button', { name: '已抢光' })).toBeVisible()
    await expect(page.getByRole('button', { name: '抢券' })).toHaveCount(0)
  })
})
