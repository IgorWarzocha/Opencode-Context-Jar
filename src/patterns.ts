// File pattern matching and protection logic

import path from "path"

export function matchesExtension(filePath: string, extensions: string[]): boolean {
  const ext = path.extname(filePath).toLowerCase()
  if (!ext) return false
  return extensions.includes(ext) || extensions.includes(ext.slice(1))
}

function escapeRegexChar(ch: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(ch) ? `\\${ch}` : ch
}

function globToRegex(pattern: string): RegExp {
  let out = "^"
  for (const ch of pattern) {
    if (ch === "*") {
      out += ".*"
      continue
    }
    if (ch === "?") {
      out += "."
      continue
    }
    out += escapeRegexChar(ch)
  }
  out += "$"
  return new RegExp(out)
}

export function matchesPattern(filePath: string, patterns: string[]): boolean {
  const base = path.basename(filePath)
  return patterns.some((pattern) => {
    try {
      const re = globToRegex(pattern)
      return re.test(filePath) || re.test(base)
    } catch {
      return false
    }
  })
}

export function isFileProtected(filePath: string, extensions: string[], patterns: string[]): boolean {
  if (!filePath) return false
  return matchesExtension(filePath, extensions) || matchesPattern(filePath, patterns)
}
