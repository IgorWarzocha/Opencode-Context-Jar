# Context Jar

First feature: Task completion cleanup

## What it does

- Tracks files touched during task execution (read, edit, write)
- When task tool completes, cleans up outputs for tracked files
- Adds single message: "Context cleaned after task completion. Re-read any files you want to continue editing."

## Why this solves DCP pain #1 and #4

- No context pollution during normal conversation
- No pruning-recovery loops (task completion is natural boundary)
- Simple, predictable behavior

## Status

✅ Plugin compiles successfully  
✅ TypeScript type checking passes  
✅ Ready for testing with `opencode [project]`

## Next steps

1. Test with real OpenCode session
2. Add model-aware features
3. Extend with more intelligent strategies
