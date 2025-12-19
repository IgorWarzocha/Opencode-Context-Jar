// Model whitelist enforcement logic
// Handles model validation against whitelist configuration

import { WhitelistConfig } from "./types"

export function isModelAllowed(model: string, config: WhitelistConfig): boolean {
  if (!config.enforced) return true
  return config.allowedModels.includes(model)
}

export function shouldSkipContextCleanup(model: string | undefined, config: WhitelistConfig | null): boolean {
  if (!config || !model) return false
  return !isModelAllowed(model, config)
}
