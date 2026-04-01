import { expect, test } from '@playwright/test'

import {
  createCustomerForMerchant,
  createCustomerMessage,
  createCustomerOrder,
  createMerchantAccount,
  createOrderForCustomer,
  getMessageById,
  updateOrder,
} from './helpers/supabase'
import { loginAsMerchant } from './helpers/auth'

test.describe('auth and permission guards', () => {
  test.setTimeout(90_000)

  test('merchant dashboard redirects to login after session is cleared', async ({ page }) => {
    const { phone, password } = await createMerchantAccount()

    await loginAsMerchant(page, { phone, password, gotoPath: '/dashboard' })
    await expect(page).toHaveURL(/\/dashboard$/)

    await page.context().clearCookies()
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })

    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('customer order detail rejects a mismatched merchant id', async ({ page }) => {
    const { merchant: merchantA } = await createMerchantAccount()
    const { merchant: merchantB } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchantA.id)

    await page.goto(`/m/${merchantB.id}/order/${order.id}`)

    await expect(page.getByText('订单不存在')).toBeVisible()
    await expect(page.getByRole('link', { name: '返回店铺' })).toHaveAttribute('href', `/m/${merchantB.id}`)
    await expect(page.getByTestId('order-cta-pay')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-cancel')).toHaveCount(0)
  })

  test('customer order detail stays blocked even when the target merchant has its own valid order', async ({ page }) => {
    const { merchant: merchantA } = await createMerchantAccount()
    const { merchant: merchantB } = await createMerchantAccount()
    const { order: foreignOrder } = await createCustomerOrder(merchantA.id)
    await createCustomerOrder(merchantB.id)

    await page.goto(`/m/${merchantB.id}/order/${foreignOrder.id}`)

    await expect(page.getByText('订单不存在')).toBeVisible()
    await expect(page.getByRole('link', { name: '返回店铺' })).toHaveAttribute('href', `/m/${merchantB.id}`)
    await expect(page.getByTestId('order-chat-box')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-pay')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-cancel')).toHaveCount(0)
  })

  test('merchant orders page only shows the signed-in merchant records', async ({ page }) => {
    const { merchant: merchantA } = await createMerchantAccount()
    const { merchant: merchantB, phone: phoneB, password: passwordB } = await createMerchantAccount()
    const { order: orderA } = await createCustomerOrder(merchantA.id)
    const { order: orderB } = await createCustomerOrder(merchantB.id)

    await loginAsMerchant(page, { phone: phoneB, password: passwordB, gotoPath: '/orders' })

    await expect(page.getByTestId(`orders-phone-group-${orderB.phone}`)).toBeVisible()
    await expect(page.getByTestId(`orders-phone-group-${orderA.phone}`)).toHaveCount(0)
    await expect(page.getByText(orderA.customer_name)).toHaveCount(0)
    await expect(page.getByText(orderB.customer_name).first()).toBeVisible()
  })

  test('merchant customers page only shows the signed-in merchant customers', async ({ page }) => {
    const { merchant: merchantA } = await createMerchantAccount()
    const { merchant: merchantB, phone: phoneB, password: passwordB } = await createMerchantAccount()
    const { order: orderA } = await createCustomerOrder(merchantA.id)
    const { customer: customerB, order: orderB } = await createCustomerOrder(merchantB.id)

    await loginAsMerchant(page, { phone: phoneB, password: passwordB, gotoPath: '/customers' })

    await expect(page.getByText(orderB.customer_name).first()).toBeVisible()
    await expect(page.getByText(customerB.id)).toHaveCount(0)
    await expect(page.getByText(orderA.customer_name)).toHaveCount(0)
    await expect(page.getByText(orderA.phone)).toHaveCount(0)
  })

  test('expanded customer history only shows the signed-in merchant order records', async ({ page }) => {
    const { merchant: merchantA } = await createMerchantAccount()
    const { merchant: merchantB, phone: phoneB, password: passwordB } = await createMerchantAccount()
    const { order: orderA } = await createCustomerOrder(merchantA.id)
    const { order: orderB } = await createCustomerOrder(merchantB.id)

    await loginAsMerchant(page, { phone: phoneB, password: passwordB, gotoPath: '/customers' })

    await page.getByText(orderB.customer_name).first().click()
    await expect(page.getByText('消费订单全记录')).toBeVisible()
    await expect(page.getByText(new RegExp(`尾号\\s*${orderB.phone.slice(-4)}\\s*订单`))).toBeVisible()
    await expect(page.getByText(new RegExp(`尾号\\s*${orderA.phone.slice(-4)}\\s*订单`))).toHaveCount(0)
    await expect(page.getByText(orderA.customer_name)).toHaveCount(0)
  })

  test('customer history order modal stays scoped to the signed-in merchant order details', async ({ page }) => {
    const { merchant: merchantA } = await createMerchantAccount()
    const { merchant: merchantB, phone: phoneB, password: passwordB } = await createMerchantAccount()
    const { order: orderA } = await createCustomerOrder(merchantA.id)
    const { order: orderB } = await createCustomerOrder(merchantB.id)

    await updateOrder(orderB.id, {
      status: 'preparing',
      confirmed_at: new Date().toISOString(),
    })

    await createCustomerMessage({
      orderId: orderA.id,
      merchantId: merchantA.id,
      content: 'A 顾客历史里的串单消息',
    })
    await createCustomerMessage({
      orderId: orderB.id,
      merchantId: merchantB.id,
      content: 'B 顾客历史里的订单消息',
    })

    await loginAsMerchant(page, { phone: phoneB, password: passwordB, gotoPath: '/customers' })

    await page.getByText(orderB.customer_name).first().click()
    await page.getByTestId(`customer-order-row-${orderB.id}`).click()

    await expect(page.getByTestId('merchant-order-modal')).toBeVisible()
    await expect(page.getByText(orderB.customer_name).last()).toBeVisible()
    await expect(page.getByText(orderB.phone).last()).toBeVisible()
    await expect(page.getByText('B 顾客历史里的订单消息')).toBeVisible()
    await expect(page.getByTestId('merchant-order-next-status-button')).toBeVisible()
    await expect(page.getByText(orderA.customer_name)).toHaveCount(0)
    await expect(page.getByText(orderA.phone)).toHaveCount(0)
    await expect(page.getByText('A 顾客历史里的串单消息')).toHaveCount(0)
  })

  test('merchant messages page only shows the signed-in merchant conversations', async ({ page }) => {
    const { merchant: merchantA } = await createMerchantAccount()
    const { merchant: merchantB, phone: phoneB, password: passwordB } = await createMerchantAccount()
    const { order: orderA } = await createCustomerOrder(merchantA.id)
    const { order: orderB } = await createCustomerOrder(merchantB.id)

    await createCustomerMessage({
      orderId: orderA.id,
      merchantId: merchantA.id,
      content: '商家A消息隔离测试',
    })
    await createCustomerMessage({
      orderId: orderB.id,
      merchantId: merchantB.id,
      content: '商家B消息隔离测试',
    })

    await loginAsMerchant(page, { phone: phoneB, password: passwordB, gotoPath: '/messages' })

    await expect(page.getByText(orderB.customer_name).first()).toBeVisible()
    await expect(page.getByText('商家B消息隔离测试')).toBeVisible()
    await expect(page.getByText(orderA.customer_name)).toHaveCount(0)
    await expect(page.getByText('商家A消息隔离测试')).toHaveCount(0)
  })

  test('messages page order detail entry stays scoped to the signed-in merchant conversation', async ({ page }) => {
    const { merchant: merchantA } = await createMerchantAccount()
    const { merchant: merchantB, phone: phoneB, password: passwordB } = await createMerchantAccount()
    const { order: orderA } = await createCustomerOrder(merchantA.id)
    const { order: orderB } = await createCustomerOrder(merchantB.id)

    const foreignMessage = await createCustomerMessage({
      orderId: orderA.id,
      merchantId: merchantA.id,
      content: 'A 会话里的未读消息',
    })
    const ownMessage = await createCustomerMessage({
      orderId: orderB.id,
      merchantId: merchantB.id,
      content: 'B 会话里的未读消息',
    })

    await loginAsMerchant(page, { phone: phoneB, password: passwordB, gotoPath: '/messages' })

    await page.getByText(orderB.customer_name).first().click()
    await expect(page.getByText('B 会话里的未读消息').last()).toBeVisible()
    await expect(page.getByText('A 会话里的未读消息')).toHaveCount(0)

    await expect.poll(async () => {
      const [own, foreign] = await Promise.all([getMessageById(ownMessage.id), getMessageById(foreignMessage.id)])
      return {
        ownRead: own.is_read_by_merchant,
        foreignRead: foreign.is_read_by_merchant,
      }
    }, { timeout: 10_000 }).toEqual({
      ownRead: true,
      foreignRead: false,
    })

    await page.getByTestId('messages-view-order-button').click()
    await expect(page.getByTestId('merchant-order-modal')).toBeVisible()
    await expect(page.getByText(orderB.customer_name).last()).toBeVisible()
    await expect(page.getByText(orderB.phone).last()).toBeVisible()
    await expect(page.getByTestId('merchant-order-cancel-button')).toBeVisible()
    await expect(page.getByText(orderA.customer_name)).toHaveCount(0)
    await expect(page.getByText(orderA.phone)).toHaveCount(0)
  })

  test('merchant dashboard only shows the signed-in merchant summary data', async ({ page }) => {
    const { merchant: merchantA } = await createMerchantAccount()
    const { merchant: merchantB, phone: phoneB, password: passwordB } = await createMerchantAccount()
    const { order: orderA } = await createCustomerOrder(merchantA.id, 51)
    const { order: orderB } = await createCustomerOrder(merchantB.id, 63)

    await createCustomerMessage({
      orderId: orderA.id,
      merchantId: merchantA.id,
      content: '商家A首页未读消息',
    })
    await createCustomerMessage({
      orderId: orderB.id,
      merchantId: merchantB.id,
      content: '商家B首页未读消息',
    })

    await loginAsMerchant(page, { phone: phoneB, password: passwordB, gotoPath: '/dashboard' })

    await expect(page.getByText(orderB.customer_name).first()).toBeVisible()
    await expect(page.getByText(orderA.customer_name)).toHaveCount(0)
    await expect(page.getByTestId('dashboard-today-orders-count')).toHaveText('1')
    await expect(page.getByTestId('dashboard-today-revenue')).toHaveText('0.00')
    await expect(page.getByTestId('dashboard-pending-count')).toHaveText('1')
    await expect(page.getByTestId('dashboard-messages-count')).toHaveText('1')
  })

  test('customers page stays scoped and searchable with many customer records', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()

    for (let index = 0; index < 12; index += 1) {
      const label = `Bulk Customer ${String(index + 1).padStart(2, '0')}`
      const customer = await createCustomerForMerchant({
        merchantId: merchant.id,
        name: label,
        points: 200 - index,
        orderCount: 1,
        totalSpent: 30 + index,
      })

      await createOrderForCustomer({
        merchantId: merchant.id,
        customerId: customer.id,
        phone: customer.phone ?? `1390000000${index}`,
        customerName: customer.name ?? label,
        amount: 30 + index,
        status: index % 2 === 0 ? 'completed' : 'pending',
      })
    }

    await loginAsMerchant(page, { phone, password, gotoPath: '/customers' })

    await expect(page.getByText('Bulk Customer 01')).toBeVisible()
    await expect(page.getByText('Bulk Customer 12')).toBeVisible()

    await page.getByRole('textbox').first().fill('Bulk Customer 09')
    await expect(page.getByText('Bulk Customer 09')).toBeVisible()
    await expect(page.getByText('Bulk Customer 01')).toHaveCount(0)

    await page.getByText('Bulk Customer 09').first().click()
    await expect(page.getByTestId(/^customer-order-row-/).first()).toBeVisible()
    await expect(page.getByText('Bulk Customer 12')).toHaveCount(0)
  })
})
