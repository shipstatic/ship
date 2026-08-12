/**
 * Simple CLI utilities following "impossible simplicity" mantra
 */
import type { ShipError } from '@shipstatic/types';
import columnify from 'columnify';
import { blue, dim, green, hidden, inverse, red, yellow } from 'yoctocolors';

const INTERNAL_FIELDS = ['isCreate', 'claim'];

const applyColor = (colorFn: (text: string) => string, text: string, noColor?: boolean): string => {
  return noColor ? text : colorFn(text);
};

/** A non-null, non-array object — the shape that needs key-value rendering. */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Wire messages are displayed verbatim — identifiers, paths, and acronyms
// must survive formatting. The CLI's lowercase opening applies to the leading
// sentence word only, and only when it's an ordinary capitalized word (never
// "DNS", a quoted key, or a path).
const decapitalize = (msg: string): string =>
  /^[A-Z][a-z]/.test(msg) ? msg.charAt(0).toLowerCase() + msg.slice(1) : msg;

/**
 * The text channel's typography: lowercase opening, no trailing period.
 *
 * Exported because it is not a property of the message ENVELOPES — a rendered
 * answer wants the same look without claiming to be a success, a warning or a
 * failure. `domains validate` is the case: its negative verdict is data, not
 * one of the three kinds.
 */
export const plainMessage = (msg: string): string => decapitalize(msg).replace(/\.$/, '');

/**
 * The CLI's message envelopes. Each carries a sentence the CLI composed, so
 * `--json` wraps it as `{ kind: message }` — none of the three has a wire
 * counterpart to defer to. Failures do; see `error` below, which is shaped by
 * the wire instead and is deliberately not one of these.
 */
export const success = (msg: string, json?: boolean, noColor?: boolean) => {
  if (json) {
    console.log(`${JSON.stringify({ success: msg }, null, 2)}\n`);
  } else {
    console.log(`${applyColor(green, plainMessage(msg), noColor)}\n`);
  }
};

export const warn = (msg: string, json?: boolean, noColor?: boolean) => {
  if (json) {
    console.log(`${JSON.stringify({ warning: msg }, null, 2)}\n`);
  } else {
    const warnPrefix = applyColor(
      (text) => inverse(yellow(text)),
      `${applyColor(hidden, '[', noColor)}warning${applyColor(hidden, ']', noColor)}`,
      noColor,
    );
    const warnMsg = applyColor(yellow, plainMessage(msg), noColor);
    console.log(`${warnPrefix} ${warnMsg}\n`);
  }
};

export const info = (msg: string, json?: boolean, noColor?: boolean) => {
  if (json) {
    console.log(`${JSON.stringify({ info: msg }, null, 2)}\n`);
  } else {
    const infoPrefix = applyColor(
      (text) => inverse(blue(text)),
      `${applyColor(hidden, '[', noColor)}info${applyColor(hidden, ']', noColor)}`,
      noColor,
    );
    const infoMsg = applyColor(blue, plainMessage(msg), noColor);
    console.log(`${infoPrefix} ${infoMsg}\n`);
  }
};

/**
 * Emit a failure on stderr. **Text translates, JSON transmits.**
 *
 * The two channels carry different words on purpose. Text renders the string
 * it is handed — the CLI's own actionable copy, composed by `getUserMessage`.
 * JSON emits the platform's `ErrorResponse` verbatim, so `error` names the
 * `ErrorType` exactly as the API and the SDK produce it and a script branches
 * on the same typed field everywhere.
 *
 * A bare string is therefore accepted for the text channel only: a message
 * with no type has no wire shape to emit, and the overloads make writing one
 * into `--json` a compile error rather than a convention.
 */
export function error(err: ShipError, json?: boolean, noColor?: boolean): void;
export function error(msg: string, json: false | undefined, noColor?: boolean): void;
export function error(err: ShipError | string, json?: boolean, noColor?: boolean): void {
  if (json && typeof err !== 'string') {
    console.error(`${JSON.stringify(err.toResponse(), null, 2)}\n`);
    return;
  }
  const errorPrefix = applyColor(
    (text) => inverse(red(text)),
    `${applyColor(hidden, '[', noColor)}error${applyColor(hidden, ']', noColor)}`,
    noColor,
  );
  const message = typeof err === 'string' ? err : err.message;
  const errorMsg = applyColor(red, plainMessage(message), noColor);
  console.error(`${errorPrefix} ${errorMsg}\n`);
}

/**
 * Format unix timestamp to ISO 8601 string without milliseconds, or return '-' if not provided
 */
export const formatTimestamp = (
  timestamp?: number,
  context: 'table' | 'details' = 'details',
  noColor?: boolean,
): string => {
  if (timestamp === undefined || timestamp === null || timestamp === 0) {
    return '-';
  }

  const isoString = new Date(timestamp * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

  // Hide the T and Z characters only in table/list views for cleaner appearance
  if (context === 'table') {
    return isoString
      .replace(/T/, applyColor(hidden, 'T', noColor))
      .replace(/Z$/, applyColor(hidden, 'Z', noColor));
  }

  return isoString;
};

/**
 * Format value for display.
 * Handles timestamps, file sizes, and boolean configs with special formatting.
 */
const formatValue = (
  key: string,
  value: unknown,
  context: 'table' | 'details' = 'details',
  noColor?: boolean,
): string => {
  if (value === null || (Array.isArray(value) && value.length === 0)) return '-';
  if (
    typeof value === 'number' &&
    (key === 'created' ||
      key === 'activated' ||
      key === 'expires' ||
      key === 'linked' ||
      key === 'grace' ||
      // `used` is unix seconds on both Token and Account (the API key's
      // last-use instant) — without this it renders as a raw integer.
      key === 'used')
  ) {
    return formatTimestamp(value, context, noColor);
  }
  if (key === 'size' && typeof value === 'number') {
    const mb = value / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)}Mb` : `${(value / 1024).toFixed(1)}Kb`;
  }
  // Boolean signal columns (config, password) render as yes/no in details.
  if (key === 'config' || key === 'password') {
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
    if (typeof value === 'number') return value === 1 ? 'yes' : 'no';
  }
  // Table and details are flat key-value surfaces, so a nested object
  // flattens to inline `k=v` pairs rather than nesting a second layout
  // inside a cell. Structural, not per-key: values recurse through
  // formatValue, so a nested timestamp or size formats like any other.
  if (isPlainObject(value)) {
    const pairs = Object.entries(value);
    if (pairs.length === 0) return '-';
    return pairs.map(([k, v]) => `${k}=${formatValue(k, v, context, noColor)}`).join(', ');
  }
  return String(value);
};

/**
 * Format data as table with specified columns for easy parsing.
 * @param data - Array of objects to display as table rows
 * @param columns - Optional column order (defaults to first item's keys)
 * @param noColor - Disable colors
 * @param headerMap - Optional mapping of property names to display headers
 */
export const formatTable = (
  data: object[],
  columns?: string[],
  noColor?: boolean,
  headerMap?: Record<string, string>,
): string => {
  if (!data || data.length === 0) return '';

  // Get column order from first item (preserves API order) or use provided columns
  const firstItem = data[0] as Record<string, unknown>;
  const columnOrder =
    columns ||
    Object.keys(firstItem).filter(
      (key) => firstItem[key] !== undefined && !INTERNAL_FIELDS.includes(key),
    );

  // Transform data preserving column order
  const transformedData = data.map((item) => {
    const record = item as Record<string, unknown>;
    const transformed: Record<string, string> = {};
    columnOrder.forEach((col) => {
      if (col in record && record[col] !== undefined) {
        transformed[col] = formatValue(col, record[col], 'table', noColor);
      }
    });
    return transformed;
  });

  const output = columnify(transformedData, {
    columnSplitter: '   ',
    columns: columnOrder,
    config: columnOrder.reduce<Record<string, { headingTransform: (h: string) => string }>>(
      (config, col) => {
        config[col] = {
          headingTransform: (heading: string) =>
            applyColor(dim, headerMap?.[heading] || heading, noColor),
        };
        return config;
      },
      {},
    ),
  });

  // columnify pads every cell to its column width, so the last column of a
  // short row ends in spaces nobody asked for — visible the moment output is
  // piped into anything that cares.
  return `${output
    .split('\n')
    .map((line: string) => line.replace(/\s+$/, ''))
    .join('\n')}\n`;
};

/**
 * Format object properties as key-value pairs with space separation for readability.
 * @param obj - Object to display as key-value pairs
 * @param noColor - Disable colors
 */
export const formatDetails = (obj: object, noColor?: boolean): string => {
  const entries = (Object.entries(obj) as [string, unknown][]).filter(([key, value]) => {
    if (INTERNAL_FIELDS.includes(key)) return false;
    return value !== undefined;
  });

  if (entries.length === 0) return '';

  // Transform to columnify format while preserving order
  const data = entries.map(([key, value]) => ({
    property: `${key}:`,
    value: formatValue(key, value, 'details', noColor),
  }));

  const output = columnify(data, {
    columnSplitter: '  ',
    showHeaders: false,
    config: {
      property: {
        dataTransform: (value: string) => applyColor(dim, value, noColor),
      },
    },
  });

  return `${output}\n`;
};
