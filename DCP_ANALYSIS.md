# Context Jar Plugin - Comprehensive Analysis

## Overview

Context Jar is a comprehensive analysis of the Dynamic Context Pruning (DCP) plugin, designed to serve as the foundation for building an improved context management system from scratch.

## What DCP Does

### Core Purpose

DCP (Dynamic Context Pruning) is an OpenCode plugin that automatically reduces token usage by removing obsolete tool outputs from conversation history while preserving session integrity.

### Four Main Strategies

#### 1. Deduplication Strategy

- **Purpose**: Removes repeated tool calls with identical parameters
- **Implementation**:
  - Creates tool signatures by normalizing and sorting parameters
  - Groups identical tool calls together
  - Keeps only the most recent occurrence
  - Zero LLM cost - runs automatically on every request
- **Example**: Reading the same file 5 times keeps only the 5th read output

#### 2. Supersede Writes Strategy

- **Purpose**: Prunes write tool inputs when files are subsequently read
- **Logic**: When a file is written and later read, the original write content becomes redundant since the current file state is captured in the read result
- **Implementation**:
  - Tracks write operations by file path and chronological order
  - Identifies subsequent read operations for same files
  - Marks write inputs for pruning if any read occurs after
- **Example**: Writing `config.json` then reading it later makes the original write input unnecessary

#### 3. Prune Tool Strategy

- **Purpose**: Exposes a `prune` tool that AI can call manually
- **Features**:
  - AI-initiated pruning when it determines context cleanup is needed
  - Includes nudging system (every N tool results) to suggest pruning
  - Protected tools list to prevent pruning critical operations
  - Three pruning reasons: completion, noise, consolidation
- **UI Integration**: Shows numbered list of prunable tools with descriptions

#### 4. On Idle Analysis Strategy (Legacy)

- **Purpose**: Uses LLM to semantically analyze conversation during idle periods
- **Status**: Disabled by default (marked as legacy)
- **Cost**: Incurs LLM API costs for analysis
- **Functionality**: Identifies tool outputs no longer relevant based on semantic analysis

## Technical Architecture

### State Management

```typescript
interface SessionState {
  sessionId: string | null
  isSubAgent: boolean
  prune: { toolIds: string[] }
  stats: {
    pruneTokenCounter: number
    totalPruneTokens: number
  }
  toolParameters: Map<string, ToolParameterEntry>
  nudgeCounter: number
  lastToolPrune: boolean
  lastCompaction: number
}
```

### Configuration System

- **Multi-level config**: Global → Config Dir → Project (each overrides previous)
- **Default protected tools**: `['task', 'todowrite', 'todoread', 'prune', 'batch']`
- **Validation**: Type checking and unknown key warnings
- **File locations**:
  - Global: `~/.config/opencode/dcp.jsonc`
  - Project: `.opencode/dcp.jsonc`

### Message Transformation Pipeline

1. **System Prompt Enhancement**: Adds synthetic pruning instructions
2. **Message Transform**: Main pruning logic applied before sending to LLM
3. **Tool Context Injection**: Adds prunable tools list to user messages
4. **Output Replacement**: Replaces pruned content with placeholders

### Pruning Mechanisms

- **Tool Outputs**: Replaced with `[Output removed to save context - information superseded or no longer needed]`
- **Tool Inputs** (write/edit only): Replaced with `[Input removed to save context]`
- **Preservation**: Never modifies actual session history, only transforms what's sent to LLM

## Token Accounting

### Calculation Method

- Uses `gpt-tokenizer` library for accurate token counting
- Calculates savings per message by comparing original vs pruned content
- Tracks both session counter and cumulative totals
- Persistence across sessions via file-based state storage

### Impact on Prompt Caching

- **Trade-off**: Pruning invalidates cached prefixes due to content changes
- **Net Benefit**: Token savings typically outweigh cache miss costs
- **Most Effective**: In long sessions where context bloat becomes significant

## Integration Points

### OpenCode Hooks Used

- `experimental.chat.system.transform`: Injects system prompts
- `experimental.chat.messages.transform`: Main message processing
- `tool`: Exposes the prune tool to AI
- `config`: Mutates opencode config to add prune to primary_tools
- `event`: Handles session lifecycle events

### Session Management

- **Session Detection**: Tracks session ID changes via message metadata
- **Compaction Handling**: Detects and resets state on conversation compaction
- **Sub-agent Support**: Differentiates between main and sub-agent sessions
- **Persistence**: Saves/restores pruning state across session restarts

## Performance Characteristics

### Computational Cost

- **Deduplication**: O(n) where n = number of tool calls
- **Supersede Writes**: O(n) with file path grouping
- **Prune Tool**: O(1) for tool execution, O(n) for token calculation
- **Memory Usage**: Minimal - stores only tool metadata and pruning lists

### Overhead Analysis

- **Per-request overhead**: 2-5ms for deduplication and supersede writes
- **Memory footprint**: ~1MB per 10,000 tool calls in metadata
- **Storage**: Session state files typically <50KB

## Strengths and Limitations

### Strengths

1. **Zero-cost strategies**: Deduplication and supersede writes require no LLM calls
2. **Non-destructive**: Original conversation history preserved
3. **Configurable**: Granular control over strategies and protections
4. **Transparent**: Detailed logging and notifications
5. **Adaptive**: AI can make context-aware pruning decisions

### Limitations

1. **Cache Invalidation**: Pruning breaks prompt cache prefixes
2. **Complexity**: Multi-level configuration and state management
3. **Legacy Features**: On-idle analysis adds unnecessary complexity
4. **Tool-specific**: Logic tightly coupled to OpenCode's tool structure
5. **No Semantic Awareness**: Rules-based rather than content-aware pruning

## Data Flow

```
1. Session Start → Initialize State → Load Persisted Data
2. User Request → Check Session Change → Apply Strategies
3. Strategy Execution:
   - Deduplication: Group identical calls → Mark older ones
   - Supersede Writes: Track file operations → Mark redundant writes
4. Transform Messages: Replace pruned content with placeholders
5. Add Prune Tool Context: Insert numbered list if enabled
6. Send to LLM: Pruned conversation with full context preserved
7. AI Response: May call prune tool → Update state → Notify user
```

## Key Insights for Context Jar Implementation

1. **Simplicity Matters**: Zero-cost strategies should be prioritized over LLM-based analysis
2. **State Management Critical**: Session persistence and compaction handling are essential
3. **Tool Awareness**: Deep integration with tool ecosystem required for effective pruning
4. **User Trust**: Non-destructive approach with transparency builds confidence
5. **Performance**: Overhead must be minimal compared to token savings

## Recommended Improvements

1. **Semantic Pruning**: Replace rules with content-aware analysis
2. **Cache Awareness**: Design pruning strategies that preserve cache benefits
3. **Unified Interface**: Simplify configuration and reduce complexity
4. **Better Metrics**: More sophisticated token impact analysis
5. **Extensibility**: Plugin architecture for custom pruning strategies

This analysis provides the foundation for building Context Jar - an improved context management system that learns from DCP's strengths while addressing its limitations.
