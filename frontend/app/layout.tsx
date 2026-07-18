import type { Metadata } from 'next'
import { AuthProvider } from '@/lib/auth-context'
import { ToastProvider } from '@/components/ui/toaster'
import './globals.css'

export const metadata: Metadata = {
  title: 'MyCrew',
  description: 'Gerenciamento de modelos de IA',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="min-h-screen bg-background font-sans antialiased">
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
