import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '在线点餐',
  description: '轻松点菜，美味送达',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
