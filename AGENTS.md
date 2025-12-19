# OpenCode Context Jar Plugin - Agent Guidelines

## Development Commands
- `npm run build` - Clean and compile TypeScript to dist/
- `npm run typecheck` - Run TypeScript type checking without emitting files
- `npm run dev` - Start OpenCode plugin development mode
- `npm run clean` - Remove dist/ directory

## Code Style & Conventions

### Import Style
- Use `import type` for type-only imports
- Group external imports first, then internal imports
- Use destructuring for multiple imports from same module

### TypeScript
- Strict mode enabled (`strict: true`)
- Use explicit return types for exported functions
- Prefer interfaces for object shapes, types for unions/primitives
- Use `Record<string, unknown>` for generic objects, not `any`

### Error Handling
- Use try/catch blocks with empty catch when errors are expected/ignored
- Return `null` or `undefined` for expected failure cases
- Use boolean returns for success/failure operations

### Naming Conventions
- Use PascalCase for types, interfaces, and exported constants
- Use camelCase for functions and variables
- Use kebab-case for file names
- Use descriptive names with context (e.g., `createWhitelistConfig`)

### Code Organization
- One export per file when possible
- Use comments for file purpose and design decisions
- Keep functions small and focused
- Use early returns and guard clauses

### File Patterns
- All source files in src/ directory
- Test files excluded from TypeScript compilation
- JSONC configuration files with inline comments