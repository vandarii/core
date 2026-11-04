/**
 * On the fork the card reports the running build but offers no way to install
 * a stock release: no update button, no channel picker.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/src/utils/trpc', () => {
  const mutation = { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) }
  return { trpc: {
    useUtils: () => ({ system: { internetStatus: { fetch: vi.fn(), invalidate: vi.fn() }, getVersion: { fetch: vi.fn() } } }),
    system: {
      getVersion: { useQuery: () => ({ isLoading: false, data: { branch: 'feat/sleep-sessions', commitHash: 'abc1234', commitTitle: 'title', buildDate: '2026-11-04T07:46:57.727Z' } }) },
      triggerUpdate: mutation,
      setInternetAccess: mutation,
    },
  } }
})

import { UpdateCard } from '../UpdateCard'
import { STOCK_UPDATES_BLOCKED_MESSAGE } from '@/src/lib/forkBuild'

describe('UpdateCard on the fork', () => {
  it.each([false, true])('explains deploys and hides update controls (compact: %s)', (compact) => {
    render(<UpdateCard compact={compact} />)
    expect(screen.getAllByText(STOCK_UPDATES_BLOCKED_MESSAGE).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /check|update/i })).toBeNull()
    expect(screen.queryByText('Update channel')).toBeNull()
  })
})
