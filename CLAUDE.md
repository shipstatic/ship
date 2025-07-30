# Ship CLI Development Guidelines

This file documents the CLI conventions and patterns established for the Ship SDK & CLI package.

## CLI Output Formatting Conventions

### Message Format Standards

The CLI uses consistent formatting for all user-facing messages:

**Success Messages:**
```
message ✓
```
- Message first, followed by a space and bold green check mark
- Implementation: `success(msg)` uses `${msg} ${bold(green('✓'))}\n`

**Error Messages:**
```
error: message ✗
```
- Prefixed with "error: ", followed by message and bold red cross mark
- Implementation: `error(msg)` uses `error: ${msg} ${bold(red('✗'))}\n`

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
- **Aliases list**: Hides `status`, `confirmed` for cleaner output
- **Details views**: Show all fields - no filtering applied
- Filtering improves readability while maintaining scriptability

**Scriptability Features:**
```bash
# Examples of CLI scriptability with common Unix tools
ship deployments list | awk '{print $1}'           # Extract deployment names
ship deployments list | cut -d' ' -f1              # Alternative extraction
ship aliases list | grep -E '^prod-'               # Filter by pattern
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