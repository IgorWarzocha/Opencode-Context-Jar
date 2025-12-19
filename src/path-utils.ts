// File path normalization and extraction for Context Jar

import path from "path"
import { homedir } from "os"
import { type ChatMessage, type ToolPart } from "./types"

export function inferWorktreeRoot(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const root = messages[i]?.info?.path?.root
    if (typeof root === "string" && root.length > 0) return root
  }
  return undefined
}

export function normalizeFilePath(filePath: string | undefined, worktreeRoot?: string): string | undefined {
  if (!filePath || typeof filePath !== "string") return undefined

  const trimmed = filePath.trim().replace(/^['"]|['"]$/g, "")
  const expanded = trimmed.startsWith("~") ? path.join(homedir(), trimmed.slice(1)) : trimmed

  try {
    if (path.isAbsolute(expanded)) return path.normalize(expanded)
    if (worktreeRoot) return path.normalize(path.resolve(worktreeRoot, expanded))
    return path.normalize(path.resolve(expanded))
  } catch {
    return undefined
  }
}

export function extractPrimaryFilePath(part: ToolPart, worktreeRoot?: string): string | undefined {
  // Most OpenCode file tools pass `filePath`.
  const input = (part.state as any)?.input
  if (input && typeof input.filePath === "string") return normalizeFilePath(input.filePath, worktreeRoot)

  // MultiEdit contains edits with oldString/newString, but still has top-level filePath.
  if (input && Array.isArray(input.edits) && typeof input.filePath === "string") {
    return normalizeFilePath(input.filePath, worktreeRoot)
  }

  // Some tools may pass generic `path`.
  if (input && typeof input.path === "string") return normalizeFilePath(input.path, worktreeRoot)

  // Fallback: nothing we can safely extract.
  return undefined
}
