// Browser shim for cosmiconfig - provides empty implementation for browser environments
// Since config file loading only makes sense in Node.js environments

export function cosmiconfigSync() {
  return {
    search: () => null,
    load: () => null
  };
}

export function cosmiconfig() {
  return {
    search: async () => null,
    load: async () => null
  };
}

export default { cosmiconfig, cosmiconfigSync };