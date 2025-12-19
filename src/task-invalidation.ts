// Task invalidation logic for Context Jar
//
// When `tool: task` runs a subagent, the subagent may edit files. Those edits
// occur outside the main agent's immediate context, so any cached file reads in
// the main session become untrustworthy.
//
// This module tracks which files were modified by subagent sessions and exposes
// a per-parent-session invalidation set.

import { normalizeFilePath } from "./path-utils"
import { getSessionDiff } from "./opencode-client"

type SnapshotFileDiff = {
  file: string
  before?: string
  after?: string
  additions?: number
  deletions?: number
}

type SessionDiffResponse =
  | SnapshotFileDiff[]
  | {
      data?: SnapshotFileDiff[]
    }

function extractDiffs(resp: SessionDiffResponse | undefined): SnapshotFileDiff[] {
  if (!resp) return []
  if (Array.isArray(resp)) return resp
  if (Array.isArray(resp.data)) return resp.data
  return []
}

export type TaskInvalidationTracker = {
  getInvalidatedFiles(parentSessionID: string | undefined): ReadonlySet<string>
  onTaskToolAfter(input: { sessionID: string }, output: { metadata?: unknown }): Promise<void>
}

export function createTaskInvalidationTracker(input: {
  client: any
  directory?: string
  worktreeRoot?: string
}): TaskInvalidationTracker {
  const invalidatedByParentSession = new Map<string, Set<string>>()

  function addInvalidated(parentSessionID: string, filePaths: string[]) {
    const set = invalidatedByParentSession.get(parentSessionID) ?? new Set<string>()
    for (const filePath of filePaths) {
      set.add(filePath)
    }
    invalidatedByParentSession.set(parentSessionID, set)
  }

  return {
    getInvalidatedFiles(parentSessionID) {
      if (!parentSessionID) return new Set<string>()
      return invalidatedByParentSession.get(parentSessionID) ?? new Set<string>()
    },

    async onTaskToolAfter(hookInput, hookOutput) {
      const sessionId = (hookOutput.metadata as any)?.sessionId
      if (typeof sessionId !== "string" || sessionId.length === 0) return

      const diffs = extractDiffs(
        (await getSessionDiff({
          client: input.client,
          sessionID: sessionId,
          directory: input.directory,
        })) as any,
      )
      const normalized = diffs
        .map((d) => (typeof d.file === "string" ? normalizeFilePath(d.file, input.worktreeRoot) : undefined))
        .filter((x): x is string => typeof x === "string" && x.length > 0)

      if (normalized.length > 0) {
        addInvalidated(hookInput.sessionID, normalized)
      }
    },
  }
}
