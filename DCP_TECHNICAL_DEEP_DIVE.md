# DCP Technical Deep Dive

## Core File Structure Analysis

### Entry Point: `index.ts`

```typescript
// Main plugin structure
const plugin: Plugin = async (ctx) => {
  const config = getConfig(ctx)
  if (!config.enabled) return {}

  // Core initialization
  const logger = new Logger(config.debug)
  const state = createSessionState()

  // OpenCode hook registrations
  return {
    "experimental.chat.system.transform": syntheticPromptInjection,
    "experimental.chat.messages.transform": messageTransformation,
    tool: pruneToolDefinition,
    config: configMutation,
    event: eventHandlers,
  }
}
```

**Key Observations:**

- Single plugin instance handles all sessions
- State management centralized per session
- Multiple OpenCode hooks for different intervention points
- Config mutation capability to modify OpenCode behavior

## Configuration System: `lib/config.ts`

### Multi-level Hierarchy

```typescript
// Priority order (highest → lowest):
// Project (.opencode/dcp.jsonc) →
// Config Dir ($OPENCODE_CONFIG_DIR/dcp.jsonc) →
// Global (~/.config/opencode/dcp.jsonc) →
// Defaults
```

### Default Configuration Structure

```typescript
{
    enabled: true,
    debug: false,
    pruningSummary: 'detailed',
    strategies: {
        deduplication: { enabled: true, protectedTools: [...] },
        supersedeWrites: { enabled: true },
        pruneTool: {
            enabled: true,
            protectedTools: [...],
            nudge: { enabled: true, frequency: 10 }
        },
        onIdle: { enabled: false, ... } // Legacy
    }
}
```

**Technical Insights:**

- JSONC support with comments for user-friendly configuration
- Robust validation with type checking and unknown key warnings
- Merge strategy allows partial overrides at each level
- Automatic default config creation on first run

## State Management: `lib/state/`

### Session State Interface

```typescript
interface SessionState {
  sessionId: string | null // Current session identifier
  isSubAgent: boolean // Sub-agent vs main session
  prune: { toolIds: string[] } // Tool calls marked for pruning
  stats: {
    pruneTokenCounter: number // Current session savings
    totalPruneTokens: number // Cumulative savings
  }
  toolParameters: Map<string, ToolParameterEntry> // Tool metadata
  nudgeCounter: number // Tool call counter for nudging
  lastToolPrune: boolean // Track if pruning occurred
  lastCompaction: number // Compaction timestamp
}
```

**Key Design Patterns:**

- Session isolation with clear boundaries
- Persistent state across restarts via file storage
- Compaction detection for automatic cleanup
- Tool metadata caching for efficient processing

## Core Strategies Analysis

### 1. Deduplication Strategy: `lib/strategies/deduplication.ts`

**Algorithm:**

```typescript
function deduplicate(state, messages) {
    // 1. Build chronological tool ID list
    const toolIds = buildToolIdList(state, messages)

    // 2. Group by tool signature (name + normalized parameters)
    const signatureMap = new Map<string, string[]>()
    for each toolCall:
        signature = createSignature(toolName, parameters)
        signatureMap.get(signature).push(toolCallId)

    // 3. Mark all but most recent in each group for pruning
    for each [signature, ids]:
        if ids.length > 1:
            markForPruning(ids.slice(0, -1))  // Keep last one
}
```

**Signature Creation Logic:**

```typescript
function createSignature(tool: string, parameters: any): string {
  const normalized = normalizeParameters(parameters) // Remove null/undefined
  const sorted = sortObjectKeys(normalized) // Consistent ordering
  return `${tool}::${JSON.stringify(sorted)}`
}
```

**Strengths:**

- Zero LLM cost - pure algorithmic approach
- Handles parameter order differences gracefully
- Efficient with O(n) complexity

**Weaknesses:**

- No semantic understanding of parameter importance
- May prune calls that look identical but have different context

### 2. Supersede Writes Strategy: `lib/strategies/supersede-writes.ts`

**Algorithm:**

```typescript
function supersedeWrites(state, messages) {
    // 1. Track write operations by file path + index
    const writesByFile = new Map<string, { id: string, index: number }[]>()
    // 2. Track read operations by file path + index
    const readsByFile = new Map<string, number[]>()

    // 3. For each file, find writes that have subsequent reads
    for each [filePath, writes]:
        const reads = readsByFile.get(filePath)
        for each write:
            if reads.some(readIndex > write.index):
                markForPruning(write.id)
}
```

**Logic Foundation:**

- Writing a file establishes state at time T
- Reading the file captures state at time T+1
- If T+1 > T, the write content is redundant because the read shows the actual state

**Strengths:**

- Logical reasoning about information flow
- Zero LLM cost
- Handles complex read/write sequences correctly

**Weaknesses:**

- Only works for file operations
- Cannot handle indirect dependencies (e.g., compile steps)

### 3. Prune Tool Strategy: `lib/strategies/prune-tool.ts`

**Tool Interface:**

```typescript
prune({
  ids: ["completion", "5", "12", "23"], // reason + numeric IDs
})
```

**Implementation Flow:**

```typescript
async function execute(args, toolCtx) {
  // 1. Validate reason and IDs
  // 2. Map numeric IDs to actual tool call IDs
  // 3. Check for protected tools
  // 4. Update state.prune.toolIds
  // 5. Calculate and report token savings
  // 6. Send user notification
  // 7. Persist state
}
```

**Nudge System:**

```typescript
function insertNudgeMessage(messages) {
  if (nudgeCounter >= frequency) {
    messages.push({
      type: "text",
      content: `<prunable-tools>\n${numberedList}\n${nudgePrompt}\n</prunable-tools>`,
    })
  }
}
```

**Strengths:**

- AI agency in decision making
- Precise control over what gets pruned
- Rich feedback and notifications

**Weaknesses:**

- Requires AI to make correct decisions
- Adds overhead to each conversation
- Complex interface

## Message Transformation: `lib/messages/prune.ts`

**Two-Phase Process:**

```typescript
function prune(state, messages) {
  // Phase 1: Prune tool outputs (read, batch, etc.)
  pruneToolOutputs(state, messages)
  // Phase 2: Prune tool inputs (write, edit only)
  pruneToolInputs(state, messages)
}
```

**Replacement Strategy:**

```typescript
const PRUNED_TOOL_OUTPUT_REPLACEMENT = "[Output removed to save context - information superseded or no longer needed]"
const PRUNED_TOOL_INPUT_REPLACEMENT = "[Input removed to save context]"
```

**Key Design Decisions:**

- Never modifies message structure, only content
- Different replacements for inputs vs outputs
- Preserves tool call metadata and relationships
- Handles compaction events correctly

## Performance Characteristics

### Computational Complexity

- **Deduplication**: O(n) where n = tool calls
- **Supersede Writes**: O(n) with file path hashing
- **Prune Tool**: O(1) for execution, O(n) for validation
- **Overall**: O(n) per request with small constant factors

### Memory Usage

- **Tool Parameters**: ~200 bytes per tool call
- **State Objects**: ~1KB per session
- **Message Processing**: No additional memory (in-place transformation)

### Token Calculation Accuracy

- Uses `gpt-tokenizer` library for precise counting
- Calculates original vs pruned content difference
- Tracks both session and lifetime statistics

## Integration Architecture

### OpenCode Hook System

```typescript
{
    // Add synthetic prompts to system message
    "experimental.chat.system.transform": systemPromptHandler,

    // Main transformation pipeline
    "experimental.chat.messages.transform": messageTransformHandler,

    // Tool definition and execution
    tool: { prune: pruneToolDefinition },

    // Config mutation for primary_tools
    config: configMutationHandler,

    // Session lifecycle events
    event: eventHandlers
}
```

### Session Management

- **Session Detection**: Uses message.info.sessionID
- **Compaction Handling**: Detects summary messages and resets state
- **Sub-agent Support**: Differentiates context pruning strategies
- **Persistence**: Saves state to filesystem for durability

## Critical Design Insights

### 1. Non-Destructive Approach

- Original conversation history never modified
- Transformations applied only to what's sent to LLM
- Enables rollback and debugging
- Builds user trust

### 2. State-Driven Architecture

- Pruning decisions persisted across requests
- Session isolation prevents cross-contamination
- Compaction detection handles conversation boundaries
- Metadata-driven rather than content-driven processing

### 3. Multi-Level Strategy System

- Zero-cost algorithmic strategies (deduplication, supersede)
- AI-assisted strategic pruning (prune tool)
- Legacy LLM-based analysis (on-idle)
- Flexible enable/disable per strategy

### 4. Cache Trade-off Management

- Acknowledges cache invalidation cost
- Provides metrics for user evaluation
- Most beneficial in long conversations
- Cache savings vs token savings trade-off explicit

## Technical Debt and Limitations

### 1. Configuration Complexity

- Multi-level hierarchy confusing for users
- Too many options with unclear interactions
- Validation warnings may be overwhelming
- Default settings conservative

### 2. Legacy Features

- On-idle strategy adds unnecessary complexity
- Multiple notification systems overlapping
- Inconsistent error handling patterns
- Some code paths untested

### 3. Performance Optimization Opportunities

- Inefficient Map usage in some places
- Redundant parameter validation
- Could benefit from better caching strategies
- Token calculation could be optimized

### 4. Extensibility Limitations

- Hard-coded strategy list
- Tool-specific logic tightly coupled
- Difficult to add custom pruning rules
- No plugin architecture for extensions

This deep dive reveals a well-architected system with thoughtful design decisions, but also highlights opportunities for improvement in Context Jar's design.
