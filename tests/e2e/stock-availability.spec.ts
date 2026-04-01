import { expect, test } from '@playwright/test'

import {
  createMerchantAccount,
  createMenuItemForMerchant,
  setMenuItemAvailability,
} from './helpers/supabase'

test.describe('stock availability guards', () => {
  test.setTimeout(90_000)

  test('menu item disappears for customers once merchant marks it unavailable', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      itemName: `E2E售罄${Date.now().toString().slice(-4)}`,
      price: 12,
    })

    await page.goto(`/m/${merchant.id}`)
    const itemCard = page.getByTestId(`menu-item-${menuItem.id}`)
    await expect(itemCard).toBeVisible()

    await setMenuItemAvailability({
      merchantPhone: phone,
      merchantPassword: password,
      itemId: menuItem.id,
      isAvailable: false,
    })

    await page.reload()
    await expect(page.getByTestId(`menu-item-${menuItem.id}`)).toHaveCount(0)
  })

  test('checkout is blocked if a cart item becomes unavailable before submission', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      itemName: `E2E结算前下架${Date.now().toString().slice(-4)}`,
      price: 18,
    })

    let orderInsertCount = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/rest/v1/orders')) {
        orderInsertCount += 1
      }
    })

    await page.goto(`/m/${merchant.id}`)
    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('下架拦截客户')
    await form.locator('input[type="tel"]').fill(`139${Date.now().toString().slice(-8)}`)
    await form.locator('textarea').fill('上海市浦东新区下架拦截测试路 77 号')

    await setMenuItemAvailability({
      merchantPhone: phone,
      merchantPassword: password,
      itemId: menuItem.id,
      isAvailable: false,
    })

    await form.getByTestId('submit-order-button').click()

    await expect(page.getByText(`${menuItem.name} 已下架，请重新确认购物车`)).toBeVisible()
    await expect(page.getByTestId('clear-cart-button')).toBeVisible()
    await expect(page.getByTestId(`cart-item-${menuItem.id}`)).toHaveCount(0)
    await expect.poll(() => orderInsertCount, { timeout: 5_000 }).toBe(0)
  })
})
