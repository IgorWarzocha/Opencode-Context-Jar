// Legacy dependency analysis module
//
// The current Context Jar strategy avoids complex dependency graphs and focuses
// on preventing stacked stale reads from being shown to the model.

import { extractPrimaryFilePath } from "./path-utils"
import { type ChatMessagePart, type ToolDependency, type ToolPart } from "./types"

export function extractFilesFromToolPart(part: ChatMessagePart, worktreeRoot?: string): string[] {
  if (!part || part.type !== "tool") return []
  const p = extractPrimaryFilePath(part as ToolPart, worktreeRoot)
  return p ? [p] : []
}

export function findReadEditDependencies(_parts: ChatMessagePart[]): ToolDependency[] {
  return []
}
