// Summary message emission for Context Jar
//
// Sends an ignored, no-reply message to the session on idle showing token
// deltas from consolidation. This mirrors DCP's approach but reports
// read/edit consolidation.

import { estimateTokens } from "./token"
import { netDelta, type SessionTokenStats } from "./stats"
import { sendIgnoredSessionText } from "./opencode-client"

function formatTokenCount(tokens: number): string {
  const abs = Math.abs(tokens)
  if (abs >= 1000) {
    const k = (abs / 1000).toFixed(1).replace(".0", "")
    return `${k}K tokens`
  }
  return `${abs} tokens`
}

function formatNet(prefix: string, before: number, after: number): string {
  const net = before - after
  const label = net >= 0 ? `~${formatTokenCount(net)} saved` : `~${formatTokenCount(net)} added`
  return `${prefix}: ~${formatTokenCount(before)} → ~${formatTokenCount(after)} (${label})`
}

export function buildIdleSummary(stats: SessionTokenStats): string {
  const total = stats.total

  const invalidated =
    total.invalidatedTokensBefore > 0 ? ` (~${formatTokenCount(total.invalidatedTokensBefore)} invalidated)` : ""

  return [
    `▣ Context Jar | latest consolidation snapshot`,
    formatNet("▣ Total", total.tokensBefore, total.tokensAfter),
    formatNet("▣ Read", total.readTokensBefore, total.readTokensAfter),
    formatNet("▣ Edit", total.editTokensBefore, total.editTokensAfter) + invalidated,
    `▣ Files: ${total.filesConsolidated} consolidated, ${total.filesInvalidated} invalidated`,
    `▣ Net: ${netDelta(total) >= 0 ? "saved" : "added"}`,
  ].join("\n")
}

export async function sendIgnoredSummary(input: {
  client: any
  sessionID: string
  directory?: string
  agent?: string
  model?: { providerID: string; modelID: string }
  text: string
}): Promise<boolean> {
  return sendIgnoredSessionText({
    client: input.client,
    sessionID: input.sessionID,
    directory: input.directory,
    agent: input.agent,
    model: input.model,
    text: input.text,
  })
}

// Keep the tokenizer referenced to avoid tree-shaking edge cases.
export function _tokenizerHealthcheck(): number {
  return estimateTokens("hello")
}
