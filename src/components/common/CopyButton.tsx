'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface CopyButtonProps {
  text: string
  initialLabel?: string
  successLabel?: string
  className?: string
  size?: "default" | "sm" | "lg" | "icon"
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
}

export default function CopyButton({
  text,
  initialLabel = "复制",
  successLabel = "已复制",
  className,
  size = "sm",
  variant = "outline"
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = (textToCopy: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(textToCopy)
        .then(() => handleSuccess())
        .catch(() => handleFallback(textToCopy))
    } else {
      handleFallback(textToCopy)
    }
  }

  const handleFallback = (textToCopy: string) => {
    const textArea = document.createElement('textarea')
    textArea.value = textToCopy
    textArea.style.position = 'fixed'
    textArea.style.left = '-999999px'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    try {
      document.execCommand('copy')
      handleSuccess()
    } catch {
      toast.error('复制失败，请手动选择复制')
    }
    document.body.removeChild(textArea)
  }

  const handleSuccess = () => {
    setCopied(true)
    toast.success(`${successLabel}到剪贴板`)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button
      variant={copied ? "default" : variant}
      size={size}
      onClick={(e) => {
        e.stopPropagation()
        copyToClipboard(text)
      }}
      className={cn(
        "rounded-full font-black text-xs transition-all duration-300",
        copied 
          ? "bg-emerald-500 hover:bg-emerald-600 border-none px-4 shadow-lg shadow-emerald-200" 
          : "bg-white shadow-sm",
        className
      )}
    >
      {copied ? <Check size={14} className="mr-1.5 animate-in zoom-in duration-300" /> : <Copy size={13} className="mr-1.5" />}
      {copied ? successLabel : initialLabel}
    </Button>
  )
}
