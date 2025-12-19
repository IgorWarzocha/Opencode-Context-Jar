// Legacy consolidation module
//
// Context Jar now performs in-place deduping/rewriting in `cleanup.ts` to match
// OpenCode's actual message/tool schemas. This file remains as a stable import
// target for older experiments.

import { type ChatMessagePart } from "./types"

export function consolidateToolOperations(parts: ChatMessagePart[]): ChatMessagePart[] {
  return parts
}
