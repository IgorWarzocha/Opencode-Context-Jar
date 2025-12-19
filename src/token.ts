// Token estimation for Context Jar
//
// Provides a best-effort token count for prompt text. Used for user-facing
// summaries about how much context was removed.

import { encode } from "gpt-tokenizer"

export function estimateTokens(text: string): number {
  if (!text) return 0

  try {
    return encode(text).length
  } catch {
    // Fallback heuristic: ~4 chars per token (English-ish)
    return Math.ceil(text.length / 4)
  }
}
