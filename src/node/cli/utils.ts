/**
 * Simple CLI utilities following "impossible simplicity" mantra
 */
import columnify from 'columnify';
import { bold, dim, green, red, yellow, blue, inverse, hidden } from 'yoctocolors';

/**
 * Helper to conditionally apply colors based on noColor flag
 */
const applyColor = (colorFn: (text: string) => string, text: string, noColor?: boolean): string => {
  return noColor ? text : colorFn(text);
};

/**
 * Message helper functions for consistent CLI output
 */
export const success = (msg: string, isJson?: boolean, noColor?: boolean) => {
  if (isJson) {
    console.log(JSON.stringify({ success: msg }, null, 2) + '\n');
  } else {
    console.log(`${applyColor(green, msg.toLowerCase().replace(/\.$/, ''), noColor)}\n`);
  }
};

export const error = (msg: string, isJson?: boolean, noColor?: boolean) => {
  if (isJson) {
    console.error(JSON.stringify({ error: msg }, null, 2) + '\n');
  } else {
    const errorPrefix = applyColor((text) => inverse(red(text)), `${applyColor(hidden, '[', noColor)}error${applyColor(hidden, ']', noColor)}`, noColor);
    const errorMsg = applyColor(red, msg.toLowerCase().replace(/\.$/, ''), noColor);
    console.error(`${errorPrefix} ${errorMsg}\n`);
  }
};

export const warn = (msg: string, isJson?: boolean, noColor?: boolean) => {
  if (isJson) {
    console.log(JSON.stringify({ warning: msg }, null, 2) + '\n');
  } else {
    const warnPrefix = applyColor((text) => inverse(yellow(text)), `${applyColor(hidden, '[', noColor)}warning${applyColor(hidden, ']', noColor)}`, noColor);
    const warnMsg = applyColor(yellow, msg.toLowerCase().replace(/\.$/, ''), noColor);
    console.log(`${warnPrefix} ${warnMsg}\n`);
  }
};

export const info = (msg: string, isJson?: boolean, noColor?: boolean) => {
  if (isJson) {
    console.log(JSON.stringify({ info: msg }, null, 2) + '\n');
  } else {
    const infoPrefix = applyColor((text) => inverse(blue(text)), `${applyColor(hidden, '[', noColor)}info${applyColor(hidden, ']', noColor)}`, noColor);
    const infoMsg = applyColor(blue, msg.toLowerCase().replace(/\.$/, ''), noColor);
    console.log(`${infoPrefix} ${infoMsg}\n`);
  }
};


/**
 * Format unix timestamp to ISO 8601 string without milliseconds, or return '-' if not provided
 */
export const formatTimestamp = (timestamp?: number, context: 'table' | 'details' = 'details', noColor?: boolean): string => {
  if (timestamp === undefined || timestamp === null || timestamp === 0) {
    return '-';
  }
  
  const isoString = new Date(timestamp * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  
  // Hide the T and Z characters only in table/list views for cleaner appearance
  if (context === 'table') {
    return isoString.replace(/T/, applyColor(hidden, 'T', noColor)).replace(/Z$/, applyColor(hidden, 'Z', noColor));
  }
  
  return isoString;
};

/**
 * Format value for display
 */
const formatValue = (key: string, value: any, context: 'table' | 'details' = 'details', noColor?: boolean): string => {
  if (typeof value === 'number' && (key === 'created' || key === 'expires' || key === 'verified')) {
    return formatTimestamp(value, context, noColor);
  }
  if (key === 'size' && typeof value === 'number') {
    const mb = value / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)}Mb` : `${(value / 1024).toFixed(1)}Kb`;
  }
  if (key === 'config') {
    // Handle both boolean and number (0/1) values
    if (typeof value === 'boolean') {
      return value ? 'yes' : 'no';
    }
    if (typeof value === 'number') {
      return value === 1 ? 'yes' : 'no';
    }
  }
  return String(value);
};

/**
 * Format data as table with specified columns for easy parsing
 * @param headerMap - Optional mapping of property names to display headers (e.g., { url: 'deployment' })
 */
export const formatTable = (data: any[], columns?: string[], noColor?: boolean, headerMap?: Record<string, string>): string => {
  if (!data || data.length === 0) return '';

  // Get column order from first item (preserves API order) or use provided columns
  const firstItem = data[0] || {};
  const columnOrder = columns || Object.keys(firstItem).filter(key =>
    firstItem[key] !== undefined && key !== 'verified' && key !== 'isCreate'
  );

  // Transform data preserving column order
  const transformedData = data.map(item => {
    const transformed: any = {};
    columnOrder.forEach(col => {
      if (col in item && item[col] !== undefined) {
        transformed[col] = formatValue(col, item[col], 'table', noColor);
      }
    });
    return transformed;
  });

  const output = columnify(transformedData, {
    columnSplitter: '   ', // Use 3 spaces for visual alignment
    columns: columnOrder, // Explicitly preserve order
    config: columnOrder.reduce((config, col) => {
      config[col] = {
        headingTransform: (heading: string) => applyColor(dim, headerMap?.[heading] || heading, noColor)
      };
      return config;
    }, {} as any)
  });
  
  // Clean output: remove null bytes and ensure clean spacing
  return output
    .split('\n')
    .map((line: string) => line
      .replace(/\0/g, '') // Remove any null bytes
      .replace(/\s+$/, '') // Remove trailing spaces
    )
    .join('\n') + '\n';
};

/**
 * Format object properties as key-value pairs with space separation for readability
 */
export const formatDetails = (obj: any, noColor?: boolean): string => {
  const entries = Object.entries(obj).filter(([key, value]) => {
    // Filter out internal properties only
    if (key === 'verified' || key === 'isCreate') return false;
    return value !== undefined;
  });
  
  if (entries.length === 0) return '';
  
  // Transform to columnify format while preserving order
  const data = entries.map(([key, value]) => ({
    property: key + ':',
    value: formatValue(key, value, 'details', noColor)
  }));
  
  const output = columnify(data, {
    columnSplitter: '  ',
    showHeaders: false,
    config: {
      property: { 
        dataTransform: (value: string) => applyColor(dim, value, noColor)
      }
    }
  });
  
  // Clean output: remove null bytes and ensure clean spacing
  return output
    .split('\n')
    .map((line: string) => line.replace(/\0/g, '')) // Remove any null bytes
    .join('\n') + '\n';
};

