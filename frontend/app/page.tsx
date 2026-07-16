import { AppSidebar } from '@/components/app-sidebar'
import { ModelsView } from '@/components/models-view'

export default function Page() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <AppSidebar />

      <main className="flex flex-1 flex-col">
        <header className="flex items-center border-b border-border px-6 py-4">
          <h1 className="text-lg font-semibold tracking-tight">MyCrew</h1>
        </header>

        <div className="flex-1 p-6">
          <ModelsView />
        </div>
      </main>
    </div>
  )
}
