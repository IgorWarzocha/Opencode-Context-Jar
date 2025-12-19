// Idle finalization for Context Jar
//
// The model gets confused when it sees many historical tool calls for the same
// file. This module creates a "final" per-file view: one synthetic `read` tool
// output containing the latest file content, with all previous file tool parts
// removed.
//
// This is intended to be applied at session boundaries (idle), so the next LLM
// step starts from a clean, canonical file state.

import path from "path"
import { isFileProtected } from "./patterns"
import { extractPrimaryFilePath, inferWorktreeRoot } from "./path-utils"
import { type ChatMessage, type ToolPart, type ToolStateCompleted, type WhitelistConfig } from "./types"
import { estimateTokens } from "./token"
import { type StepTokenDelta } from "./stats"

type LatestContent = {
  content: string
  isAlreadyReadFormatted: boolean
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

function categorizeBefore(delta: StepTokenDelta, part: ToolPart, tokens: number): void {
  delta.tokensBefore += tokens
  if (part.tool === "read") delta.readTokensBefore += tokens
  if (part.tool === "edit" || part.tool === "multiedit" || part.tool === "write") delta.editTokensBefore += tokens
}

function categorizeAfter(delta: StepTokenDelta, part: ToolPart, tokens: number): void {
  delta.tokensAfter += tokens
  if (part.tool === "read") delta.readTokensAfter += tokens
  if (part.tool === "edit" || part.tool === "multiedit" || part.tool === "write") delta.editTokensAfter += tokens
}

function makeSyntheticReadPart(filePath: string, output: string, label: string): ToolPart {
  const now = Date.now()
  return {
    type: "tool",
    tool: "read",
    callID: `context-jar-final-read-${label.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
    state: {
      status: "completed",
      input: {
        filePath,
      },
      output,
      title: label,
      metadata: {
        preview: output.split("\n").slice(0, 20).join("\n"),
      },
      time: {
        start: now,
        end: now,
      },
    },
  }
}

function findLastAssistant(messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.info?.role === "assistant") return messages[i]
  }
  return undefined
}

export function finalizeEditedFilesForNextStep(
  messages: ChatMessage[],
  config: WhitelistConfig,
  invalidatedFiles: ReadonlySet<string>,
): StepTokenDelta {
  const delta = emptyDelta()
  const protectedExtensions = config.protectedFiles?.extensions ?? []
  const protectedPatterns = config.protectedFiles?.patterns ?? []
  const worktreeRoot = inferWorktreeRoot(messages)

  const latestByFile = new Map<string, LatestContent>()
  const editedFiles = new Set<string>()
  const allTouchedFiles = new Set<string>()

  // Gather latest content for edited files.
  for (const message of messages) {
    for (const rawPart of message.parts as any[]) {
      if (!rawPart || rawPart.type !== "tool") continue
      const toolPart = rawPart as ToolPart
      if (!isCompletedToolPart(toolPart)) continue

      const filePath = extractPrimaryFilePath(toolPart, worktreeRoot)
      if (!filePath) continue
      if (isFileProtected(filePath, protectedExtensions, protectedPatterns)) continue

      allTouchedFiles.add(filePath)

      if (invalidatedFiles.has(filePath)) continue

      if (toolPart.tool === "edit" || toolPart.tool === "multiedit") {
        const after = extractAfterFromEditMetadata((toolPart.state as ToolStateCompleted).metadata as any)
        if (typeof after === "string") {
          editedFiles.add(filePath)
          latestByFile.set(filePath, { content: after, isAlreadyReadFormatted: false })
        }
        continue
      }

      if (toolPart.tool === "write") {
        const input = (toolPart.state as ToolStateCompleted).input as any
        if (input && typeof input.content === "string") {
          editedFiles.add(filePath)
          latestByFile.set(filePath, { content: input.content, isAlreadyReadFormatted: false })
        }
        continue
      }

      if (toolPart.tool === "read") {
        // Only use read as fallback (if we never saw an edit metadata snapshot).
        const output = (toolPart.state as ToolStateCompleted).output
        if (typeof output === "string" && output.length > 0 && !latestByFile.has(filePath)) {
          latestByFile.set(filePath, { content: output, isAlreadyReadFormatted: true })
        }
      }
    }
  }

  // Track invalidations even for edit-only sessions.
  for (const filePath of allTouchedFiles) {
    if (invalidatedFiles.has(filePath)) delta.filesInvalidated += 1
  }

  if (editedFiles.size === 0 && delta.filesInvalidated === 0) {
    return delta
  }

  // Remove all file tool parts for edited/invalidated files.
  for (const message of messages) {
    const nextParts: any[] = []

    for (const rawPart of message.parts as any[]) {
      if (!rawPart || rawPart.type !== "tool") {
        nextParts.push(rawPart)
        continue
      }

      const toolPart = rawPart as ToolPart
      if (!isCompletedToolPart(toolPart)) {
        nextParts.push(rawPart)
        continue
      }

      const filePath = extractPrimaryFilePath(toolPart, worktreeRoot)
      if (!filePath) {
        nextParts.push(rawPart)
        continue
      }

      if (isFileProtected(filePath, protectedExtensions, protectedPatterns)) {
        nextParts.push(rawPart)
        continue
      }

      const shouldWipe = editedFiles.has(filePath) || invalidatedFiles.has(filePath)
      if (!shouldWipe) {
        nextParts.push(rawPart)
        continue
      }

      // Only wipe file tools.
      if (
        toolPart.tool === "read" ||
        toolPart.tool === "edit" ||
        toolPart.tool === "multiedit" ||
        toolPart.tool === "write"
      ) {
        const tokens = toolPartTokens(toolPart)
        categorizeBefore(delta, toolPart, tokens)
        if (invalidatedFiles.has(filePath)) delta.invalidatedTokensBefore += tokens
        continue
      }

      nextParts.push(rawPart)
    }

    message.parts = nextParts as any
  }

  // Add one synthetic read per edited file with final content.
  const targetAssistant = findLastAssistant(messages)
  if (!targetAssistant) return delta

  for (const filePath of editedFiles) {
    const latest = latestByFile.get(filePath)
    if (!latest) continue

    const label = worktreeRoot ? path.relative(worktreeRoot, filePath) : filePath
    const output = latest.isAlreadyReadFormatted ? latest.content : renderReadLikeOutput(latest.content)

    const synthetic = makeSyntheticReadPart(filePath, output, label)
    targetAssistant.parts.push(synthetic as any)

    const tokens = toolPartTokens(synthetic)
    categorizeAfter(delta, synthetic, tokens)

    delta.filesConsolidated += 1
  }

  return delta
}
