import { expect, test } from '@playwright/test'

import {
  createCustomerMessage,
  createCustomerOrder,
  createMerchantAccount,
  getMessagesByOrder,
  updateOrder,
} from './helpers/supabase'

const POLL_TIMEOUT_MS = 15_000
test.describe.configure({ timeout: 45_000 })

async function loginAsMerchant(page: import('@playwright/test').Page, phone: string, password: string) {
  await page.goto('/login')
  await page.locator('input[type="tel"]').fill(phone)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('form button[type="submit"]').click()
  await page.waitForURL(/\/dashboard$/)
}

async function openOrderFromOrdersPage(
  page: import('@playwright/test').Page,
  phone: string,
  lastFourPhoneDigits: string,
) {
  await page.goto('/orders')
  await page.getByText(phone).click()
  await page.getByText(new RegExp(`尾号\\s*${lastFourPhoneDigits}\\s*订单`)).click()
  await expect(page.getByText('订单详情')).toBeVisible()
}

test.describe('order chat interactions', () => {
  test('cancelled order hides the customer chat box entirely', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 42)

    await updateOrder(order.id, {
      status: 'cancelled',
      cancelled_by: 'customer',
      cancelled_at: new Date().toISOString(),
      after_sales_status: 'none',
    })

    await createCustomerMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '取消后的历史消息',
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    await expect(page.getByTestId('order-chat-box')).toHaveCount(0)
    await expect(page.getByTestId('customer-order-chat-input')).toHaveCount(0)
    await expect(page.getByTestId('customer-order-chat-send')).toHaveCount(0)
    await expect(page.getByText('取消后的历史消息')).toHaveCount(0)
  })

  test('cancelled order keeps chat history visible but hides merchant input', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 44)

    await updateOrder(order.id, {
      status: 'cancelled',
      cancelled_by: 'customer',
      cancelled_at: new Date().toISOString(),
      after_sales_status: 'none',
    })

    await createCustomerMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '取消前的沟通记录',
    })

    await loginAsMerchant(page, phone, password)
    await openOrderFromOrdersPage(page, order.phone, order.phone.slice(-4))

    await expect(page.getByText('沟通与协商记录')).toBeVisible()
    await expect(page.getByText('取消前的沟通记录')).toBeVisible()
    await expect(page.getByTestId('merchant-order-chat-input')).toHaveCount(0)
    await expect(page.getByTestId('merchant-order-chat-send')).toHaveCount(0)
  })

  test('customer chat send button stays disabled for empty input and clears after sending', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 46)

    await updateOrder(order.id, {
      status: 'delivering',
      after_sales_status: 'none',
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    const input = page.getByTestId('customer-order-chat-input')
    const sendButton = page.getByTestId('customer-order-chat-send')

    await expect(sendButton).toBeDisabled()

    await input.fill('客户留言测试')
    await expect(sendButton).toBeEnabled()
    await sendButton.click()

    await expect(input).toHaveValue('')

    await expect
      .poll(async () => getMessagesByOrder(order.id), {
        message: 'expected customer chat send to create a normal message',
        timeout: POLL_TIMEOUT_MS,
      })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sender: 'customer',
            content: '客户留言测试',
            msg_type: 'normal',
          }),
        ]),
      )
  })

  test('customer can still send a follow-up message after after-sales has been resolved', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 50)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'resolved',
      refund_amount: 12,
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    const input = page.getByTestId('customer-order-chat-input')
    const sendButton = page.getByTestId('customer-order-chat-send')

    await expect(input).toBeVisible()
    await expect(sendButton).toBeDisabled()

    await input.fill('谢谢处理，后续有问题我再联系')
    await expect(sendButton).toBeEnabled()
    await sendButton.click()
    await expect(input).toHaveValue('')

    await expect
      .poll(async () => getMessagesByOrder(order.id), {
        message: 'expected customer follow-up message to be sent after after-sales resolved',
        timeout: POLL_TIMEOUT_MS,
      })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sender: 'customer',
            content: '谢谢处理，后续有问题我再联系',
            msg_type: 'normal',
          }),
        ]),
      )

  })

  test('customer can still send a follow-up message after after-sales has been rejected', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 52)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'rejected',
      after_sales_reason: '商家已驳回售后',
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    const input = page.getByTestId('customer-order-chat-input')
    const sendButton = page.getByTestId('customer-order-chat-send')

    await expect(input).toBeVisible()
    await expect(sendButton).toBeDisabled()

    await input.fill('我补充一下情况，麻烦再帮我看看')
    await expect(sendButton).toBeEnabled()
    await sendButton.click()
    await expect(input).toHaveValue('')

    await expect
      .poll(async () => getMessagesByOrder(order.id), {
        message: 'expected customer follow-up message to be sent after after-sales rejected',
        timeout: POLL_TIMEOUT_MS,
      })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sender: 'customer',
            content: '我补充一下情况，麻烦再帮我看看',
            msg_type: 'normal',
          }),
        ]),
      )

  })

  test('customer can still send a follow-up message after the order has been completed without after-sales', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 53)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'none',
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    const input = page.getByTestId('customer-order-chat-input')
    const sendButton = page.getByTestId('customer-order-chat-send')

    await expect(input).toBeVisible()
    await expect(sendButton).toBeDisabled()

    await input.fill('订单已完成，我再补充一下口味反馈')
    await expect(sendButton).toBeEnabled()
    await sendButton.click()
    await expect(input).toHaveValue('')

    await expect
      .poll(async () => getMessagesByOrder(order.id), {
        message: 'expected customer follow-up message to be sent after the order completed without after-sales',
        timeout: POLL_TIMEOUT_MS,
      })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sender: 'customer',
            content: '订单已完成，我再补充一下口味反馈',
            msg_type: 'normal',
          }),
        ]),
      )

  })

  test('merchant chat send button stays disabled for empty input and clears after sending', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 54)

    await updateOrder(order.id, {
      status: 'preparing',
      confirmed_at: new Date().toISOString(),
      after_sales_status: 'none',
    })

    await loginAsMerchant(page, phone, password)
    await openOrderFromOrdersPage(page, order.phone, order.phone.slice(-4))

    const input = page.getByTestId('merchant-order-chat-input')
    const sendButton = page.getByTestId('merchant-order-chat-send')

    await expect(sendButton).toBeDisabled()

    await input.fill('商家回复测试')
    await expect(sendButton).toBeEnabled()
    await sendButton.click()

    await expect
      .poll(async () => getMessagesByOrder(order.id), {
        message: 'expected merchant chat send to create a normal message',
        timeout: POLL_TIMEOUT_MS,
      })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sender: 'merchant',
            content: '商家回复测试',
            msg_type: 'normal',
          }),
        ]),
      )

    await expect(input).toHaveValue('')
  })

  test('merchant can still send a follow-up message after after-sales has been resolved', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 56)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'resolved',
      refund_amount: 16,
    })

    await loginAsMerchant(page, phone, password)
    await openOrderFromOrdersPage(page, order.phone, order.phone.slice(-4))

    const input = page.getByTestId('merchant-order-chat-input')
    const sendButton = page.getByTestId('merchant-order-chat-send')

    await expect(input).toBeVisible()
    await expect(sendButton).toBeDisabled()

    await input.fill('售后已完成，如还有问题可以继续联系我')
    await expect(sendButton).toBeEnabled()
    await sendButton.click()
    await expect(input).toHaveValue('')

    await expect
      .poll(async () => getMessagesByOrder(order.id), {
        message: 'expected merchant follow-up message to be sent after after-sales resolved',
        timeout: POLL_TIMEOUT_MS,
      })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sender: 'merchant',
            content: '售后已完成，如还有问题可以继续联系我',
            msg_type: 'normal',
          }),
        ]),
      )

  })

  test('merchant can still send a follow-up message after after-sales has been rejected', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 58)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'rejected',
      after_sales_reason: '售后已驳回，继续沟通',
    })

    await loginAsMerchant(page, phone, password)
    await openOrderFromOrdersPage(page, order.phone, order.phone.slice(-4))

    const input = page.getByTestId('merchant-order-chat-input')
    const sendButton = page.getByTestId('merchant-order-chat-send')

    await expect(input).toBeVisible()
    await expect(sendButton).toBeDisabled()

    await input.fill('如果需要补充信息，可以继续留言给我')
    await expect(sendButton).toBeEnabled()
    await sendButton.click()
    await expect(input).toHaveValue('')

    await expect
      .poll(async () => getMessagesByOrder(order.id), {
        message: 'expected merchant follow-up message to be sent after after-sales rejected',
        timeout: POLL_TIMEOUT_MS,
      })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sender: 'merchant',
            content: '如果需要补充信息，可以继续留言给我',
            msg_type: 'normal',
          }),
        ]),
      )

  })

  test('merchant can still send a follow-up message after the order has been completed without after-sales', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 57)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'none',
    })

    await loginAsMerchant(page, phone, password)
    await openOrderFromOrdersPage(page, order.phone, order.phone.slice(-4))

    const input = page.getByTestId('merchant-order-chat-input')
    const sendButton = page.getByTestId('merchant-order-chat-send')

    await expect(input).toBeVisible()
    await expect(sendButton).toBeDisabled()

    await input.fill('订单已完成，如需补充说明可以继续留言')
    await expect(sendButton).toBeEnabled()
    await sendButton.click()
    await expect(input).toHaveValue('')

    await expect
      .poll(async () => getMessagesByOrder(order.id), {
        message: 'expected merchant follow-up message to be sent after the order completed without after-sales',
        timeout: POLL_TIMEOUT_MS,
      })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sender: 'merchant',
            content: '订单已完成，如需补充说明可以继续留言',
            msg_type: 'normal',
          }),
        ]),
      )

  })

  test('merchant closing after-sales writes an after_sales_closed message', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 58)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'pending',
      after_sales_reason: '餐品有问题',
    })

    await loginAsMerchant(page, phone, password)
    await openOrderFromOrdersPage(page, order.phone, order.phone.slice(-4))

    await page.getByTestId('merchant-after-sales-handle-button').click()
    await page.getByRole('button', { name: '驳回售后' }).click()
    await page.getByRole('button', { name: '确认驳回' }).click()

    await expect
      .poll(async () => getMessagesByOrder(order.id), {
        message: 'expected closing after-sales to append an after_sales_closed message',
        timeout: POLL_TIMEOUT_MS,
      })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sender: 'merchant',
            msg_type: 'after_sales_closed',
          }),
        ]),
      )
  })

  test('completed order without after-sales closure does not show the quick rating panel yet', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 59)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'none',
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    await expect(page.getByText('本次服务还满意吗？请评价')).toHaveCount(0)
  })

  test('customer can submit a quick rating after after-sales has been resolved', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 60)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'resolved',
      refund_amount: 18,
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    const ratingPanel = page.getByText('本次服务还满意吗？请评价')
    await expect(ratingPanel).toBeVisible()

    const ratingButtons = ratingPanel.locator('xpath=..').locator('button')
    await expect(ratingButtons).toHaveCount(5)
    await ratingButtons.nth(4).click()

    await expect
      .poll(async () => getMessagesByOrder(order.id), {
        message: 'expected quick rating to append a customer rating message after after-sales resolved',
        timeout: POLL_TIMEOUT_MS,
      })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sender: 'customer',
            rating: 5,
          }),
        ]),
      )

    await page.reload()
    await expect(page.getByText('本次服务还满意吗？请评价')).toHaveCount(0)
  })

  test('customer can submit a quick rating after after-sales has been closed', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 62)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'rejected',
      after_sales_reason: '售后已关闭等待评价',
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    const ratingPanel = page.getByText('本次服务还满意吗？请评价')
    await expect(ratingPanel).toBeVisible()

    const ratingButtons = ratingPanel.locator('xpath=..').locator('button')
    await expect(ratingButtons).toHaveCount(5)
    await ratingButtons.nth(3).click()

    await expect
      .poll(async () => getMessagesByOrder(order.id), {
        message: 'expected quick rating to append a customer rating message after after-sales closed',
        timeout: POLL_TIMEOUT_MS,
      })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sender: 'customer',
            rating: 4,
          }),
        ]),
      )

    await page.reload()
    await expect(page.getByText('本次服务还满意吗？请评价')).toHaveCount(0)
  })

  test('existing customer rating keeps the quick rating panel hidden on reload', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 64)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'resolved',
      refund_amount: 10,
    })

    await createCustomerMessage({
      orderId: order.id,
      merchantId: merchant.id,
      content: '客户已经评分',
      rating: 5,
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    await expect(page.getByText('售后处理完毕')).toBeVisible()
    await expect(page.getByText('本次服务还满意吗？请评价')).toHaveCount(0)
    await expect(page.getByText('客户已经评分')).toBeVisible()
  })
})
