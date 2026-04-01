import { expect, test } from '@playwright/test'

import {
  createMerchantAccount,
  getMerchantById,
} from './helpers/supabase'
import { loginAsMerchant } from './helpers/auth'

async function openMembershipPage(page: import('@playwright/test').Page) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (!page.url().includes('/membership')) {
      await page.goto('/membership', { waitUntil: 'domcontentloaded' })
    }

    const saveButton = page.getByTestId('membership-save-button')
    if (await saveButton.count()) {
      await expect(saveButton).toBeVisible()
      return
    }

    await page.waitForTimeout(1_000 * (attempt + 1))
  }

  throw new Error('membership page did not become ready')
}

async function enableCustomMembership(page: import('@playwright/test').Page) {
  await page.getByTestId('membership-mode-custom').click()
  await page.getByTestId('membership-risk-confirm').click()
  await expect(page.getByTestId('membership-add-tier')).toBeVisible()
}

test.describe('membership management', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(90_000)

  test('moving the first threshold shifts later tiers and persists contiguous ranges', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()

    await loginAsMerchant(page, { phone, password, gotoPath: '/membership' })
    await openMembershipPage(page)
    await enableCustomMembership(page)

    const firstSliderHandle = page.getByTestId('membership-tier-slider-0').getByRole('slider')
    await firstSliderHandle.focus()

    for (let index = 0; index < 10; index += 1) {
      await firstSliderHandle.press('ArrowRight')
    }

    await expect(page.getByTestId('membership-tier-range-0')).toHaveText('0 - 301')
    await expect(page.getByTestId('membership-tier-range-1')).toHaveText('302 - 601')
    await expect(page.getByTestId('membership-tier-range-2')).toHaveText('602 - 1101')

    await page.getByTestId('membership-save-button').click()

    await expect.poll(async () => {
      const latestMerchant = await getMerchantById(merchant.id)
      const levels = Array.isArray(latestMerchant.membership_levels) ? latestMerchant.membership_levels : []
      return JSON.stringify(
        levels.map((level) => (level as { minPoints?: number }).minPoints),
      )
    }, { timeout: 10_000 }).toBe(JSON.stringify([100, 302, 602, 1102, 3102]))
  })

  test('invalid form blocks save and keeps membership config unchanged', async ({ page }) => {
    const { phone, password } = await createMerchantAccount()
    let merchantPatchCount = 0

    page.on('request', (request) => {
      if (request.method() === 'PATCH' && request.url().includes('/rest/v1/merchants')) {
        merchantPatchCount += 1
      }
    })

    await loginAsMerchant(page, { phone, password, gotoPath: '/membership' })
    await openMembershipPage(page)
    await enableCustomMembership(page)

    await page.getByTestId('membership-tier-name-0').fill('')
    await page.getByTestId('membership-save-button').click()

    await expect(page.getByTestId('membership-tier-name-0')).toHaveAttribute('aria-invalid', 'true')
    await expect.poll(() => merchantPatchCount, { timeout: 5_000 }).toBe(0)
  })

  test('empty discount blocks save and keeps membership config unchanged', async ({ page }) => {
    const { phone, password } = await createMerchantAccount()
    let merchantPatchCount = 0

    page.on('request', (request) => {
      if (request.method() === 'PATCH' && request.url().includes('/rest/v1/merchants')) {
        merchantPatchCount += 1
      }
    })

    await loginAsMerchant(page, { phone, password, gotoPath: '/membership' })
    await openMembershipPage(page)
    await enableCustomMembership(page)

    const rateInput = page.getByTestId('membership-tier-rate-0')
    await rateInput.fill('')
    await page.getByTestId('membership-save-button').click()

    await expect(rateInput).toHaveAttribute('aria-invalid', 'true')
    await expect.poll(() => merchantPatchCount, { timeout: 5_000 }).toBe(0)
  })

  test('merchant can switch between custom membership and the default preset', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()

    await loginAsMerchant(page, { phone, password, gotoPath: '/membership' })
    await openMembershipPage(page)
    await enableCustomMembership(page)

    await page.getByTestId('membership-tier-name-0').fill('测试铜牌')
    await page.getByTestId('membership-tier-rate-0').fill('99')
    await page.getByTestId('membership-add-tier').click()

    await expect(page.getByTestId('membership-tier-card-5')).toBeVisible()
    await page.getByTestId('membership-tier-name-5').fill('测试黑金')
    await page.getByTestId('membership-tier-rate-5').fill('86')

    await page.getByTestId('membership-save-button').click()

    await expect.poll(async () => {
      const latestMerchant = await getMerchantById(merchant.id)
      const levels = Array.isArray(latestMerchant.membership_levels) ? latestMerchant.membership_levels : []
      const first = levels[0] as { name?: string; rate?: number } | undefined
      const last = levels[5] as { name?: string; rate?: number } | undefined
      return JSON.stringify({
        length: levels.length,
        firstName: first?.name,
        firstRate: first?.rate,
        lastName: last?.name,
        lastRate: last?.rate,
      })
    }, { timeout: 10_000 }).toBe(JSON.stringify({
      length: 6,
      firstName: '测试铜牌',
      firstRate: 0.99,
      lastName: '测试黑金',
      lastRate: 0.86,
    }))

    await page.goto('/membership', { waitUntil: 'domcontentloaded' })
    await openMembershipPage(page)
    await page.getByTestId('membership-mode-default').click()
    await page.getByTestId('membership-save-button').click()

    await expect.poll(async () => {
      const latestMerchant = await getMerchantById(merchant.id)
      return latestMerchant.membership_levels
    }, { timeout: 10_000 }).toBeNull()
  })

  test('removing the first tier keeps the remaining ranges contiguous after save', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()

    await loginAsMerchant(page, { phone, password, gotoPath: '/membership' })
    await openMembershipPage(page)
    await enableCustomMembership(page)

    await page.getByTestId('membership-tier-remove-0').click()

    await expect(page.getByTestId('membership-tier-range-0')).toHaveText('0 - 500')
    await expect(page.getByTestId('membership-tier-range-1')).toHaveText('501 - 1000')
    await expect(page.getByTestId('membership-tier-range-2')).toHaveText('1001 - 3000')
    await expect(page.getByTestId('membership-tier-range-3')).toHaveText('3001+')

    await page.getByTestId('membership-save-button').click()

    await expect.poll(async () => {
      const latestMerchant = await getMerchantById(merchant.id)
      const levels = Array.isArray(latestMerchant.membership_levels) ? latestMerchant.membership_levels : []
      return JSON.stringify(levels.map((level) => (level as { minPoints?: number }).minPoints))
    }, { timeout: 10_000 }).toBe(JSON.stringify([201, 501, 1001, 3001]))
  })

  test('removing the last tier keeps the final range stable after save', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()

    await loginAsMerchant(page, { phone, password, gotoPath: '/membership' })
    await openMembershipPage(page)
    await enableCustomMembership(page)

    await page.getByTestId('membership-tier-remove-4').click()

    await expect(page.getByTestId('membership-tier-card-4')).toHaveCount(0)
    await expect(page.getByTestId('membership-tier-range-3')).toHaveText('1001+')

    await page.getByTestId('membership-save-button').click()

    await expect.poll(async () => {
      const latestMerchant = await getMerchantById(merchant.id)
      const levels = Array.isArray(latestMerchant.membership_levels) ? latestMerchant.membership_levels : []
      return JSON.stringify(levels.map((level) => (level as { minPoints?: number }).minPoints))
    }, { timeout: 10_000 }).toBe(JSON.stringify([100, 201, 501, 1001]))
  })

  test('switching back to the default preset resets the custom tiers before custom mode is enabled again', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()

    await loginAsMerchant(page, { phone, password, gotoPath: '/membership' })
    await openMembershipPage(page)
    await enableCustomMembership(page)

    await page.getByTestId('membership-tier-name-0').fill('自定义等级一')
    await page.getByTestId('membership-tier-rate-0').fill('97')
    await page.getByTestId('membership-save-button').click()

    await expect.poll(async () => {
      const latestMerchant = await getMerchantById(merchant.id)
      const levels = Array.isArray(latestMerchant.membership_levels) ? latestMerchant.membership_levels : []
      return (levels[0] as { name?: string; rate?: number } | undefined)?.name
    }, { timeout: 10_000 }).toBe('自定义等级一')

    await page.goto('/membership', { waitUntil: 'domcontentloaded' })
    await openMembershipPage(page)
    await page.getByTestId('membership-mode-default').click()
    await page.getByTestId('membership-save-button').click()

    await expect.poll(async () => {
      const latestMerchant = await getMerchantById(merchant.id)
      return latestMerchant.membership_levels
    }, { timeout: 10_000 }).toBeNull()

    await page.goto('/membership', { waitUntil: 'domcontentloaded' })
    await openMembershipPage(page)
    await enableCustomMembership(page)

    await expect(page.getByTestId('membership-tier-name-0')).toHaveValue('铜牌会员')
    await expect(page.getByTestId('membership-tier-rate-0')).toHaveValue('98')
    await expect(page.getByTestId('membership-tier-range-0')).toHaveText('0 - 200')
    await expect(page.getByTestId('membership-tier-range-4')).toHaveText('3001+')
  })

  test('moving adjacent sliders keeps ranges ascending integers without overlap', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()

    await loginAsMerchant(page, { phone, password, gotoPath: '/membership' })
    await openMembershipPage(page)
    await enableCustomMembership(page)

    const firstSliderHandle = page.getByTestId('membership-tier-slider-0').getByRole('slider')
    const secondSliderStartHandle = page.getByTestId('membership-tier-slider-1').getByRole('slider').first()

    await firstSliderHandle.focus()
    for (let index = 0; index < 5; index += 1) {
      await firstSliderHandle.press('ArrowRight')
    }

    await secondSliderStartHandle.focus()
    for (let index = 0; index < 3; index += 1) {
      await secondSliderStartHandle.press('ArrowRight')
    }

    await page.getByTestId('membership-save-button').click()

    await expect(page.getByTestId('membership-tier-rate-0')).toHaveValue('98')
    await expect(page.getByTestId('membership-tier-rate-1')).toHaveValue('96')

    await expect.poll(async () => {
      const latestMerchant = await getMerchantById(merchant.id)
      const levels = Array.isArray(latestMerchant.membership_levels) ? latestMerchant.membership_levels : []
      const minPoints = levels.map((level) => (level as { minPoints?: number }).minPoints ?? 0)
      return {
        length: minPoints.length,
        minPoints,
        areIntegers: minPoints.every((value) => Number.isInteger(value)),
        isStrictlyAscending: minPoints.every((value, index) => index === 0 || value > minPoints[index - 1]),
      }
    }, { timeout: 20_000 }).toEqual({
      length: 5,
      minPoints: expect.any(Array),
      areIntegers: true,
      isStrictlyAscending: true,
    })
  })

  test('removing a middle tier keeps later ranges connected after save', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()

    await loginAsMerchant(page, { phone, password, gotoPath: '/membership' })
    await openMembershipPage(page)
    await enableCustomMembership(page)

    await page.getByTestId('membership-tier-remove-2').click()

    await expect(page.getByTestId('membership-tier-card-4')).toHaveCount(0)
    await expect(page.getByTestId('membership-tier-range-1')).toHaveText('201 - 1000')
    await expect(page.getByTestId('membership-tier-range-2')).toHaveText('1001 - 3000')
    await expect(page.getByTestId('membership-tier-range-3')).toHaveText('3001+')

    await page.getByTestId('membership-save-button').click()

    await expect.poll(async () => {
      const latestMerchant = await getMerchantById(merchant.id)
      const levels = Array.isArray(latestMerchant.membership_levels) ? latestMerchant.membership_levels : []
      return JSON.stringify({
        length: levels.length,
        minPoints: levels.map((level) => (level as { minPoints?: number }).minPoints),
      })
    }, { timeout: 10_000 }).toBe(JSON.stringify({
      length: 4,
      minPoints: [100, 201, 1001, 3001],
    }))
  })
})
