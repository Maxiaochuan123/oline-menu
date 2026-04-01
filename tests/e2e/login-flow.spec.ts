import { expect, test } from '@playwright/test'

import {
  createMerchantAccount,
  createMenuItemForMerchant,
  findMerchantByPhone,
} from './helpers/supabase'

test.describe('login flows', () => {
  test.setTimeout(90_000)

  test('merchant can register from the login page and lands on dashboard', async ({ page }) => {
    const phone = `13${Date.now().toString().slice(-9)}`
    const password = `Pwd${Date.now()}`

    await page.goto('/login')
    await page.getByTestId('merchant-register-toggle').click()

    const textboxes = page.locator('input')
    await textboxes.nth(0).fill('E2E 注册店铺')
    await textboxes.nth(1).fill('测试商家')
    await textboxes.nth(2).fill('110101199003077777')
    await page.locator('input[type="tel"]').fill(phone)
    await page.locator('input[type="password"]').fill(password)
    await page.getByTestId('merchant-auth-submit').click()

    await page.waitForURL(/\/dashboard$/, { waitUntil: 'domcontentloaded', timeout: 60_000 })

    await expect
      .poll(async () => findMerchantByPhone(phone), { timeout: 15_000 })
      .not.toBeNull()
  })

  test('merchant login with the wrong password stays on login page', async ({ page }) => {
    const { phone, password } = await createMerchantAccount()

    await page.goto('/login')
    await page.getByTestId('login-tab-merchant').click()
    await page.locator('input[type="tel"]').fill(phone)
    await page.locator('input[type="password"]').fill(`${password}-wrong`)
    await page.getByTestId('merchant-auth-submit').click()

    await page.waitForTimeout(1_000)
    await expect(page).toHaveURL(/\/login/)
    await expect(page).not.toHaveURL(/\/dashboard$/)
  })

  test('merchant registration requires shop name, real name, and id card', async ({ page }) => {
    const phone = `13${Date.now().toString().slice(-9)}`

    await page.goto('/login')
    await page.getByTestId('merchant-register-toggle').click()
    await page.locator('input[type="tel"]').fill(phone)
    await page.locator('input[type="password"]').fill(`Pwd${Date.now()}`)
    await page.getByTestId('merchant-auth-submit').click()

    await expect(page).toHaveURL(/\/login/)
    await expect(page.locator('form')).toContainText(/店|姓名|身份/)
    await expect(await findMerchantByPhone(phone)).toBeNull()
  })

  test('customer can enter a merchant storefront from the shared store link', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const itemName = `E2E 店铺菜品 ${Date.now().toString().slice(-4)}`

    await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      itemName,
    })

    await page.goto(`/m/${merchant.id}`)

    await expect(page).toHaveURL(new RegExp(`/m/${merchant.id}$`))
    await expect(page.getByText(itemName)).toBeVisible()
  })
})
