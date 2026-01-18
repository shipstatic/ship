# Ship CLI Development Guidelines

This file documents the CLI conventions and patterns established for the Ship SDK & CLI package.

## CLI Output Formatting Conventions

### Message Format Standards

The CLI uses consistent formatting for all user-facing messages:

**Success Messages:**
```
message (in green)
```
- Message in green, lowercase, trailing period removed
- Implementation: `success(msg)` outputs green text with newline

**Error Messages:**
```
[error] message (in red)
```
- Prefixed with inverse red `[error]` badge, followed by red message
- Implementation: `error(msg)` uses inverse red prefix + red message

**Warning Messages:**
```
[warning] message (in yellow)
```
- Prefixed with inverse yellow `[warning]` badge, followed by yellow message

**Info Messages:**
```
[info] message (in blue)
```
- Prefixed with inverse blue `[info]` badge, followed by blue message

### Table Output Format

Tables follow industry standards (ps, kubectl, docker) for maximum scriptability:

**Column Separation:**
- **3 spaces** between columns for visual alignment
- Uses `columnify` with `columnSplitter: '   '` (3 spaces)
- Headers are dimmed using `dim()` function

**Property Order Preservation:**
- Maintains exact API property order in all output
- No custom reordering - displays fields as received from API
- Critical for consistency and predictability

**Column Filtering for List Views:**
- **Deployments list**: Hides `files`, `size`, `status`, `expires` for cleaner output
- **Domains list**: Hides `status`, `verified` for cleaner output
- **Details views**: Show all fields - no filtering applied
- Filtering improves readability while maintaining scriptability

**Scriptability Features:**
```bash
# Examples of CLI scriptability with common Unix tools
ship deployments list | awk '{print $1}'           # Extract deployment names
ship deployments list | cut -d' ' -f1              # Alternative extraction
ship domains list | grep -E '^prod-'               # Filter by pattern
```

### Details Output Format

Key-value pairs use consistent spacing:

**Format:**
```
key: value
```
- **2 spaces** between key and value for readability
- Keys are dimmed, colons preserved for parsing standards
- Maintains API property order

## Output Parsing Standards

### Unix Tool Compatibility

The CLI is designed to work seamlessly with standard Unix text processing tools:

**Field Extraction:**
```bash
# Split by 2+ spaces to handle variable column widths
ship deployments list | awk -F'  +' '{print $1, $3}'

# Use cut with space delimiter (less reliable due to variable spacing)
ship deployments list | cut -d' ' -f1

# Parse with column command for perfect alignment
ship deployments list | column -t
```

**Null Byte Prevention:**
- All output is scrubbed of null bytes (`\0`)
- Ensures compatibility with all Unix text tools
- Prevents corruption in pipes and redirects

**Clean Output:**
- No trailing spaces on any lines
- Consistent newline handling
- ANSI codes properly contained

### Test Coverage

Comprehensive tests ensure scriptability:

**Property Order Tests:** (`tests/cli/property-order.test.ts`)
- Verifies API property order preservation
- Tests space separation patterns
- Validates Unix tool parsing compatibility

**Output Formatting Tests:** (`tests/cli/output-formatting.test.ts`)
- Confirms message format consistency
- Validates ANSI code sequences
- Tests error/success message patterns

## Implementation Details

### Key Files

- `src/cli/utils.ts` - Core formatting functions
- `src/cli/index.ts` - CLI command implementations
- Uses `yoctocolors` for consistent color handling
- Uses `columnify` for table alignment

### Timestamp Formatting

**Context-Aware Formatting:**
- **List/Table views**: `T` and `Z` characters are dimmed for better visual separation
- **Details views**: Standard ISO format without dimming for clean copy/paste
- **Implementation**: `formatTimestamp(timestamp, context)` with 'table' or 'details' context

### Critical Functions

**`formatTable(data)`:**
- Preserves API property order using `Object.keys(firstItem)`
- Filters internal properties (`verified`, `isCreate`)
- Uses 3-space column separation
- Removes null bytes and trailing spaces

**`formatDetails(obj)`:**
- Maintains property insertion order
- Uses 2-space key-value separation
- Filters internal properties
- Preserves colon format for parsing standards

## Design Philosophy

### Scriptability First
- Every output format is designed for Unix tool compatibility
- Space-separated fields with consistent patterns
- Predictable column positions and field counts

### Human Readable
- Visual alignment for table headers and data
- Consistent spacing and formatting
- Color coding for success/error states

### API Consistency
- Property order matches API responses exactly
- No CLI-specific field reordering or transformation
- Maintains data integrity throughout the display pipeline

## Testing Philosophy

All CLI formatting changes must:
1. Pass comprehensive property order tests
2. Maintain Unix tool parsing compatibility
3. Preserve visual alignment standards
4. Follow established message formatting conventions

The test suite includes 14+ property order tests and 18+ output formatting tests to ensure these standards are maintained.

## Commander.js Option Parsing

### Overview

The Ship CLI uses Commander.js for command-line argument parsing. This section documents key learnings about how Commander.js handles options in nested command structures.

### The Parent/Subcommand Option Conflict

**Problem:** When both a parent program and its subcommands define the same option (e.g., `--tag`), Commander.js may route option values to the program level instead of the subcommand level.

**Example Structure:**
```
ship deploy --tag foo        (shortcut command on program)
ship deployments create --tag foo  (subcommand)
```

When both `program.option('--tag')` and `subcommand.option('--tag')` exist, the `--tag` value can be captured by the program's option definition instead of the subcommand's.

### Solution: Option Merging Pattern

In each action handler, merge options from both the program and command levels:

```typescript
.action(async (directory, cmdOptions) => {
  const programOpts = program.opts();

  // Prefer command-level options, fall back to program-level
  const tagArray = cmdOptions?.tag?.length > 0
    ? cmdOptions.tag
    : programOpts.tag;

  // Use tagArray for the actual operation...
});
```

### Required Commander.js Configuration

For proper option handling in parent/child command structures:

1. **Enable positional options on parent commands:**
   ```typescript
   const deployments = program
     .command('deployments')
     .enablePositionalOptions();
   ```

2. **Pass through options on subcommands:**
   ```typescript
   deployments
     .command('create')
     .passThroughOptions()
     .option('-t, --tag <tags...>', 'Add tags')
     .action(...);
   ```

### Affected Commands

The following commands use this pattern:
- `deployments create` - Merges tags from program/command
- `domains set` - Merges tags from program/command
- `tokens create` - Merges options from program/command
- `deploy` shortcut - Defines its own `--tag` option

### Testing Shortcut Parity

The test suite includes "deploy shortcut parity" tests that verify shortcuts and long commands produce identical results:

```typescript
describe('deploy shortcut parity', () => {
  it('should support --tag flag on shortcut');
  it('should support multiple --tag flags on shortcut');
  it('should produce same result with shortcut and long command');
});
```

This ensures that `ship deploy --tag foo` behaves identically to `ship deployments create --tag foo`.