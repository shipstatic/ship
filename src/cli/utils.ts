/**
 * Simple CLI utilities following "impossible simplicity" mantra
 */
import columnify from 'columnify';

/**
 * Style functions for terminal output
 */
export const strong = (text: string) => `\x1b[1m${text}\x1b[0m`;
export const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

/**
 * Message helper functions for consistent CLI output
 */
export const success = (msg: string) => console.log(`\n\x1b[32m●\x1b[0m ${msg}\n`);
export const error = (msg: string) => console.error(`\n\x1b[31m●\x1b[0m ${msg}\n`);
export const warn = (msg: string) => console.log(`\n\x1b[33m●\x1b[0m ${msg}\n`);
export const info = (msg: string) => console.log(`\n\x1b[34m●\x1b[0m ${msg}\n`);

/**
 * Format unix timestamp to local date string, or return '-' if not provided
 */
export const formatTimestamp = (timestamp?: number): string => {
  return timestamp !== undefined && timestamp !== null && timestamp !== 0 
    ? new Date(timestamp * 1000).toLocaleDateString() 
    : '-';
};

/**
 * Clears the current line in the terminal if in TTY mode,
 * otherwise adds a newline to maintain command composability
 */
export const clearLine = (): void => {
  // Only use terminal control sequences if we're connected to a TTY
  if (process.stdout.isTTY) {
    // Use carriage return to move cursor to beginning of line and ANSI escape to clear line
    process.stdout.write('\r\x1b[K');
  } else {
    // In non-TTY mode (pipes, redirects), just output a newline to maintain composability
    process.stdout.write('\n');
  }
};

/**
 * Format data as columns with subtle spacing, bold headers, empty lines, and indentation
 */
export const formatColumns = (data: any[]): string => {
  const table = columnify(data, {
    columnSplitter: '   ',
    config: {
      // Apply strong formatting to all column headers dynamically
      ...Object.keys(data[0] || {}).reduce((config, key) => {
        config[key] = { headingTransform: (heading: string) => strong(heading) };
        return config;
      }, {} as any)
    }
  });
  
  // Add indentation to each line and wrap with empty lines
  const indentedTable = table
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n');
  
  return `\n${indentedTable}\n`;
};

/**
 * Format object properties in two columns with prioritized properties first
 */
export const formatProperties = (obj: any): string => {
  // Define priority properties for deployments and aliases
  const deploymentPriority = ['deployment', 'url', 'createdAt', 'expiresAt'];
  const aliasPriority = ['alias', 'url', 'deploymentName', 'status', 'confirmedAt'];
  
  // Determine which type this is and get priority list
  const isProbablyDeployment = 'deployment' in obj;
  const priorityList = isProbablyDeployment ? deploymentPriority : aliasPriority;
  
  // Get all properties excluding internal ones
  const allEntries = Object.entries(obj).filter(([key, value]) => {
    if (key === 'verifiedAt' || key === 'isCreate') return false;
    return value !== undefined;
  });
  
  // Separate priority and additional properties
  const priorityEntries: [string, any][] = [];
  const additionalEntries: [string, any][] = [];
  
  allEntries.forEach(([key, value]) => {
    if (priorityList.includes(key)) {
      priorityEntries.push([key, value]);
    } else {
      additionalEntries.push([key, value]);
    }
  });
  
  // Sort priority entries by their order in priority list
  priorityEntries.sort(([a], [b]) => priorityList.indexOf(a) - priorityList.indexOf(b));
  
  // Helper function to format key names to human readable
  const formatKeyName = (key: string): string => {
    const keyMappings: Record<string, string> = {
      deployment: 'DEPLOYMENT',
      url: 'URL',
      createdAt: 'CREATED',
      expiresAt: 'EXPIRES',
      alias: 'ALIAS',
      deploymentName: 'DEPLOYMENT',
      status: 'STATUS',
      confirmedAt: 'CONFIRMED',
      filesCount: 'Files count',
      totalSize: 'Total size',
      hasConfig: 'Has config'
    };
    return keyMappings[key] || key;
  };
  
  // Helper function to format values to human readable
  const formatValue = (key: string, value: any): string => {
    if (value instanceof Date) {
      return value.toLocaleDateString();
    }
    if (typeof value === 'number' && key.includes('At')) {
      return formatTimestamp(value);
    }
    if (key === 'totalSize' && typeof value === 'number') {
      // Convert bytes to human readable format
      const mb = value / (1024 * 1024);
      return mb >= 1 ? `${mb.toFixed(1)}Mb` : `${(value / 1024).toFixed(1)}Kb`;
    }
    if (key === 'hasConfig' && typeof value === 'boolean') {
      return value ? 'yes' : 'no';
    }
    return String(value);
  };
  
  const lines: string[] = [];
  
  // Add priority properties
  if (priorityEntries.length > 0) {
    const maxPriorityLength = Math.max(...priorityEntries.map(([key]) => formatKeyName(key).length));
    priorityEntries.forEach(([key, value]) => {
      const formattedKey = formatKeyName(key).padStart(maxPriorityLength);
      const formattedValue = formatValue(key, value);
      lines.push(`  ${formattedKey}  ${formattedValue}`);
    });
  }
  
  // Add separator if there are additional properties
  if (additionalEntries.length > 0) {
    lines.push('');
  }
  
  // Add additional properties
  if (additionalEntries.length > 0) {
    const maxAdditionalLength = Math.max(...additionalEntries.map(([key]) => formatKeyName(key).length));
    additionalEntries.forEach(([key, value]) => {
      const formattedKey = formatKeyName(key).padStart(maxAdditionalLength);
      const formattedValue = formatValue(key, value);
      lines.push(`  ${formattedKey}  ${formattedValue}`);
    });
  }
  
  return `\n${lines.join('\n')}\n`;
};
