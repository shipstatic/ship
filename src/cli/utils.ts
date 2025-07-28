/**
 * Simple CLI utilities following "impossible simplicity" mantra
 */
import columnify from 'columnify';
import { bold, dim, green, red, yellow, blue } from 'yoctocolors';

/**
 * Message helper functions for consistent CLI output
 */
export const success = (msg: string) => console.log(`${green('●')} ${msg}`);
export const error = (msg: string) => console.error(`${red('●')} ${msg}`);
export const warn = (msg: string) => console.log(`${yellow('●')} ${msg}`);
export const info = (msg: string) => console.log(`${blue('●')} ${msg}`);

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
 * Transform camelCase property names to natural labels
 * eg: filesCount => Files count, status => Status
 */
export const toNaturalLabel = (key: string): string => {
  // Handle special cases
  const specialCases: Record<string, string> = {
    url: 'URL'
  };
  
  if (specialCases[key]) {
    return specialCases[key];
  }
  
  // Split camelCase into words and capitalize first letter only
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
};

/**
 * Format value for display
 */
const formatValue = (key: string, value: any): string => {
  if (typeof value === 'number' && key.includes('At')) {
    return formatTimestamp(value);
  }
  if (key === 'totalSize' && typeof value === 'number') {
    const mb = value / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)}Mb` : `${(value / 1024).toFixed(1)}Kb`;
  }
  if (key === 'hasConfig') {
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
 * Format data as table with dim natural headers
 */
export const formatTable = (data: any[]): string => {
  if (!data || data.length === 0) return '';
  
  // Define display order for different resource types
  const deploymentListOrder = ['deployment', 'url', 'createdAt', 'expiresAt'];
  const aliasOrder = ['alias', 'url', 'deploymentName', 'status', 'confirmedAt', 'createdAt'];
  
  // Determine which type this is based on first item
  const isDeployment = 'deployment' in (data[0] || {});
  const order = isDeployment ? deploymentListOrder : aliasOrder;
  
  // Transform data to use natural labels as keys, in the specified order
  const transformedData = data.map(item => {
    const transformed: any = {};
    
    // Only add properties that are in the specified order
    order.forEach(key => {
      if (key in item && item[key] !== undefined) {
        const naturalKey = toNaturalLabel(key);
        transformed[naturalKey] = formatValue(key, item[key]);
      }
    });
    
    return transformed;
  });
  
  return columnify(transformedData, {
    columnSplitter: '   ',
    config: {
      ...Object.keys(transformedData[0] || {}).reduce((config, key) => {
        config[key] = { headingTransform: (heading: string) => dim(heading) };
        return config;
      }, {} as any)
    }
  });
};

/**
 * Format object properties as key-value pairs with dim labels
 */
export const formatDetails = (obj: any): string => {
  const allEntries = Object.entries(obj).filter(([key, value]) => {
    // Filter out internal properties
    if (key === 'verifiedAt' || key === 'isCreate') return false;
    return value !== undefined;
  });
  
  if (allEntries.length === 0) return '';
  
  // Define display order for different resource types
  const deploymentOrder = ['deployment', 'url', 'filesCount', 'totalSize', 'hasConfig', 'status', 'createdAt', 'expiresAt'];
  const aliasOrder = ['alias', 'url', 'deploymentName', 'status', 'confirmedAt', 'createdAt'];
  
  // Determine which type this is
  const isDeployment = 'deployment' in obj;
  const order = isDeployment ? deploymentOrder : aliasOrder;
  
  // Sort entries by the defined order
  const sortedEntries = allEntries.sort(([keyA], [keyB]) => {
    const indexA = order.indexOf(keyA);
    const indexB = order.indexOf(keyB);
    
    // If both keys are in the order array, sort by their position
    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    }
    
    // If only keyA is in the order array, it comes first
    if (indexA !== -1) return -1;
    
    // If only keyB is in the order array, it comes first
    if (indexB !== -1) return 1;
    
    // If neither key is in the order array, maintain original order
    return 0;
  });
  
  // Find max label length for alignment
  const maxLength = Math.max(...sortedEntries.map(([key]) => toNaturalLabel(key).length));
  
  return sortedEntries
    .map(([key, value]) => {
      const label = toNaturalLabel(key).padStart(maxLength);
      const formattedValue = formatValue(key, value);
      return `${dim(label)}  ${formattedValue}`;
    })
    .join('\n');
};

// Legacy aliases for backwards compatibility
export const formatColumns = formatTable;
export const formatProperties = formatDetails;
