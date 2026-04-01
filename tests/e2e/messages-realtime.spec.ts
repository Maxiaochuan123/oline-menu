import { expect, test } from '@playwright/test'

import { loginAsMerchant } from './helpers/auth'
import {
  createCustomerMessage,
  createCustomerOrder,
  createMerchantAccount,
  createMerchantMessage,
  getMessageById,
  getMessagesByOrder,
  updateOrder,
} from './helpers/supabase'

const POLL_TIMEOUT_MS = 15_000

async function openOrderFromOrdersPageById(
  page: import('@playwright/test').Page,
  phone: string,
  orderId: string,
) {
  await page.goto('/orders')
  const phoneRow = page.getByTestId(`orders-phone-group-${phone}`).first()
  await expect(phoneRow).toBeVisible({ timeout: POLL_TIMEOUT_MS })
  await phoneRow.click()

  const orderRow = page.getByTestId(`orders-order-row-${orderId}`).first()
  await expect(orderRow).toBeVisible({ timeout: POLL_TIMEOUT_MS })
  await orderRow.click()
  await expect(page.getByTestId('merchant-order-modal')).toBeVisible()
}

async function expectDashboardMessagesCount(
  page: import('@playwright/test').Page,
  expected: string,
) {
  await page.goto('/dashboard')
  await expect(page.getByText('管理快捷入口')).toBeVisible({ timeout: POLL_TIMEOUT_MS })
  await expect
    .poll(async () => {
      const badge = page.getByTestId('dashboard-messages-count')
      if ((await badge.count()) === 0) return '0'
      return (await badge.first().textContent())?.trim() ?? ''
    }, { timeout: POLL_TIMEOUT_MS })
    .toBe(expected)
}

test.describe('message realtime flows', () => {
  test.setTimeout(90_000)

  test('messages page shows unread customer message and marks it as read when opened', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 39)

    const customerMessage = await createCustomerMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '你好，订单到了吗？',
    })

    await loginAsMerchant(page, { phone, password })
    await page.goto('/messages')

    await expect(page.getByText('1 未读')).toBeVisible({ timeout: POLL_TIMEOUT_MS })
    await expect(page.getByText(order.customer_name)).toBeVisible({ timeout: POLL_TIMEOUT_MS })
    await expect(page.getByText('你好，订单到了吗？')).toBeVisible({ timeout: POLL_TIMEOUT_MS })

    await page.getByText(order.customer_name).click()
    await expect(page.getByRole('button', { name: '查看订单' })).toBeVisible()

    await expect
      .poll(async () => getMessageById(customerMessage.id), {
        message: 'expected customer message to be marked as read after merchant opens the conversation',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_merchant: true,
      })

    await expect(page.getByText('1 未读')).toHaveCount(0)
  })

  test('dashboard unread badge updates when customer message arrives and clears after opening order detail', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 42)

    await loginAsMerchant(page, { phone, password })
    await page.goto('/dashboard')

    await expectDashboardMessagesCount(page, '0')

    const customerMessage = await createCustomerMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '麻烦尽快处理一下',
    })

    await expectDashboardMessagesCount(page, '1')
    await expect(page.getByText(order.customer_name)).toBeVisible({ timeout: POLL_TIMEOUT_MS })

    await page.getByText(order.customer_name).click()
    await expect(page.getByTestId('merchant-order-modal')).toBeVisible()

    await expect
      .poll(async () => getMessageById(customerMessage.id), {
        message: 'expected dashboard order detail to mark the customer message as read',
        timeout: 30_000,
      })
      .toMatchObject({
        is_read_by_merchant: true,
      })

    await expectDashboardMessagesCount(page, '0')
  })

  test('reading one conversation on messages page keeps the other unread and syncs dashboard count', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order: firstOrder } = await createCustomerOrder(merchant.id, 38)
    const { order: secondOrder } = await createCustomerOrder(merchant.id, 44)

    const firstMessage = await createCustomerMessage({
      orderId: firstOrder.id,
      merchantId: merchant.id,
      content: '第一条未读消息',
    })
    const secondMessage = await createCustomerMessage({
      orderId: secondOrder.id,
      merchantId: merchant.id,
      content: '第二条未读消息',
    })

    await loginAsMerchant(page, { phone, password })
    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-messages-count')).toHaveText('2', { timeout: POLL_TIMEOUT_MS })

    await page.goto('/messages')
    await expect(page.getByText('2 未读')).toBeVisible({ timeout: POLL_TIMEOUT_MS })

    await page.getByText(firstOrder.customer_name).first().click()
    await expect(page.getByRole('button', { name: '查看订单' })).toBeVisible()

    await expect
      .poll(async () => Promise.all([getMessageById(firstMessage.id), getMessageById(secondMessage.id)]), {
        message: 'expected reading one conversation to mark only that message as read',
        timeout: POLL_TIMEOUT_MS,
      })
      .toEqual([
        expect.objectContaining({ is_read_by_merchant: true }),
        expect.objectContaining({ is_read_by_merchant: false }),
      ])

    await expect(page.getByText('1 未读')).toBeVisible()

    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-messages-count')).toHaveText('1', { timeout: POLL_TIMEOUT_MS })
  })

  test('opening order modal from orders page marks the customer message as read and clears dashboard badge', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 41)

    const customerMessage = await createCustomerMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '订单页弹窗已读联动测试',
    })

    await loginAsMerchant(page, { phone, password })
    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-messages-count')).toHaveText('1', { timeout: POLL_TIMEOUT_MS })

    await openOrderFromOrdersPageById(page, order.phone, order.id)

    await expect
      .poll(async () => getMessageById(customerMessage.id), {
        message: 'expected opening order modal from orders page to mark the customer message as read',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_merchant: true,
      })

    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-messages-count')).toHaveCount(0)
  })

  test('a new customer message becomes unread again after the previous conversation was already read', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 43)

    const firstMessage = await createCustomerMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '第一条消息已读后再次来新消息测试',
    })

    await loginAsMerchant(page, { phone, password })
    await page.goto('/messages')

    await expect(page.getByText('1 未读')).toBeVisible({ timeout: POLL_TIMEOUT_MS })
    await page.getByText(order.customer_name).first().click()

    await expect
      .poll(async () => getMessageById(firstMessage.id), {
        message: 'expected the first customer message to be marked as read',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_merchant: true,
      })

    await expect(page.getByText('1 未读')).toHaveCount(0)
    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-messages-count')).toHaveCount(0)

    const secondMessage = await createCustomerMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '第二条新消息应该重新计入未读',
    })

    await expectDashboardMessagesCount(page, '1')

    await page.goto('/messages')
    await expect(page.getByText('1 未读')).toBeVisible({ timeout: POLL_TIMEOUT_MS })
    await expect(page.getByText('第二条新消息应该重新计入未读')).toBeVisible({ timeout: POLL_TIMEOUT_MS })

    await expect
      .poll(async () => getMessageById(secondMessage.id), {
        message: 'expected the new customer message to stay unread until merchant opens it',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_merchant: false,
      })
  })

  test('two new customer messages after a read conversation accumulate unread counts correctly', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 45)

    const firstMessage = await createCustomerMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '已读后的累计未读测试首条消息',
    })

    await loginAsMerchant(page, { phone, password })
    await page.goto('/messages')
    await expect(page.getByText('1 未读')).toBeVisible({ timeout: POLL_TIMEOUT_MS })

    await page.getByText(order.customer_name).first().click()
    await expect
      .poll(async () => getMessageById(firstMessage.id), {
        message: 'expected the seed message to be marked as read before testing accumulation',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_merchant: true,
      })

    await expect(page.getByText('1 未读')).toHaveCount(0)
    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-messages-count')).toHaveCount(0)

    const [secondMessage, thirdMessage] = await Promise.all([
      createCustomerMessage({
        orderId: order.id,
        merchantId: merchant.id,
        content: '累计未读第二条消息',
      }),
      createCustomerMessage({
        orderId: order.id,
        merchantId: merchant.id,
        content: '累计未读第三条消息',
      }),
    ])

    await expectDashboardMessagesCount(page, '2')

    await page.goto('/messages')
    await expect(page.getByText('2 未读')).toBeVisible({ timeout: POLL_TIMEOUT_MS })

    await expect
      .poll(async () => Promise.all([getMessageById(secondMessage.id), getMessageById(thirdMessage.id)]), {
        message: 'expected both new customer messages to remain unread until merchant opens the conversation again',
        timeout: POLL_TIMEOUT_MS,
      })
      .toEqual([
        expect.objectContaining({ is_read_by_merchant: false }),
        expect.objectContaining({ is_read_by_merchant: false }),
      ])
  })

  test('merchant reply becomes read after customer opens the order page', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 46)

    await updateOrder(order.id, {
      status: 'preparing',
    })

    const merchantMessage = await createMerchantMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '已经在安排出餐了，请稍等。',
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)
    await expect(page.getByText('已经在安排出餐了，请稍等。')).toBeVisible({ timeout: POLL_TIMEOUT_MS })

    await expect
      .poll(async () => getMessageById(merchantMessage.id), {
        message: 'expected merchant reply to be marked as read after customer opens the order page',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_customer: true,
      })
  })

  test('merchant follow-up after after-sales resolved becomes read after customer opens the order page', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 47)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'resolved',
      refund_amount: 12,
    })

    const merchantMessage = await createMerchantMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '售后已经处理完成，如有需要欢迎继续联系',
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)
    await expect(page.getByText(merchantMessage.content)).toBeVisible({ timeout: POLL_TIMEOUT_MS })

    await expect
      .poll(async () => getMessageById(merchantMessage.id), {
        message: 'expected merchant follow-up after after-sales resolved to be marked as read after customer opens the order page',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_customer: true,
      })
  })

  test('merchant follow-up after after-sales rejected becomes read after customer opens the order page', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 48)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'rejected',
      after_sales_reason: '售后已驳回继续沟通',
    })

    const merchantMessage = await createMerchantMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '这次先按驳回处理，如需补充可继续留言',
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    await expect
      .poll(async () => getMessageById(merchantMessage.id), {
        message: 'expected merchant follow-up after after-sales rejected to be marked as read after customer opens the order page',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_customer: true,
      })
  })

  test('merchant follow-up after a completed order without after-sales becomes read after customer opens the order page', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 49)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'none',
    })

    const merchantMessage = await createMerchantMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '订单已经完成，如有补充反馈欢迎继续留言',
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    await expect
      .poll(async () => getMessageById(merchantMessage.id), {
        message: 'expected merchant follow-up after a completed order without after-sales to be marked as read after customer opens the order page',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_customer: true,
      })
  })

  test('customer rating messages also count as unread until the merchant opens the conversation', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 47)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'rejected',
    })

    const ratingMessage = await createCustomerMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '客户评了 5 星',
      rating: 5,
    })

    await loginAsMerchant(page, { phone, password })
    await expectDashboardMessagesCount(page, '1')

    await page.goto('/messages')
    await expect(page.getByText('1 未读')).toBeVisible({ timeout: POLL_TIMEOUT_MS })
    await expect(page.getByText('客户评了 5 星')).toBeVisible({ timeout: POLL_TIMEOUT_MS })

    await page.getByText(order.customer_name).first().click()

    await expect
      .poll(async () => getMessageById(ratingMessage.id), {
        message: 'expected customer rating message to be marked as read after merchant opens the conversation',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_merchant: true,
        rating: 5,
      })

    await expect(page.getByText('1 未读')).toHaveCount(0)
    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-messages-count')).toHaveCount(0)
  })

  test('customer quick rating after after-sales resolved creates an unread rating record for the merchant', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 48)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'resolved',
      refund_amount: 20,
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)
    const ratingPanel = page.getByText('本次服务还满意吗？请评价')
    await expect(ratingPanel).toBeVisible()

    const ratingButtons = ratingPanel.locator('xpath=..').locator('button')
    await ratingButtons.nth(2).click()

    await expect
      .poll(async () => getMessagesByOrder(order.id), {
        message: 'expected resolved after-sales quick rating to create an unread customer rating message',
        timeout: POLL_TIMEOUT_MS,
      })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sender: 'customer',
            content: '客户评了 3 星 ⭐',
            rating: 3,
            is_read_by_merchant: false,
            is_read_by_customer: true,
          }),
        ]),
      )
  })

  test('customer quick rating after after-sales rejected creates an unread rating record for the merchant', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 49)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'rejected',
      after_sales_reason: '售后已驳回后评分',
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)
    const ratingPanel = page.getByText('本次服务还满意吗？请评价')
    await expect(ratingPanel).toBeVisible()

    const ratingButtons = ratingPanel.locator('xpath=..').locator('button')
    await ratingButtons.nth(1).click()

    await expect
      .poll(async () => getMessagesByOrder(order.id), {
        message: 'expected rejected after-sales quick rating to create an unread customer rating message',
        timeout: POLL_TIMEOUT_MS,
      })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sender: 'customer',
            content: '客户评了 2 星 ⭐',
            rating: 2,
            is_read_by_merchant: false,
            is_read_by_customer: true,
          }),
        ]),
      )
  })

  test('dashboard order detail also clears unread rating messages', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 48)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'resolved',
      refund_amount: 12,
    })

    const ratingMessage = await createCustomerMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '客户评了 4 星',
      rating: 4,
    })

    await loginAsMerchant(page, { phone, password })
    await expectDashboardMessagesCount(page, '1')
    await expect(page.getByText(order.customer_name)).toBeVisible({ timeout: POLL_TIMEOUT_MS })

    await page.getByText(order.customer_name).click()
    await expect(page.getByTestId('merchant-order-modal')).toBeVisible()

    await expect
      .poll(async () => getMessageById(ratingMessage.id), {
        message: 'expected dashboard order modal to mark the customer rating message as read',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_merchant: true,
        rating: 4,
      })

    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-messages-count')).toHaveCount(0)
  })

  test('customer follow-up after after-sales resolved also clears from the dashboard order modal', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 49)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'resolved',
      refund_amount: 14,
    })

    const customerMessage = await createCustomerMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '售后已处理完，我再补充一下后续情况',
    })

    await loginAsMerchant(page, { phone, password })
    await expectDashboardMessagesCount(page, '1')
    await expect(page.getByText(order.customer_name)).toBeVisible({ timeout: POLL_TIMEOUT_MS })

    await page.getByText(order.customer_name).click()
    await expect(page.getByTestId('merchant-order-modal')).toBeVisible()

    await expect
      .poll(async () => getMessageById(customerMessage.id), {
        message: 'expected resolved after-sales customer follow-up to be marked as read from the dashboard modal',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_merchant: true,
      })

    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-messages-count')).toHaveCount(0)
  })

  test('customer follow-up after a completed order without after-sales also clears from the dashboard order modal', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 50)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'none',
    })

    const customerMessage = await createCustomerMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '订单已完成，我从首页入口再补充一下体验',
    })

    await loginAsMerchant(page, { phone, password })
    await expectDashboardMessagesCount(page, '1')
    await expect(page.getByText(order.customer_name)).toBeVisible({ timeout: POLL_TIMEOUT_MS })

    await page.getByText(order.customer_name).click()
    await expect(page.getByTestId('merchant-order-modal')).toBeVisible()

    await expect
      .poll(async () => getMessageById(customerMessage.id), {
        message: 'expected completed order customer follow-up without after-sales to be marked as read from the dashboard modal',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_merchant: true,
      })

    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-messages-count')).toHaveCount(0)
  })

  test('customer follow-up after a completed order without after-sales still becomes unread and clears from the orders modal', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 50)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'none',
    })

    const customerMessage = await createCustomerMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '订单已完成，我补充一下整体体验',
    })

    await loginAsMerchant(page, { phone, password })
    await expectDashboardMessagesCount(page, '1')

    await openOrderFromOrdersPageById(page, order.phone, order.id)

    await expect
      .poll(async () => getMessageById(customerMessage.id), {
        message: 'expected completed order customer follow-up without after-sales to be marked as read from the orders modal',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_merchant: true,
      })

    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-messages-count')).toHaveCount(0)
  })

  test('customer follow-up after a completed order without after-sales also clears from the messages page', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 51)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'none',
    })

    const customerMessage = await createCustomerMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '订单完成后我从消息页继续补充一点反馈',
    })

    await loginAsMerchant(page, { phone, password })
    await expectDashboardMessagesCount(page, '1')

    await page.goto('/messages')
    await expect(page.getByText('1 未读')).toBeVisible({ timeout: POLL_TIMEOUT_MS })
    await page.getByText(order.customer_name).first().click()
    await expect(page.getByRole('button', { name: '查看订单' })).toBeVisible()

    await expect
      .poll(async () => getMessageById(customerMessage.id), {
        message: 'expected completed order customer follow-up without after-sales to be marked as read from the messages page',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_merchant: true,
      })

    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-messages-count')).toHaveCount(0)
  })

  test('orders page modal also clears unread rating messages', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 49)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'resolved',
      refund_amount: 14,
    })

    const ratingMessage = await createCustomerMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '客户评了 3 星',
      rating: 3,
    })

    await loginAsMerchant(page, { phone, password })
    await expectDashboardMessagesCount(page, '1')

    await openOrderFromOrdersPageById(page, order.phone, order.id)

    await expect
      .poll(async () => getMessageById(ratingMessage.id), {
        message: 'expected orders page modal to mark the customer rating message as read',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_merchant: true,
        rating: 3,
      })

    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-messages-count')).toHaveCount(0)
  })

  test('customer follow-up after after-sales resolved still becomes unread and clears from the orders modal', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 50)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'resolved',
      refund_amount: 15,
    })

    const customerMessage = await createCustomerMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '谢谢处理，后续如果有问题我再联系',
    })

    await loginAsMerchant(page, { phone, password })
    await expectDashboardMessagesCount(page, '1')

    await openOrderFromOrdersPageById(page, order.phone, order.id)

    await expect
      .poll(async () => getMessageById(customerMessage.id), {
        message: 'expected resolved after-sales customer follow-up to be marked as read from the orders modal',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_merchant: true,
      })

    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-messages-count')).toHaveCount(0)
  })

  test('customer follow-up after after-sales rejected still becomes unread and clears from the orders modal', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 51)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'rejected',
      after_sales_reason: '售后已驳回但继续沟通',
    })

    const customerMessage = await createCustomerMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '我再补充一下售后细节，麻烦帮我看下',
    })

    await loginAsMerchant(page, { phone, password })
    await expectDashboardMessagesCount(page, '1')

    await openOrderFromOrdersPageById(page, order.phone, order.id)

    await expect
      .poll(async () => getMessageById(customerMessage.id), {
        message: 'expected rejected after-sales customer follow-up to be marked as read from the orders modal',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_merchant: true,
      })

    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-messages-count')).toHaveCount(0)
  })

  test('customer follow-up after after-sales rejected also clears from the dashboard order modal', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 52)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'rejected',
      after_sales_reason: '售后已驳回但首页入口继续沟通',
    })

    const customerMessage = await createCustomerMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '我从被驳回的售后继续补充一下情况',
    })

    await loginAsMerchant(page, { phone, password })
    await expectDashboardMessagesCount(page, '1')
    await expect(page.getByText(order.customer_name)).toBeVisible({ timeout: POLL_TIMEOUT_MS })

    await page.getByText(order.customer_name).click()
    await expect(page.getByTestId('merchant-order-modal')).toBeVisible()

    await expect
      .poll(async () => getMessageById(customerMessage.id), {
        message: 'expected rejected after-sales customer follow-up to be marked as read from the dashboard modal',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_merchant: true,
      })

    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-messages-count')).toHaveCount(0)
  })

  test('messages page stays usable with many unread conversations', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()

    const seededOrders: Array<{ id: string; customerName: string; messageId: string }> = []
    for (let index = 0; index < 12; index += 1) {
      const { order } = await createCustomerOrder(merchant.id, 80 + index)
      const customerName = `Bulk Customer ${String(index + 1).padStart(2, '0')}`
      await updateOrder(order.id, { customer_name: customerName })
      const message = await createCustomerMessage({
        orderId: order.id,
        merchantId: merchant.id,
        content: `bulk unread message ${index + 1}`,
      })
      seededOrders.push({ id: order.id, customerName, messageId: message.id })
    }

    const targetConversation = seededOrders[7]

    await loginAsMerchant(page, { phone, password })
    await expectDashboardMessagesCount(page, '12')
    await page.goto('/messages')

    await expect(page.getByText(targetConversation.customerName)).toBeVisible({ timeout: POLL_TIMEOUT_MS })

    await page.getByText(targetConversation.customerName).click()
    await expect(page.getByTestId('messages-view-order-button')).toBeVisible({ timeout: POLL_TIMEOUT_MS })

    await expect
      .poll(async () => getMessageById(targetConversation.messageId), {
        message: 'expected the selected unread conversation to be marked as read in a long message list',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        is_read_by_merchant: true,
      })

    await expectDashboardMessagesCount(page, '11')
  })
})
