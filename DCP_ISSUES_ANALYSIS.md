# DCP Issues Analysis with Code References

## Issue 1: Context Pollution from Pruneable Tools List

### Problem

DCP injects a list of pruneable tools into user messages, polluting context with metadata that has nothing to do with the actual conversation.

### Code References

**Injection Point**: `lib/messages/prune.ts:47-97`

```typescript
export const insertPruneToolContext = (
  state: SessionState,
  config: PluginConfig,
  logger: Logger,
  messages: WithParts[],
): void => {
  if (!config.strategies.pruneTool.enabled) {
    return
  }

  const prunableToolsList = buildPrunableToolsList(state, config, logger, messages)
  if (!prunableToolsList) {
    return
  }

  let nudgeString = ""
  if (state.nudgeCounter >= config.strategies.pruneTool.nudge.frequency) {
    logger.info("Inserting prune nudge message")
    nudgeString = "\n" + NUDGE_STRING
  }

  const userMessage: WithParts = {
    info: {
      id: "msg_01234567890123456789012345",
      sessionID: lastUserMessage.info.sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: (lastUserMessage.info as UserMessage).agent || "build",
      model: {
        providerID: (lastUserMessage.info as UserMessage).model.providerID,
        modelID: (lastUserMessage.info as UserMessage).model.modelID,
      },
    },
    parts: [
      {
        id: "prt_01234567890123456789012345",
        sessionID: lastUserMessage.info.sessionID,
        messageID: "msg_01234567890123456789012345",
        type: "text",
        text: prunableToolsList + nudgeString,
      },
    ],
  }

  messages.push(userMessage) // ← CONTEXT POLLUTION HERE
}
```

**List Generation**: `lib/messages/prune.ts:13-45`

```typescript
const buildPrunableToolsList = (
  state: SessionState,
  config: PluginConfig,
  logger: Logger,
  messages: WithParts[],
): string => {
  const lines: string[] = []
  const toolIdList: string[] = buildToolIdList(state, messages, logger)

  state.toolParameters.forEach((toolParameterEntry, toolCallId) => {
    if (state.prune.toolIds.includes(toolCallId)) {
      return
    }
    if (config.strategies.pruneTool.protectedTools.includes(toolParameterEntry.tool)) {
      return
    }
    const numericId = toolIdList.indexOf(toolCallId)
    if (numericId === -1) {
      logger.warn(`Tool in cache but not in toolIdList - possible stale entry`, {
        toolCallId,
        tool: toolParameterEntry.tool,
      })
      return
    }
    const paramKey = extractParameterKey(toolParameterEntry.tool, toolParameterEntry.parameters)
    const description = paramKey ? `${toolParameterEntry.tool}, ${paramKey}` : toolParameterEntry.tool
    lines.push(`${numericId}: ${description}`)
    logger.debug(`Prunable tool found - ID: ${numericId}, Tool: ${toolParameterEntry.tool}, Call ID: ${toolCallId}`)
  })

  if (lines.length === 0) {
    return ""
  }

  return `<prunable-tools>\nThe following tools have been invoked and are available for pruning. This list does not mandate immediate action. Consider your current goals and the resources you need before discarding valuable tool inputs or outputs. Keep the context free of noise.\n${lines.join("\n")}\n</prunable-tools>`
}
```

**Impact**: Every request gets this metadata added, consuming tokens and confusing the LLM with irrelevant information about plugin internals.

---

## Issue 2: LLM Dependency for Intelligence

### Problem

DCP exposes a `prune` tool that the LLM must discover, understand, and use correctly. This assumes the model will make optimal pruning decisions.

### Code References

**Tool Definition**: `lib/strategies/prune-tool.ts:28-137`

```typescript
export function createPruneTool(
    ctx: PruneToolContext,
): ReturnType<typeof tool> {
    return tool({
        description: TOOL_DESCRIPTION,
        args: {
            ids: tool.schema.array(
                tool.schema.string()
            ).describe(
                "First element is the reason ('completion', 'noise', 'consolidation'), followed by numeric IDs as strings to prune"
            ),
        },
        async execute(args, toolCtx) {
            // LLM must figure out:
            // 1. When to call this tool
            // 2. What IDs to prune
            // 3. What reason to use
            // 4. How to format the call correctly
```

**Tool Description**: `lib/prompts/tool.txt`

```
Prune specific tool outputs from conversation context to reduce token usage. Use this when you have completed tasks or when earlier tool results are no longer needed. Be conservative - don't prune information you might need again.

Format: ["reason", "id1", "id2", ...] where reason is:
- "completion": Task completed, cleanup intermediate steps
- "noise": Tool results that turned out irrelevant
- "consolidation": Multiple similar results, keep only most recent
```

**Nudge System**: `lib/messages/prune.ts:67-71`

```typescript
let nudgeString = ""
if (state.nudgeCounter >= config.strategies.pruneTool.nudge.frequency) {
  logger.info("Inserting prune nudge message")
  nudgeString = "\n" + NUDGE_STRING // ← PROMPTING LLM TO USE TOOL
}
```

**Nudge Prompt**: `lib/prompts/nudge.txt`

```
The conversation is getting long. Consider using the prune tool to remove obsolete tool outputs and keep the context focused on relevant information.
```

**Impact**: LLM may not use the tool, may use it incorrectly, or may waste cognitive cycles on plugin management instead of actual tasks.

---

## Issue 3: No Model Control

### Problem

DCP has no model-specific configuration - it's either on for all models or off for all models, with no consideration for which models actually benefit from pruning.

### Code References

**No Model Filtering**: `index.ts:9-64`

```typescript
const plugin: Plugin = async (ctx) => {
  const config = getConfig(ctx)

  if (!config.enabled) {
    return {} // ← ONLY ON/OFF, NO MODEL-SPECIFIC LOGIC
  }
  // ... plugin setup applies to ALL models
}
```

**Config Structure**: `lib/config.ts:228-255`

```typescript
const defaultConfig: PluginConfig = {
    enabled: true,
    debug: false,
    pruningSummary: 'detailed',
    strategies: {
        // ← NO MODEL-SPECIFIC SETTINGS
        deduplication: { enabled: true, protectedTools: [...] },
        supersedeWrites: { enabled: true },
        pruneTool: { enabled: true, protectedTools: [...], nudge: {...} },
        onIdle: { enabled: false, ... }
    }
}
```

**No Model Detection**: Plugin hooks don't check which model is being used before applying strategies.

**Impact**: Small-context models get pruning they don't need, expensive models might not get aggressive enough pruning, and no per-model optimization.

---

## Issue 4: Pruning-Recovery Loops

### Problem

DCP has no dependency tracking, so it might prune information that the model immediately needs again, causing inefficient loops.

### Code References

**No Dependency Analysis**: `lib/strategies/deduplication.ts:12-77`

```typescript
export const deduplicate = (state: SessionState, logger: Logger, config: PluginConfig, messages: WithParts[]): void => {
  // Only checks for exact duplicates, no dependency analysis
  for (const [, ids] of signatureMap.entries()) {
    if (ids.length > 1) {
      // ← PRUNES OLDER CALLS REGARDLESS OF UPCOMING NEEDS
      const idsToRemove = ids.slice(0, -1)
      newPruneIds.push(...idsToRemove)
    }
  }
}
```

**No Upcoming Task Awareness**: `lib/strategies/supersede-writes.ts:15-100`

```typescript
export const supersedeWrites = (
  state: SessionState,
  logger: Logger,
  config: PluginConfig,
  messages: WithParts[],
): void => {
  // Prunes writes if any subsequent read exists
  // ← NO CHECK IF WRITE IS NEEDED FOR FUTURE OPERATIONS
  for (const write of writes) {
    const hasSubsequentRead = reads.some((readIndex) => readIndex > write.index)
    if (hasSubsequentRead) {
      newPruneIds.push(write.id) // ← COULD BREAK EDIT CHAIN
    }
  }
}
```

**No Protection Mechanisms**: Plugin doesn't consider what the user might ask next or what operations are in progress.

**Impact**: Model reads file → gets pruned → immediately needs file again → has to re-read, wasting time and tokens.

---

## Issue 5: Communication Pollution

### Problem

DCP injects synthetic prompts and "signals" that change how models naturally communicate with users.

### Code References

**Synthetic System Prompt**: `index.ts:31-34`

```typescript
"experimental.chat.system.transform": async (_input: unknown, output: { system: string[] }) => {
    const syntheticPrompt = loadPrompt("synthetic")
    output.system.push(syntheticPrompt)  // ← ALTERING MODEL BEHAVIOR
},
```

**Synthetic Prompt**: `lib/prompts/synthetic.txt`

```
This session includes context optimization capabilities. Tool outputs may be replaced with placeholders to reduce token usage while preserving conversation flow. Focus on the user's request rather than metadata about tool usage.
```

**Prune Tool Signaling**: `lib/strategies/prune-tool.ts:130-134`

```typescript
return formatPruningResultForTool(
  pruneToolIds,
  toolMetadata,
  workingDirectory, // ← GENERATES MESSAGES LIKE "I pruned 5 tool outputs to save context"
)
```

**Result Formatting**: Likely generates artificial communication about plugin actions instead of focusing on user tasks.

**Nudge Messaging**: As shown in Issue 1, constantly reminds model to think about pruning instead of focusing on user requests.

**Impact**: Models spend tokens and cognitive effort on plugin management rather than user tasks, and communication becomes artificial rather than natural.

---

## Summary

These issues stem from DCP's fundamental design philosophy of involving the LLM in context management decisions. A better approach would be:

1. **Zero context pollution** - no message injections
2. **Automatic intelligence** - no LLM dependency
3. **Model awareness** - per-model configuration
4. **Dependency tracking** - prevent recovery loops
5. **Communication preservation** - no synthetic prompts

The next-generation context manager should be completely invisible to both user and model, working silently in the background.

---

## Context Jar Solution: Hook-Based Architecture

### Core Strategy: Use OpenCode's Experimental Hooks Intelligently

Based on the experimental hooks guide, Context Jar can solve all 5 DCP issues with a **minimal, elegant architecture**:

#### 1. **Silent Message Transformation** (Solves Issue #1 - Context Pollution)

**Hook**: `experimental.chat.messages.transform`
**Approach**: Direct message modification without injection

```typescript
export const ContextJarPlugin: Plugin = async (ctx) => {
  return {
    "experimental.chat.messages.transform": async (input, output) => {
      // NO list injection like DCP
      // Just silently reduce message content in-place
      await applyIntelligentPruning(output.messages)
      // That's it - no pollution, no metadata, no lists
    },
  }
}
```

**Advantages over DCP**:

- ✅ No `<prunable-tools>` metadata injection
- ✅ No token waste on plugin internals
- ✅ No confusion for LLM
- ✅ Zero context pollution

#### 2. **No LLM Tool Dependency** (Solves Issue #2 - LLM Intelligence)

**Key Insight**: We **don't expose any tools to the LLM** - Context Jar makes all pruning decisions automatically

```typescript
// NO tool definition like DCP's prune tool
// NO prompt engineering to teach LLM when/how to prune
// NO nudge system to encourage usage
// Complete automation based on intelligent rules
```

**Advantages over DCP**:

- ✅ LLM never knows pruning exists
- ✅ No cognitive overhead on model
- ✅ No incorrect tool usage
- ✅ No training required for model

#### 3. **Model-Aware Processing** (Solves Issue #3 - Model Control)

**Hook**: `experimental.chat.messages.transform` + model detection
**Approach**: Detect current model from message metadata, apply per-model strategy

```typescript
"experimental.chat.messages.transform": async (input, output) => {
  // Extract model info from messages
  const currentModel = extractModelFromMessages(output.messages)
  const pruningProfile = getModelPruningProfile(currentModel)

  // Only enable for models that benefit
  if (!pruningProfile.enabled) {
    return // Skip entirely for small-context models
  }

  await applyModelSpecificPruning(output.messages, pruningProfile)
}
```

**Advantages over DCP**:

- ✅ Whitelist/blacklist models
- ✅ Per-model pruning aggressiveness
- ✅ Cost-aware decisions
- ✅ Context-window optimization

#### 4. **Dependency Tracking for Protection** (Solves Issue #4 - Recovery Loops)

**Hooks**: `tool.execute.before` + `tool.execute.after` for dependency analysis

```typescript
export const ContextJarPlugin: Plugin = async (ctx) => {
  const dependencyTracker = new DependencyTracker()

  return {
    "tool.execute.before": async (input, output) => {
      // Track what tools are being used together
      dependencyTracker.recordToolCall(input.tool, output.args, input.callID)
      buildDependencyGraph(input.tool, output.args)
    },

    "experimental.chat.messages.transform": async (input, output) => {
      // Use dependency tracking to prevent pruning needed content
      const protectedContent = dependencyTracker.getProtectedContent()
      await applySafePruning(output.messages, protectedContent)
    },
  }
}
```

**Advantages over DCP**:

- ✅ Knows what content will be needed soon
- ✅ Prevents pruning file that's about to be edited
- ✅ Maintains operation chains
- ✅ No read-prune-reread loops

#### 5. **Zero Communication Changes** (Solves Issue #5 - Communication Pollution)

**Key Insight**: **No system transforms, no result signaling, no synthetic prompts**

```typescript
export const ContextJarPlugin: Plugin = async (ctx) => {
  return {
    // NO system prompt injection
    // "experimental.chat.system.transform" is completely unused

    "experimental.chat.messages.transform": async (input, output) => {
      // Silent message pruning only
      await applyIntelligentPruning(output.messages)
      // No "I pruned X messages" communication
    },
  }
}
```

**Advantages over DCP**:

- ✅ Natural model communication preserved
- ✅ No behavioral changes via system prompts
- ✅ No artificial result messages
- ✅ User gets clean, natural responses

### Minimal Hook Usage - Maximum Impact

**DCP uses 5+ hooks with complex interactions:**

- `experimental.chat.system.transform` (synthetic prompts)
- `experimental.chat.messages.transform` (message injection + pruning)
- `tool` (prune tool exposure)
- `config` (config mutation)
- `event` (session management)

**Context Jar needs only 2 hooks:**

- `tool.execute.before` (dependency tracking)
- `experimental.chat.messages.transform` (silent pruning)

### Implementation Benefits

1. **Performance**: Fewer hooks = less overhead
2. **Reliability**: Simpler architecture = fewer bugs
3. **Maintainability**: Clear separation of concerns
4. **User Experience**: Completely invisible operation
5. **Cache Friendship**: Can preserve cache prefixes better than DCP

This hook-based architecture eliminates all 5 fundamental issues with DCP while being dramatically simpler and more reliable.
