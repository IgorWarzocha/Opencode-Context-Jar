// Tool call helpers (OpenCode schema-aware)

import { isFileProtected } from "./patterns"
import { extractPrimaryFilePath } from "./path-utils"
import { type ToolPart } from "./types"

export function extractFilesFromToolPart(part: ToolPart, worktreeRoot?: string): string[] {
  const primary = extractPrimaryFilePath(part, worktreeRoot)
  return primary ? [primary] : []
}

export function shouldProtectToolPart(
  part: ToolPart,
  protectedExtensions: string[],
  protectedPatterns: string[],
  worktreeRoot?: string,
): boolean {
  const paths = extractFilesFromToolPart(part, worktreeRoot)
  return paths.some((p) => isFileProtected(p, protectedExtensions, protectedPatterns))
}
