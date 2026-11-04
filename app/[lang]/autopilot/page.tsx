import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AutopilotConsole } from '@/src/components/Autopilot/AutopilotConsole'

export const metadata: Metadata = { title: 'Rules' }

export default function AutopilotPage() {
  return (
    <Suspense>
      <AutopilotConsole />
    </Suspense>
  )
}
