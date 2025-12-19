# OpenCode Context Jar

<div align="center">

![Context Jar Banner](Gemini_Generated_Image_pu8mbupu8mbupu8m.png)

**Intelligent context management plugin for OpenCode**

Consolidates file operations, prevents context bloat, and maintains clean conversation history.

[![npm version](https://badge.fury.io/js/%40opencode%2Fcontext-jar.svg)](https://badge.fury.io/js/%40opencode%2Fcontext-jar)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg)](http://www.typescriptlang.org/)

</div>

## What It Does

### Context Cleanup & Consolidation
- **Prevents confusion from stacked file states**: When you read, edit, and re-read the same file multiple times, Context Jar consolidates all those operations into a single, up-to-date file view
- **Redundant tool output removal**: Removes old `read`, `edit`, `write`, and `multiedit` tool calls that are no longer relevant
- **Smart consolidation**: Only consolidates files that have been read (avoiding unnecessary context expansion)

### Task Invalidation Tracking
- **Subagent awareness**: When a `task` tool runs a subagent that modifies files, Context Jar marks those files as invalidated
- **Fresh content enforcement**: The main agent must re-read invalidated files to get the latest content
- **Cross-session tracking**: Tracks file changes across subagent sessions automatically

### Model-Aware Processing
- **Selective activation**: Only runs context cleanup for specified models via whitelist configuration
- **Model-specific overrides**: Allows different cleanup behavior per tool/model combination
- **Bypass capability**: Can skip cleanup entirely for certain models

### File Protection
- **Protected file types**: Configurable protection for documentation files (`.md`, `.txt`), configs (`*.json`), and patterns (`README*`, `*.config.*`)
- **Preservation rules**: Protected files are excluded from cleanup operations
- **Flexible patterns**: Support both extension-based and glob-like pattern matching

### Session Boundary Management
- **Idle finalization**: Creates clean, canonical file states at session boundaries
- **Synthetic reads**: Generates single consolidated read operations for edited files
- **Next-step preparation**: Ensures each new session step starts from clean file context

## Configuration

Context Jar uses a JSONC configuration file at `~/.config/opencode/context-jar.jsonc`:

```jsonc
{
  // List of models that will have context cleanup applied
  "allowedModels": [
    "anthropic/claude-3-5-sonnet-20241022",
    "openai/gpt-4o",
    "anthropic/claude-3-haiku-20240307"
  ],
  // Whether to enforce the whitelist (false = allow all models)
  "enforced": true,
  // Override models for specific tools
  "toolOverrides": {
    "task": "anthropic/claude-3-haiku-20240307"
  },
  // File protection settings
  "protectedFiles": {
    "extensions": [".md", ".txt"],
    "patterns": ["*.config.*", "README*", "*.json"]
  }
}
```

## Usage

Context Jar runs automatically in the background during OpenCode sessions. You'll see periodic summaries showing:

- Token savings from context cleanup
- Number of files consolidated vs invalidated
- Net reduction in context size

Example summary output:
```
▣ Context Jar | latest consolidation snapshot
▣ Total: ~15.2K → ~8.7K (~6.5K saved)
▣ Read: ~12.1K → ~6.3K (~5.8K saved)
▣ Edit: ~3.1K → ~2.4K (~0.7K saved)
▣ Files: 3 consolidated, 1 invalidated
▣ Net: saved
```

## Installation

```bash
npm install @opencode/context-jar
```

## Development

```bash
# Clone the repository
git clone https://github.com/opencode/context-jar.git
cd context-jar

# Install dependencies
npm install

# Build the plugin
npm run build

# Run type checking
npm run typecheck

# Start development mode
npm run dev

# Clean build artifacts
npm run clean
```

## Architecture

- **`src/index.ts`**: Main plugin entry point and event handlers
- **`src/cleanup.ts`**: Core context consolidation logic
- **`src/finalize.ts`**: Session boundary finalization
- **`src/task-invalidation.ts`**: Subagent change tracking
- **`src/whitelist.ts`**: Model validation logic
- **`src/patterns.ts`**: File protection pattern matching
- **`src/stats.ts`**: Token usage tracking and reporting
- **`src/summary.ts`**: User-facing summary generation
- **`src/types.ts`**: TypeScript type definitions
- **`src/config.ts`**: Configuration file management

## Technical Details

### Two Cleanup Strategies

1. **Regular Cleanup** (`cleanupMessagesForContextJar`): 
   - Conservative approach during active conversation
   - Keeps exactly one completed `read` tool part per file (if original read existed)
   - Rewrites read output to latest known content

2. **Finalization** (`finalizeEditedFilesForNextStep`):
   - More aggressive cleanup at session boundaries
   - Creates synthetic read operations for all edited files
   - Ensures clean starting state for next session step

### Cache Compatibility
- **Prefix preservation**: Maintains cache-friendly conversation prefixes
- **Minimal disruption**: Only removes what's necessary to prevent confusion
- **LLM-friendly**: Preserves conversation flow and context

### Token Estimation
- Uses GPT tokenizer for accurate token counting
- Tracks before/after token usage for transparency
- Reports detailed savings statistics

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Disclaimer

**This is a community-developed plugin and is not officially maintained or supported by the OpenCode development team.** 

The OpenCode developers are not responsible for any issues, data loss, or problems that may arise from using this plugin. Use at your own risk.

For official OpenCode support and documentation, please visit the official OpenCode repository.

## Acknowledgments

- Built with the [OpenCode Plugin SDK](https://github.com/opencode/plugin)
- Inspired by the need for intelligent context management in AI-assisted development
- Community contribution to the OpenCode ecosystem

---

**Context Jar represents a pragmatic approach to context management - reducing bloat while preserving conversation flow and maintaining compatibility with LLM caching systems.**