import type { Metadata } from 'next'
import { Suspense } from 'react'
import { SleepSessionPage } from '@/src/components/SleepSession/SleepSessionPage'

export const metadata: Metadata = { title: 'Autopilot' }

export default function SessionsPage() {
  return (
    <Suspense>
      <SleepSessionPage />
    </Suspense>
  )
}
