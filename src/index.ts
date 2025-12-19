// Context Jar Plugin - Main entry point
// Prevents stacked stale reads from confusing future edits.

import type { Plugin } from "@opencode-ai/plugin"
import { loadWhitelistConfig, createWhitelistConfig } from "./config"
import { shouldSkipContextCleanup } from "./whitelist"
import { cleanupMessagesForContextJar } from "./cleanup"
import { finalizeEditedFilesForNextStep } from "./finalize"
import { createTaskInvalidationTracker } from "./task-invalidation"
import { createStatsTracker } from "./stats"
import { buildIdleSummary, sendIgnoredSummary } from "./summary"
import { modelKey, type ChatMessage } from "./types"

function inferModelFromMessages(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.info?.role === "user" && msg.info.model) {
      return modelKey(msg.info.model)
    }
  }
  return undefined
}

export const ContextJarPlugin: Plugin = async (ctx) => {
  let whitelistConfig = loadWhitelistConfig()
  if (!whitelistConfig) {
    createWhitelistConfig()
    whitelistConfig = loadWhitelistConfig()
  }

  const invalidationTracker = createTaskInvalidationTracker({
    client: ctx.client,
    directory: ctx.directory,
    worktreeRoot: ctx.worktree,
  })

  const statsTracker = createStatsTracker()
  const idleInFlight = new Set<string>()
  const pendingFinalize = new Set<string>()
  const sessionContext = new Map<
    string,
    {
      agent?: string
      model?: { providerID: string; modelID: string }
    }
  >()

  function inferSessionID(messages: ChatMessage[]): string | undefined {
    for (const msg of messages) {
      const sid = msg?.info?.sessionID
      if (typeof sid === "string" && sid.length > 0) return sid
    }
    return undefined
  }

  function inferAgentModel(messages: ChatMessage[]): {
    agent?: string
    model?: { providerID: string; modelID: string }
  } {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg?.info?.role !== "user") continue
      const model = msg.info.model
      return {
        agent: msg.info.agent,
        model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
      }
    }
    return {}
  }

  return {
    event: async ({ event }) => {
      const isIdle =
        (event.type === "session.status" && event.properties.status.type === "idle") || event.type === "session.idle"
      if (!isIdle) return

      const sessionID = event.properties.sessionID

      // Mark for finalization on the next model step.
      pendingFinalize.add(sessionID)

      if (!statsTracker.shouldReportOnIdle(sessionID)) return

      const stats = statsTracker.get(sessionID)
      if (!stats) return

      if (idleInFlight.has(sessionID)) return
      idleInFlight.add(sessionID)
      try {
        const ctxInfo = sessionContext.get(sessionID)
        const ok = await sendIgnoredSummary({
          client: ctx.client,
          sessionID,
          // DCP omits directory; keep consistent.
          directory: undefined,
          agent: ctxInfo?.agent,
          model: ctxInfo?.model,
          text: buildIdleSummary(stats),
        })
        if (ok) {
          statsTracker.markReported(sessionID)
        }
      } finally {
        idleInFlight.delete(sessionID)
      }
    },

    "tool.execute.after": async (input, output) => {
      if (input.tool !== "task") return
      await invalidationTracker.onTaskToolAfter({ sessionID: input.sessionID }, { metadata: output.metadata })
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      const messages = output.messages as ChatMessage[]
      const activeModel = inferModelFromMessages(messages)

      if (whitelistConfig && shouldSkipContextCleanup(activeModel, whitelistConfig)) {
        return
      }

      if (!whitelistConfig) return

      const sessionID = inferSessionID(messages)
      if (!sessionID) return

      sessionContext.set(sessionID, inferAgentModel(messages))

      const invalidated = invalidationTracker.getInvalidatedFiles(sessionID)

      const delta = pendingFinalize.has(sessionID)
        ? finalizeEditedFilesForNextStep(messages, whitelistConfig, invalidated)
        : cleanupMessagesForContextJar(messages, whitelistConfig, invalidated)

      pendingFinalize.delete(sessionID)
      statsTracker.record(sessionID, delta)
    },
  }
}
