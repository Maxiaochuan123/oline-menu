import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '在线点餐',
  description: '轻松点菜，美味送达',
}

import { ToastProvider } from '@/components/common/Toast'
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" className={cn("font-sans", geist.variable)}>
      <body>
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  )
}
