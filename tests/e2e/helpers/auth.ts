import { expect, Page } from '@playwright/test'

import { createMerchantSession, getSupabaseStorageKey } from './supabase'

type LoginOptions = {
  phone: string
  password: string
  gotoPath?: string
  timeoutMs?: number
}

export async function loginAsMerchant(page: Page, opts: LoginOptions) {
  const { phone, password, gotoPath, timeoutMs = 30_000 } = opts

  await page.context().clearCookies().catch(() => {})
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  }).catch(() => {})
  await page.goto('/login', { waitUntil: 'domcontentloaded' })

  if (page.url().includes('/dashboard')) {
    if (gotoPath) {
      await page.goto(gotoPath, { waitUntil: 'domcontentloaded' })
    }
    return
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const merchantTab = page.getByRole('button', { name: '商家登录' }).first()
    if (await merchantTab.count()) {
      await merchantTab.click()
    }

    const phoneInput = page.locator('input[type="tel"]').first()
    const passwordInput = page.locator('input[type="password"]').first()
    await expect(phoneInput).toBeVisible()
    await expect(passwordInput).toBeVisible()

    await phoneInput.fill(phone)
    await passwordInput.fill(password)
    await expect(phoneInput).toHaveValue(phone)
    await expect(passwordInput).toHaveValue(password)
    await page.locator('form button[type="submit"]').click()

    try {
      await page.waitForURL(/\/dashboard$/, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
      break
    } catch (error) {
      if (attempt === 1) {
        throw error
      }

      await page.goto('/login', { waitUntil: 'domcontentloaded' })
    }
  }

  if (gotoPath) {
    await page.goto(gotoPath, { waitUntil: 'domcontentloaded' })
  }
}

export async function loginAsMerchantBySession(page: Page, opts: LoginOptions) {
  const { phone, password, gotoPath = '/dashboard' } = opts
  const session = await createMerchantSession(phone, password)
  const storageKey = getSupabaseStorageKey()

  await page.context().clearCookies().catch(() => {})
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ([key, value]) => {
      window.localStorage.setItem(key, value)
    },
    [storageKey, JSON.stringify(session)],
  )
  await page.goto(gotoPath, { waitUntil: 'domcontentloaded' })
}

export async function seedCustomerInfo(page: Page, params: {
  merchantId: string
  phone: string
  name?: string
  address?: string
  gotoPath?: string
}) {
  const { merchantId, phone, name = '', address = '', gotoPath = `/m/${merchantId}` } = params
  await page.goto(gotoPath, { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ([key, value]) => {
      window.localStorage.setItem(key, value)
    },
    [`customer_info_${merchantId}`, JSON.stringify({ phone, name, address })],
  )
}
