// Configuration management for Context Jar
// Handles JSONC config file operations and validation

import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { parse } from "jsonc-parser"
import { WhitelistConfig } from "./types"

const GLOBAL_CONFIG_DIR = join(homedir(), ".config", "opencode")
const WHITELIST_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, "context-jar.jsonc")

export function createWhitelistConfig(): void {
  if (!existsSync(GLOBAL_CONFIG_DIR)) {
    mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true })
  }

  const configContent = `{
  // List of allowed models for this workspace/project
  "allowedModels": [
    "anthropic/claude-3-5-sonnet-20241022",
    "openai/gpt-4o",
    "anthropic/claude-3-haiku-20240307"
  ],
  // Whether to enforce the whitelist (false = allow all models)
  "enforced": true,
  // Optional: override models for specific tools
  "toolOverrides": {
    "task": "anthropic/claude-3-haiku-20240307"
  },
  // File protection settings
  "protectedFiles": {
    // File extensions to protect from context cleanup
    "extensions": [
      ".md",
      ".txt"
    ],
    // File patterns to protect (glob-like)
    "patterns": [
      "*.config.*",
      "README*",
      "*.json"
    ]
  }
}`

  writeFileSync(WHITELIST_CONFIG_PATH, configContent, "utf-8")
}

export function loadWhitelistConfig(): WhitelistConfig | null {
  try {
    const content = readFileSync(WHITELIST_CONFIG_PATH, "utf-8")
    const parsed = parse(content)
    return parsed as WhitelistConfig
  } catch {
    return null
  }
}
