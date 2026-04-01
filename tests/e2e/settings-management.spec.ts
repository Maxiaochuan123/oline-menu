import { expect, test } from '@playwright/test'

import {
  createDisabledDateAsMerchant,
  createMerchantAccount,
  getDisabledDatesAsMerchant,
  getMerchantById,
  updateMerchantAsMerchant,
} from './helpers/supabase'
import { loginAsMerchant } from './helpers/auth'

async function openSettingsPage(page: import('@playwright/test').Page) {
  if (!page.url().includes('/settings')) {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' })
  }

  await expect(page.getByTestId('settings-save-button')).toBeVisible()
}

test.describe('settings management', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(90_000)

  test('merchant can save business status, hours and announcement', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const shopName = `E2E Shop ${Date.now().toString().slice(-6)}`
    const announcement = `E2E Announcement ${Date.now().toString().slice(-6)}`

    await loginAsMerchant(page, { phone, password, gotoPath: '/settings' })
    await openSettingsPage(page)

    await page.getByTestId('settings-accepting-switch').click()
    await page.getByTestId('settings-auto-open-switch').click()

    await page.getByTestId('settings-open-time-trigger').click()
    await page.getByTestId('settings-open-time-hour-10').click()
    await page.getByTestId('settings-open-time-minute-30').click()
    await page.getByTestId('settings-open-time-confirm').click()

    await page.getByTestId('settings-close-time-trigger').click()
    await page.getByTestId('settings-close-time-hour-22').click()
    await page.getByTestId('settings-close-time-minute-15').click()
    await page.getByTestId('settings-close-time-confirm').click()

    await page.getByTestId('settings-shop-name').fill(shopName)
    await page.getByTestId('settings-announcement').fill(announcement)
    await page.getByTestId('settings-save-button').click()

    await expect.poll(async () => {
      const latestMerchant = await getMerchantById(merchant.id)
      return {
        shopName: latestMerchant.shop_name,
        isAccepting: latestMerchant.is_accepting_orders,
        announcement: latestMerchant.announcement,
        openTime: latestMerchant.business_hours?.open_time,
        closeTime: latestMerchant.business_hours?.close_time,
        isEnabled: latestMerchant.business_hours?.is_enabled,
      }
    }, { timeout: 10_000 }).toEqual({
      shopName,
      isAccepting: false,
      announcement,
      openTime: '10:30',
      closeTime: '22:15',
      isEnabled: true,
    })

    await page.goto(`/m/${merchant.id}`)
    await expect(page.getByTestId('store-closed-overlay')).toBeVisible()
    await expect(page.getByTestId('store-closed-message')).toHaveText(announcement)
  })

  test('merchant can remove a disabled date from settings', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const disabledDate = '2026-04-08'
    const created = await createDisabledDateAsMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      disabledDate,
      reason: 'E2E disabled date',
    })

    await loginAsMerchant(page, { phone, password, gotoPath: '/settings' })
    await openSettingsPage(page)

    await page.getByTestId(`settings-disabled-date-remove-${created.id}`).click()

    await expect.poll(async () => {
      const dates = await getDisabledDatesAsMerchant({
        merchantId: merchant.id,
        merchantPhone: phone,
        merchantPassword: password,
      })

      return dates.some((item) => item.id === created.id)
    }, { timeout: 10_000 }).toBe(false)
  })

  test('merchant can upload payment QR images from settings', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const qrFile = 'C:\\Users\\admin\\.gemini\\antigravity\\scratch\\online-menu\\public\\file.svg'

    await loginAsMerchant(page, { phone, password, gotoPath: '/settings' })
    await openSettingsPage(page)

    const fileInputs = page.locator('input[type="file"]')
    await fileInputs.nth(0).setInputFiles(qrFile)
    await fileInputs.nth(1).setInputFiles(qrFile)
    await page.getByTestId('settings-save-button').click()

    await expect.poll(async () => {
      const latestMerchant = await getMerchantById(merchant.id)
      return {
        wechat: latestMerchant.payment_qr_urls?.wechat ?? null,
        alipay: latestMerchant.payment_qr_urls?.alipay ?? null,
      }
    }, { timeout: 15_000 }).toEqual({
      wechat: expect.stringContaining('/storage/v1/object/public/menu-images/'),
      alipay: expect.stringContaining('/storage/v1/object/public/menu-images/'),
    })
  })

  test('invalid QR file type is blocked before upload requests are sent', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const invalidFile = 'C:\\Users\\admin\\.gemini\\antigravity\\scratch\\online-menu\\README.md'
    let uploadRequestCount = 0

    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/storage/v1/object/menu-images/')) {
        uploadRequestCount += 1
      }
    })

    await loginAsMerchant(page, { phone, password, gotoPath: '/settings' })
    await openSettingsPage(page)

    await page.getByTestId('settings-wechat-file-input').setInputFiles(invalidFile)
    await page.getByTestId('settings-save-button').click()

    await expect.poll(() => uploadRequestCount, { timeout: 5_000 }).toBe(0)
    await expect.poll(async () => {
      const latestMerchant = await getMerchantById(merchant.id)
      return latestMerchant.payment_qr_urls?.wechat ?? null
    }, { timeout: 5_000 }).toBeNull()
  })

  test('failed QR upload keeps previous state and a valid retry still succeeds', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const qrFile = 'C:\\Users\\admin\\.gemini\\antigravity\\scratch\\online-menu\\public\\file.svg'
    let shouldFailUploads = true

    await page.route('**/storage/v1/object/menu-images/**', async (route) => {
      if (shouldFailUploads) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'forced upload failure' }),
        })
        return
      }

      await route.fallback()
    })

    await loginAsMerchant(page, { phone, password, gotoPath: '/settings' })
    await openSettingsPage(page)

    await page.getByTestId('settings-wechat-file-input').setInputFiles(qrFile)
    await page.getByTestId('settings-save-button').click()

    await expect.poll(async () => {
      const latestMerchant = await getMerchantById(merchant.id)
      return latestMerchant.payment_qr_urls?.wechat ?? null
    }, { timeout: 5_000 }).toBeNull()

    shouldFailUploads = false
    await page.getByTestId('settings-wechat-file-input').setInputFiles(qrFile)
    await page.getByTestId('settings-save-button').click()

    await expect.poll(async () => {
      const latestMerchant = await getMerchantById(merchant.id)
      return latestMerchant.payment_qr_urls?.wechat ?? null
    }, { timeout: 15_000 }).toEqual(expect.stringContaining('/storage/v1/object/public/menu-images/'))
  })

  test('merchant can clear announcement and storefront falls back to the default pause message', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()

    await updateMerchantAsMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      patch: {
        is_accepting_orders: false,
        announcement: 'E2E previous pause notice',
      },
    })

    await loginAsMerchant(page, { phone, password, gotoPath: '/settings' })
    await openSettingsPage(page)

    await page.getByTestId('settings-announcement').fill('')
    await page.getByTestId('settings-save-button').click()

    await expect.poll(async () => {
      const latestMerchant = await getMerchantById(merchant.id)
      return latestMerchant.announcement ?? ''
    }, { timeout: 10_000 }).toBe('')

    await page.goto(`/m/${merchant.id}`)
    await expect(page.getByTestId('store-closed-overlay')).toBeVisible()
    await expect(page.getByTestId('store-closed-message')).toHaveText('商家目前忙碌中，请稍后再来点餐~')
  })

  test('removing a disabled date from settings reopens the storefront for that day', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const disabledDate = '2026-04-08'
    const created = await createDisabledDateAsMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      disabledDate,
      reason: 'E2E reopen date removed',
    })

    await loginAsMerchant(page, { phone, password, gotoPath: '/settings' })
    await openSettingsPage(page)

    await page.getByTestId(`settings-disabled-date-remove-${created.id}`).click()
    await expect.poll(async () => {
      const dates = await getDisabledDatesAsMerchant({
        merchantId: merchant.id,
        merchantPhone: phone,
        merchantPassword: password,
      })

      return dates.some((item) => item.id === created.id)
    }, { timeout: 10_000 }).toBe(false)

    await page.goto(`/m/${merchant.id}`)
    await expect(page.getByTestId('store-closed-overlay')).toHaveCount(0)
  })

  test('failed settings save keeps merchant data unchanged', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const originalShopName = `E2E Original Shop ${Date.now().toString().slice(-6)}`
    const originalAnnouncement = `E2E Original Announcement ${Date.now().toString().slice(-6)}`
    const originalBusinessHours = {
      is_enabled: true,
      open_time: '09:00',
      close_time: '21:00',
    }

    await updateMerchantAsMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      patch: {
        shop_name: originalShopName,
        announcement: originalAnnouncement,
        is_accepting_orders: true,
        business_hours: originalBusinessHours,
      },
    })

    await page.route('**/rest/v1/merchants*', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'forced merchant settings failure' }),
        })
        return
      }

      await route.continue()
    })

    await loginAsMerchant(page, { phone, password, gotoPath: '/settings' })
    await openSettingsPage(page)

    await page.getByTestId('settings-accepting-switch').click()
    await page.getByTestId('settings-open-time-trigger').click()
    await page.getByTestId('settings-open-time-hour-11').click()
    await page.getByTestId('settings-open-time-minute-15').click()
    await page.getByTestId('settings-open-time-confirm').click()

    await page.getByTestId('settings-close-time-trigger').click()
    await page.getByTestId('settings-close-time-hour-23').click()
    await page.getByTestId('settings-close-time-minute-00').click()
    await page.getByTestId('settings-close-time-confirm').click()
    await page.getByTestId('settings-shop-name').fill('E2E Updated Shop')
    await page.getByTestId('settings-announcement').fill('E2E Updated Announcement')
    await page.getByTestId('settings-save-button').click()

    await expect.poll(async () => {
      const latestMerchant = await getMerchantById(merchant.id)
      return {
        shopName: latestMerchant.shop_name,
        announcement: latestMerchant.announcement,
        isAccepting: latestMerchant.is_accepting_orders,
        openTime: latestMerchant.business_hours?.open_time,
        closeTime: latestMerchant.business_hours?.close_time,
        isEnabled: latestMerchant.business_hours?.is_enabled,
      }
    }, { timeout: 10_000 }).toEqual({
      shopName: originalShopName,
      announcement: originalAnnouncement,
      isAccepting: true,
      openTime: '09:00',
      closeTime: '21:00',
      isEnabled: true,
    })
  })
})
