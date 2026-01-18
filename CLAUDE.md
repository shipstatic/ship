# Ship SDK & CLI Development Guidelines

## Code Style: Functional over Class-Based

We prefer functional patterns over class-based inheritance:

- **Factory functions** over class constructors (e.g., `createDeploymentResource()`)
- **Pure functions** for data transformation (formatters, validators)
- **Composition** over inheritance
- Classes are acceptable for stateful objects (`Ship` client, `ApiHttp`) but keep them minimal

This explains patterns like passing `getApi` and `ensureInit` callbacks to resource factories - it's intentional functional composition, not a workaround.

## Testing

### Quick Reference

```bash
pnpm test --run              # All tests (~40s)
pnpm test:unit --run         # Pure functions only (~1s)
pnpm test:integration --run  # SDK/CLI with mock server (~40s)
pnpm test:e2e --run          # Real API (requires SHIP_E2E_API_KEY)
```

### Test Types by Filename

| Pattern | Description | Mock Server |
|---------|-------------|-------------|
| `*.unit.test.ts` | Pure functions, no I/O | No |
| `*.test.ts` | SDK/CLI with mocked API | Yes |
| `*.e2e.test.ts` | Real API integration | No (real API) |

### Directory Structure

```
tests/
├── shared/           # Shared code tests (lib, api, resources)
├── browser/          # Browser-specific tests
├── node/             # Node SDK + CLI tests
├── integration/      # Cross-environment parity tests
├── e2e/              # Real API smoke tests
├── fixtures/         # Typed API response fixtures
├── mocks/            # Mock HTTP server
└── setup.ts          # Mock server lifecycle
```

### Writing Tests

**Pure functions** → `*.unit.test.ts`
- No imports from `tests/mocks/`
- No network I/O

**SDK/CLI with API** → `*.test.ts`
- Import fixtures from `tests/fixtures/api-responses.ts`
- Use `resetMockServer()` in `beforeEach`

**Real API** → `*.e2e.test.ts`
- Use `describe.skipIf(!E2E_ENABLED)` pattern
- Clean up resources in `afterAll`
- Run with: `SHIP_E2E_API_KEY=ship-xxx pnpm test:e2e --run`

### Mock Server

The mock server runs on `http://localhost:3000` and uses typed fixtures:

```typescript
import { deployments, errors } from '../fixtures/api-responses';

// Type-safe with compile-time validation via `satisfies`
expect(result).toMatchObject(deployments.success);
```

When API changes:
1. Update types in `@shipstatic/types`
2. Update fixtures (TypeScript errors if shapes don't match)
3. Mock server automatically uses new fixtures

**Important:** Tests run sequentially (`fileParallelism: false`) to share the mock server reliably.

## CLI Output Conventions

### Message Formats

| Type | Format | Color |
|------|--------|-------|
| Success | `message` | Green |
| Error | `[error] message` | Red |
| Warning | `[warning] message` | Yellow |
| Info | `[info] message` | Blue |

### Table Output

- **3 spaces** between columns (industry standard: ps, kubectl, docker)
- Headers are dimmed
- Property order matches API response exactly
- Internal fields filtered: `verified`, `isCreate`

### Details Output

- **2 spaces** between key and value
- Keys are dimmed
- Colon preserved for parsing

### Scriptability

```bash
ship deployments list | awk '{print $1}'      # Extract first column
ship domains list | grep -E '^prod-'          # Filter by pattern
```

## Key Files

| File | Purpose |
|------|---------|
| `src/node/cli/index.ts` | CLI command definitions |
| `src/node/cli/utils.ts` | Formatting functions (`formatTable`, `success`, `error`) |
| `src/node/cli/formatters.ts` | Resource-specific output formatters |
| `src/shared/resources.ts` | SDK resource implementations |
| `src/shared/api/http.ts` | HTTP client with events |

## Commander.js Patterns

### Option Merging for Parent/Subcommand Conflicts

When both parent and subcommand define `--tag`:

```typescript
.action(async (directory, cmdOptions) => {
  const programOpts = program.opts();
  const tagArray = cmdOptions?.tag?.length > 0 ? cmdOptions.tag : programOpts.tag;
});
```

### Required Configuration

```typescript
// Parent command
const deployments = program.command('deployments').enablePositionalOptions();

// Subcommand
deployments.command('create').passThroughOptions().option('-t, --tag <tags...>');
```

## Design Principles

1. **Scriptability first** - All output works with Unix tools
2. **API consistency** - Property order matches API exactly
3. **Impossible simplicity** - Everything should "just work"
4. **No backward compatibility baggage** - Remove unused code aggressively
