/**
 * This build is the vandarii/core fork. The update flow downloads releases from
 * sleepypod/core, which would replace the fork with stock sleepypod, so it stays
 * off here and new builds arrive through ./scripts/deploy. scripts/bin/sp-update
 * carries the same block for anything that reaches it without this server.
 */
export const STOCK_UPDATES_BLOCKED: boolean = true

export const STOCK_UPDATES_BLOCKED_MESSAGE
  = 'This Pod runs a custom sleepypod build. Installing an update would replace it with stock sleepypod, so updates are off here. Deploy new builds with ./scripts/deploy from your computer.'
