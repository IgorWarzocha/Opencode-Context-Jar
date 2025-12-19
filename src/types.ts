// Type definitions for Context Jar plugin
// Keep these structural so plugins remain resilient to upstream changes.

export interface WhitelistConfig {
  allowedModels: string[]
  enforced: boolean
  toolOverrides?: Record<string, string>
  protectedFiles?: {
    extensions: string[]
    patterns: string[]
  }
}

export type ModelRef = {
  providerID: string
  modelID: string
}

export function modelKey(model: ModelRef | undefined): string | undefined {
  if (!model) return undefined
  return `${model.providerID}/${model.modelID}`
}

export type ChatMessage = {
  info: {
    role: string
    sessionID?: string
    agent?: string
    model?: ModelRef
    path?: {
      root?: string
      cwd?: string
    }
  }
  parts: ChatMessagePart[]
}

export type ToolStateCompleted = {
  status: "completed"
  input: Record<string, unknown>
  output: string
  title: string
  metadata: Record<string, unknown>
  time: {
    start: number
    end: number
    compacted?: number
  }
  attachments?: unknown[]
}

export type ToolState =
  | { status: "pending"; input: Record<string, unknown>; raw: string }
  | {
      status: "running"
      input: Record<string, unknown>
      title?: string
      metadata?: Record<string, unknown>
      time: { start: number }
    }
  | ToolStateCompleted
  | {
      status: "error"
      input: Record<string, unknown>
      error: string
      metadata?: Record<string, unknown>
      time: { start: number; end: number }
    }

export type ToolPart = {
  type: "tool"
  id?: string
  callID?: string
  tool: string
  state: ToolState
  metadata?: Record<string, unknown>
}

export type ChatMessagePart =
  | ToolPart
  | { type: "text"; text: string; [key: string]: unknown }
  | { type: string; [key: string]: unknown }

export interface ToolDependency {
  callID: string
  filePath: string
  dependentCallIDs: string[]
}

export interface FileOperation {
  callID: string
  tool: string
  filePath: string
  content?: string
}
