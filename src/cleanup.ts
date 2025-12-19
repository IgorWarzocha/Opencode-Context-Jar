// Context cleanup logic for Context Jar
//
// Goal: prevent stacked historical file states from confusing the model.
//
// Design choice:
// - This plugin is conservative about *adding* context.
// - We only consolidate when there is at least one real `read` tool output for a
//   file in the current prompt window.
// - If there are only `edit` calls (no reads), we do not fabricate a full-file
//   read, because that can increase prompt size dramatically.
//
// Strategy (per step):
// - For each file that has a `read` part in the current messages:
//   - Keep exactly ONE completed `read` tool part in the message history.
//   - Rewrite its output to the latest known file content (from edit metadata or
//     write input), formatted like a real `read` output.
//   - Remove all other file-operation tool parts (`read`/`edit`/`write`/`multiedit`)
//     for that file so older states are not visible.
// - For files modified by a subagent (`tool: task`), invalidate them by removing
//   all file tool parts so the main agent must re-read.

import path from "path"
import { isFileProtected } from "./patterns"
import { extractPrimaryFilePath, inferWorktreeRoot } from "./path-utils"
import { estimateTokens } from "./token"
import { type StepTokenDelta } from "./stats"
import { type ChatMessage, type ToolPart, type ToolStateCompleted, type WhitelistConfig } from "./types"

type ToolRef = {
  part: ToolPart
}

type LatestContent = {
  content: string
  contentKind: "read-output" | "raw-text"
}

function emptyDelta(): StepTokenDelta {
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

function isCompletedToolPart(part: ToolPart): part is ToolPart & { state: ToolStateCompleted } {
  return part.type === "tool" && part.state?.status === "completed"
}

function normalizeNewlines(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

function renderReadLikeOutput(rawContent: string): string {
  const normalized = normalizeNewlines(rawContent)
  const lines = normalized.split("\n")

  let out = "<file>\n"
  for (let i = 0; i < lines.length; i++) {
    const lineNo = (i + 1).toString().padStart(5, "0")
    out += `${lineNo}| ${lines[i]}\n`
  }
  out += `\n(End of file - total ${lines.length} lines)\n</file>`
  return out
}

function extractAfterFromEditMetadata(stateMetadata: Record<string, unknown> | undefined): string | undefined {
  if (!stateMetadata) return undefined

  const filediff = (stateMetadata as any).filediff
  if (filediff && typeof filediff.after === "string") return filediff.after

  const results = (stateMetadata as any).results
  if (Array.isArray(results) && results.length > 0) {
    const last = results[results.length - 1]
    const lastFilediff = last?.filediff
    if (lastFilediff && typeof lastFilediff.after === "string") return lastFilediff.after
  }

  return undefined
}

function isFileTool(tool: string): boolean {
  return tool === "read" || tool === "edit" || tool === "write" || tool === "multiedit"
}

function removeCompactedMarker(part: ToolPart): void {
  if (!isCompletedToolPart(part)) return
  if (part.state.time.compacted != null) {
    delete (part.state.time as any).compacted
  }
}

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj)
  } catch {
    return ""
  }
}

function toolPartTokens(part: ToolPart): number {
  if (!isCompletedToolPart(part)) return 0
  const state = part.state
  return estimateTokens(safeStringify(state.input)) + estimateTokens(state.output ?? "")
}

function categorizeBeforeTokens(delta: StepTokenDelta, part: ToolPart, tokens: number): void {
  delta.tokensBefore += tokens
  if (part.tool === "read") {
    delta.readTokensBefore += tokens
    return
  }
  if (part.tool === "edit" || part.tool === "multiedit" || part.tool === "write") {
    delta.editTokensBefore += tokens
  }
}

function categorizeAfterTokens(delta: StepTokenDelta, part: ToolPart, tokens: number): void {
  delta.tokensAfter += tokens
  if (part.tool === "read") {
    delta.readTokensAfter += tokens
    return
  }
  if (part.tool === "edit" || part.tool === "multiedit" || part.tool === "write") {
    delta.editTokensAfter += tokens
  }
}

export function cleanupMessagesForContextJar(
  messages: ChatMessage[],
  config: WhitelistConfig,
  invalidatedFiles: ReadonlySet<string>,
): StepTokenDelta {
  const delta = emptyDelta()

  const protectedExtensions = config.protectedFiles?.extensions ?? []
  const protectedPatterns = config.protectedFiles?.patterns ?? []
  const worktreeRoot = inferWorktreeRoot(messages)

  const latestByFile = new Map<string, LatestContent>()
  const lastReadByFile = new Map<string, ToolRef>()
  const filesWithHistory = new Set<string>()
  const filesWithRead = new Set<string>()

  // Pass 1: collect file history + latest content + last read.
  for (const message of messages) {
    for (const rawPart of message.parts as any[]) {
      if (!rawPart || rawPart.type !== "tool") continue
      const toolPart = rawPart as ToolPart
      if (!isCompletedToolPart(toolPart)) continue
      if (!isFileTool(toolPart.tool)) continue

      const filePath = extractPrimaryFilePath(toolPart, worktreeRoot)
      if (!filePath) continue
      if (isFileProtected(filePath, protectedExtensions, protectedPatterns)) continue

      filesWithHistory.add(filePath)

      if (toolPart.tool === "read") {
        filesWithRead.add(filePath)
      }

      if (invalidatedFiles.has(filePath)) {
        continue
      }

      if (toolPart.tool === "read") {
        const output = (toolPart.state as ToolStateCompleted).output
        if (typeof output === "string" && output.length > 0) {
          latestByFile.set(filePath, { content: output, contentKind: "read-output" })
          lastReadByFile.set(filePath, { part: toolPart })
        }
        continue
      }

      if (toolPart.tool === "edit" || toolPart.tool === "multiedit") {
        const after = extractAfterFromEditMetadata((toolPart.state as ToolStateCompleted).metadata as any)
        if (typeof after === "string") {
          latestByFile.set(filePath, { content: after, contentKind: "raw-text" })
        }
        continue
      }

      if (toolPart.tool === "write") {
        const input = (toolPart.state as ToolStateCompleted).input as any
        if (input && typeof input.content === "string") {
          latestByFile.set(filePath, { content: input.content, contentKind: "raw-text" })
        }
      }
    }
  }

  if (filesWithHistory.size === 0) return delta

  // Pass 2: pick keeper read per file ONLY if there is a real read.
  const keepCallIDs = new Set<string>()
  const filesToConsolidate = new Set<string>()

  for (const filePath of filesWithRead) {
    if (invalidatedFiles.has(filePath)) {
      delta.filesInvalidated += 1
      continue
    }

    const existingRead = lastReadByFile.get(filePath)
    if (!existingRead) continue

    // Prefer latest content if we have it; otherwise keep the existing read output.
    const latest = latestByFile.get(filePath)
    const currentState = existingRead.part.state as ToolStateCompleted

    const normalizedOutput = latest
      ? latest.contentKind === "read-output"
        ? latest.content
        : renderReadLikeOutput(latest.content)
      : currentState.output

    // Rewrite the single read to the latest state and ensure it remains visible.
    currentState.output = normalizedOutput
    currentState.input = {
      ...(currentState.input ?? {}),
      filePath,
    }
    removeCompactedMarker(existingRead.part)

    keepCallIDs.add(existingRead.part.callID ?? "")
    filesToConsolidate.add(filePath)

    const label = worktreeRoot ? path.relative(worktreeRoot, filePath) : filePath
    void label

    delta.filesConsolidated += 1
  }

  // Also record invalidation for files that had no read.
  for (const filePath of filesWithHistory) {
    if (!filesWithRead.has(filePath) && invalidatedFiles.has(filePath)) {
      delta.filesInvalidated += 1
    }
  }

  // Pass 3: remove file tools for consolidated files (keep one read) and for invalidated files.
  for (const message of messages) {
    const nextParts: any[] = []

    for (const rawPart of message.parts as any[]) {
      if (!rawPart || rawPart.type !== "tool") {
        nextParts.push(rawPart)
        continue
      }

      const toolPart = rawPart as ToolPart
      if (!isCompletedToolPart(toolPart) || !isFileTool(toolPart.tool)) {
        nextParts.push(rawPart)
        continue
      }

      const filePath = extractPrimaryFilePath(toolPart, worktreeRoot)
      if (!filePath) {
        nextParts.push(rawPart)
        continue
      }

      if (!filesWithHistory.has(filePath)) {
        nextParts.push(rawPart)
        continue
      }

      if (isFileProtected(filePath, protectedExtensions, protectedPatterns)) {
        nextParts.push(rawPart)
        continue
      }

      // Always remove invalidated file tool context.
      if (invalidatedFiles.has(filePath)) {
        const tokens = toolPartTokens(toolPart)
        categorizeBeforeTokens(delta, toolPart, tokens)
        delta.invalidatedTokensBefore += tokens
        continue
      }

      // Only consolidate if there was a read.
      if (!filesToConsolidate.has(filePath)) {
        nextParts.push(rawPart)
        continue
      }

      const tokens = toolPartTokens(toolPart)
      categorizeBeforeTokens(delta, toolPart, tokens)

      if (toolPart.tool === "read" && toolPart.callID && keepCallIDs.has(toolPart.callID)) {
        const keptTokens = toolPartTokens(toolPart)
        categorizeAfterTokens(delta, toolPart, keptTokens)
        nextParts.push(rawPart)
      }
    }

    message.parts = nextParts as any
  }

  return delta
}
