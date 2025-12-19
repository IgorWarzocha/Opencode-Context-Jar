// Session stats tracking for Context Jar
//
// Tracks per-session token deltas continuously and provides a snapshot for
// emitting summaries on session idle.

export type StepTokenDelta = {
  tokensBefore: number
  tokensAfter: number

  readTokensBefore: number
  readTokensAfter: number

  editTokensBefore: number
  editTokensAfter: number

  invalidatedTokensBefore: number

  filesConsolidated: number
  filesInvalidated: number
}

export type SessionTokenStats = {
  sessionID: string
  total: StepTokenDelta
  lastStep: StepTokenDelta
  lastUpdatedAt: number
  lastReportedAt?: number
  lastReportedNetDelta?: number
}

function zeroDelta(): StepTokenDelta {
  return {
    tokensBefore: 0,
    tokensAfter: 0,
    readTokensBefore: 0,
    readTokensAfter: 0,
    editTokensBefore: 0,
    editTokensAfter: 0,
    invalidatedTokensBefore: 0,
    filesConsolidated: 0,
    filesInvalidated: 0,
  }
}

export function netDelta(delta: StepTokenDelta): number {
  return delta.tokensBefore - delta.tokensAfter
}

export type StatsTracker = {
  record(sessionID: string, delta: StepTokenDelta): SessionTokenStats
  get(sessionID: string): SessionTokenStats | undefined
  shouldReportOnIdle(sessionID: string): boolean
  markReported(sessionID: string): void
}

export function createStatsTracker(): StatsTracker {
  const bySession = new Map<string, SessionTokenStats>()

  return {
    record(sessionID, delta) {
      const prev = bySession.get(sessionID)
      const now = Date.now()

      // Important: do NOT accumulate deltas over time.
      // Consolidation is stateful (the prompt ends up with one read per file), so
      // summing per-step "before/after" would double-count the same content.
      const next: SessionTokenStats = {
        sessionID,
        total: delta,
        lastStep: delta,
        lastUpdatedAt: now,
        lastReportedAt: prev?.lastReportedAt,
        lastReportedNetDelta: prev?.lastReportedNetDelta,
      }

      bySession.set(sessionID, next)
      return next
    },

    get(sessionID) {
      return bySession.get(sessionID)
    },

    shouldReportOnIdle(sessionID) {
      const stats = bySession.get(sessionID)
      if (!stats) return false

      // Report once after new activity since last report.
      if (!stats.lastReportedAt) return true
      return stats.lastUpdatedAt > stats.lastReportedAt
    },

    markReported(sessionID) {
      const stats = bySession.get(sessionID)
      if (!stats) return

      bySession.set(sessionID, {
        ...stats,
        lastReportedAt: Date.now(),
        lastReportedNetDelta: netDelta(stats.total),
      })
    },
  }
}

export const ZERO_STEP_DELTA: StepTokenDelta = zeroDelta()
