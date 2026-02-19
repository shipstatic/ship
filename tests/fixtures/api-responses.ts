/**
 * @file Typed API response fixtures
 *
 * Single source of truth for mock API responses.
 * Uses TypeScript's `satisfies` to ensure fixtures match types at compile time.
 *
 * These fixtures are used by:
 * - tests/mocks/server.ts (HTTP mock server)
 * - Individual test files that need predictable data
 */

import type {
  Deployment,
  DeploymentListResponse,
  Domain,
  DomainListResponse,
  DomainDnsResponse,
  DomainRecordsResponse,
  Account,
  Token,
  TokenListItem,
  TokenListResponse,
  TokenCreateResponse,
  ConfigResponse,
  PingResponse,
  SPACheckResponse,
  ErrorResponse,
  ErrorType,
} from '@shipstatic/types';

// =============================================================================
// TIMESTAMPS - Consistent timestamps for predictable testing
// =============================================================================

export const timestamps = {
  /** 2022-01-01T00:00:00Z */
  jan2022: 1640995200,
  /** 2023-01-01T00:00:00Z */
  jan2023: 1672531200,
  /** 2024-01-01T00:00:00Z */
  jan2024: 1704067200,
} as const;

// =============================================================================
// DEPLOYMENTS
// =============================================================================

export const deployments = {
  /**
   * Standard successful deployment
   */
  success: {
    deployment: 'test-deployment-1',
    files: 5,
    size: 1024000,
    status: 'success',
    config: false,
    labels: [],
    via: null,
    url: 'https://test-deployment-1.shipstatic.dev',
    created: timestamps.jan2022,
    expires: timestamps.jan2023,
  } satisfies Deployment,

  /**
   * Deployment with labels
   */
  withLabels: {
    deployment: 'labeled-deployment-1',
    files: 10,
    size: 2048000,
    status: 'success',
    config: false,
    labels: ['production', 'v1.0.0'],
    via: null,
    url: 'https://labeled-deployment-1.shipstatic.dev',
    created: timestamps.jan2022,
    expires: timestamps.jan2023,
  } satisfies Deployment,

  /**
   * Pending deployment (not yet processed)
   */
  pending: {
    deployment: 'pending-deployment-1',
    files: 3,
    size: 512000,
    status: 'pending',
    config: false,
    labels: [],
    via: null,
    url: 'https://pending-deployment-1.shipstatic.dev',
    created: timestamps.jan2022,
    expires: null,
  } satisfies Deployment,

  /**
   * Deployment with via field (CLI origin)
   */
  viaCli: {
    deployment: 'cli-deployment-1',
    files: 5,
    size: 1024000,
    status: 'success',
    config: false,
    labels: [],
    via: 'cli',
    url: 'https://cli-deployment-1.shipstatic.dev',
    created: timestamps.jan2022,
    expires: timestamps.jan2023,
  } satisfies Deployment,

} as const;

export const deploymentListResponses = {
  /**
   * Empty deployment list
   */
  empty: {
    deployments: [],
    cursor: null,
    total: 0,
  } satisfies DeploymentListResponse,

  /**
   * Single deployment
   */
  single: {
    deployments: [deployments.success],
    cursor: null,
    total: 1,
  } satisfies DeploymentListResponse,

  /**
   * Multiple deployments
   */
  multiple: {
    deployments: [deployments.success, deployments.withLabels],
    cursor: null,
    total: 2,
  } satisfies DeploymentListResponse,
} as const;

// =============================================================================
// DOMAINS
// =============================================================================

export const domains = {
  /**
   * Standard internal subdomain (auto-verified)
   */
  internal: {
    domain: 'staging',
    deployment: 'test-deployment-1',
    status: 'success',
    labels: [],
    url: 'https://staging.shipstatic.dev',
    created: timestamps.jan2022,
    linked: null,
    links: 0,
  } satisfies Domain,

  /**
   * Pending domain
   */
  pending: {
    domain: 'preview',
    deployment: 'test-deployment-1',
    status: 'pending',
    labels: [],
    url: 'https://preview.shipstatic.dev',
    created: timestamps.jan2022,
    linked: null,
    links: 0,
  } satisfies Domain,

  /**
   * Domain with labels
   */
  withLabels: {
    domain: 'production',
    deployment: 'test-deployment-1',
    status: 'success',
    labels: ['primary', 'live'],
    url: 'https://production.shipstatic.dev',
    created: timestamps.jan2022,
    linked: null,
    links: 0,
  } satisfies Domain,

  /**
   * External custom domain (pending DNS verification)
   */
  externalPending: {
    domain: 'example.com',
    deployment: 'test-deployment-1',
    status: 'pending',
    labels: [],
    url: 'https://example.com',
    created: timestamps.jan2022,
    linked: null,
    links: 0,
  } satisfies Domain,

  /**
   * External custom domain (verified, status=success)
   */
  externalVerified: {
    domain: 'verified-example.com',
    deployment: 'test-deployment-1',
    status: 'success',
    labels: [],
    url: 'https://verified-example.com',
    created: timestamps.jan2022,
    linked: null,
    links: 0,
  } satisfies Domain,

  /**
   * Domain without deployment (reserved but not linked)
   */
  unlinked: {
    domain: 'reserved',
    deployment: null,
    status: 'pending',
    labels: [],
    url: 'https://reserved.shipstatic.dev',
    created: timestamps.jan2022,
    linked: null,
    links: 0,
  } satisfies Domain,

  /**
   * Paused custom domain (plan enforcement - downgrade to free)
   */
  paused: {
    domain: 'paused-custom.com',
    deployment: 'test-deployment-1',
    status: 'paused',
    labels: [],
    url: 'https://paused-custom.com',
    created: timestamps.jan2022,
    linked: null,
    links: 0,
  } satisfies Domain,
} as const;

export const domainListResponses = {
  /**
   * Empty domain list
   */
  empty: {
    domains: [],
    cursor: null,
    total: 0,
  } satisfies DomainListResponse,

  /**
   * Single domain
   */
  single: {
    domains: [domains.internal],
    cursor: null,
    total: 1,
  } satisfies DomainListResponse,

  /**
   * Multiple domains
   */
  multiple: {
    domains: [domains.internal, domains.pending],
    cursor: null,
    total: 2,
  } satisfies DomainListResponse,
} as const;

// =============================================================================
// ACCOUNT
// =============================================================================

export const accounts = {
  /**
   * Standard free account
   */
  free: {
    email: 'test@example.com',
    name: 'Test User',
    picture: 'https://example.com/avatar.jpg',
    plan: 'free',
    created: timestamps.jan2022,
    activated: null,
    hint: null,
  } satisfies Account,

  /**
   * Standard paid account
   */
  standard: {
    email: 'paid@example.com',
    name: 'Paid User',
    picture: 'https://example.com/paid-avatar.jpg',
    plan: 'standard',
    created: timestamps.jan2022,
    activated: timestamps.jan2022,
    hint: null,
  } satisfies Account,

  /**
   * Account without profile picture
   */
  noPicture: {
    email: 'minimal@example.com',
    name: 'Minimal User',
    picture: null,
    plan: 'free',
    created: timestamps.jan2022,
    activated: null,
    hint: null,
  } satisfies Account,
} as const;

// =============================================================================
// TOKENS
// =============================================================================

export const tokens = {
  /**
   * Standard token
   */
  standard: {
    token: 'token-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    account: 'test@example.com',
    ip: null,
    labels: [],
    created: timestamps.jan2022,
    expires: null,
    used: null,
  } satisfies Token,

  /**
   * Token with expiration
   */
  withExpiry: {
    token: 'token-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    account: 'test@example.com',
    ip: null,
    labels: [],
    created: timestamps.jan2022,
    expires: timestamps.jan2023,
    used: null,
  } satisfies Token,

  /**
   * Token with labels
   */
  withLabels: {
    token: 'token-lbl123abc456lbl123abc456lbl123abc456lbl123abc456lbl123abc456lbls',
    account: 'test@example.com',
    ip: null,
    labels: ['ci', 'github-actions'],
    created: timestamps.jan2022,
    expires: null,
    used: null,
  } satisfies Token,
} as const;

/**
 * Token list items (security-redacted for list display).
 * Mirrors the shape returned by GET /tokens.
 */
export const tokenListItems = {
  /**
   * Standard token list item (truncated prefix, no account/ip)
   */
  standard: {
    token: 'token-123456...',
    labels: [],
    created: timestamps.jan2022,
    expires: null,
    used: null,
  } satisfies TokenListItem,

  /**
   * Token list item with expiration
   */
  withExpiry: {
    token: 'token-123456...',
    labels: [],
    created: timestamps.jan2022,
    expires: timestamps.jan2023,
    used: null,
  } satisfies TokenListItem,

  /**
   * Token list item with labels
   */
  withLabels: {
    token: 'token-lbl123...',
    labels: ['ci', 'github-actions'],
    created: timestamps.jan2022,
    expires: null,
    used: null,
  } satisfies TokenListItem,
} as const;

export const tokenListResponses = {
  /**
   * Empty token list
   */
  empty: {
    tokens: [],
    total: 0,
  } satisfies TokenListResponse,

  /**
   * Single token
   */
  single: {
    tokens: [tokenListItems.standard],
    total: 1,
  } satisfies TokenListResponse,
} as const;

export const tokenCreateResponses = {
  /**
   * Token creation response
   */
  success: {
    token: 'token-newtoken123newtoken123newtoken123newtoken123newtoken123newtoken1',
    labels: [],
    expires: null,
  } satisfies TokenCreateResponse,

  /**
   * Token with TTL
   */
  withTtl: {
    token: 'token-ttltoken123ttltoken123ttltoken123ttltoken123ttltoken123ttltoken',
    labels: [],
    expires: timestamps.jan2023,
  } satisfies TokenCreateResponse,

  /**
   * Token with labels
   */
  withLabels: {
    token: 'token-labeled123labeled123labeled123labeled123labeled123labeled12345',
    labels: ['production'],
    expires: null,
  } satisfies TokenCreateResponse,
} as const;

// =============================================================================
// DOMAIN ADVANCED OPERATIONS
// =============================================================================

/**
 * Domain share response (not in types package - local definition)
 */
export interface DomainShareResponse {
  domain: string;
  hash: string;
}

/**
 * Domain verify response (not in types package - local definition)
 */
export interface DomainVerifyResponse {
  message: string;
}

export const domainDnsResponses = {
  /**
   * DNS info for unverified domain
   */
  pending: {
    domain: 'example.com',
    dns: {
      provider: { name: 'Cloudflare' },
    },
  } satisfies DomainDnsResponse,

  /**
   * DNS info not available (no lookup yet)
   */
  noDns: {
    domain: 'new-example.com',
    dns: null,
  } satisfies DomainDnsResponse,
} as const;

export const domainRecordsResponses = {
  /**
   * Standard DNS records for external domain
   */
  standard: {
    domain: 'example.com',
    apex: 'example.com',
    records: [
      { type: 'A' as const, name: '@', value: '76.76.21.21' },
      { type: 'CNAME' as const, name: 'www', value: 'cname.shipstatic.com' },
    ],
  } satisfies DomainRecordsResponse,
} as const;

export const domainShareResponses = {
  /**
   * Share hash for unverified domain
   */
  standard: {
    domain: 'example.com',
    hash: 'abc123def456abc123def456abc123de',
  } satisfies DomainShareResponse,
} as const;

export const domainVerifyResponses = {
  /**
   * Verification queued
   */
  queued: {
    message: 'DNS verification queued successfully',
  } satisfies DomainVerifyResponse,
} as const;

// =============================================================================
// CONFIG
// =============================================================================

export const configs = {
  /**
   * Standard platform config
   */
  standard: {
    maxFileSize: 10485760,      // 10MB
    maxFilesCount: 1000,
    maxTotalSize: 104857600,    // 100MB
    allowedMimeTypes: [
      'text/',
      'image/',
      'font/',
      'video/',
      'audio/',
      'application/json',
      'application/javascript',
      'application/xml',
      'application/pdf',
      'application/zip',
      'application/gzip',
      'application/wasm',
    ],
  } satisfies ConfigResponse,

  /**
   * Minimal config (for basic tests)
   */
  minimal: {
    maxFileSize: 5242880,       // 5MB
    maxFilesCount: 100,
    maxTotalSize: 26214400,     // 25MB
    allowedMimeTypes: ['text/', 'image/'],
  } satisfies ConfigResponse,
} as const;

// =============================================================================
// PING / HEALTH CHECK
// =============================================================================

export const pingResponses = {
  /**
   * Healthy ping response
   */
  healthy: {
    success: true,
    timestamp: Date.now(),
  } satisfies PingResponse,
} as const;

// =============================================================================
// SPA CHECK
// =============================================================================

export const spaCheckResponses = {
  /**
   * Detected as SPA
   */
  isSpa: {
    isSPA: true,
    debug: {
      tier: 'inclusions',
      reason: 'React mount point detected',
    },
  } satisfies SPACheckResponse,

  /**
   * Not detected as SPA
   */
  notSpa: {
    isSPA: false,
    debug: {
      tier: 'fallback',
      reason: 'No SPA indicators found',
    },
  } satisfies SPACheckResponse,
} as const;

// =============================================================================
// ERROR RESPONSES
// =============================================================================

/**
 * Error response factory functions
 */
export const errors = {
  /**
   * Authentication failed error
   */
  authenticationFailed: {
    error: 'authentication_failed' as ErrorType,
    message: 'Authentication required',
    status: 401,
  } satisfies ErrorResponse,

  /**
   * Not found error factory
   */
  notFound: (resource: string, id?: string): ErrorResponse => ({
    error: 'not_found' as ErrorType,
    message: id ? `${resource} ${id} not found` : `${resource} not found`,
    status: 404,
  }),

  /**
   * Validation error factory
   */
  validationError: (message: string, details?: Record<string, unknown>): ErrorResponse => ({
    error: 'validation_failed' as ErrorType,
    message,
    status: 400,
    details,
  }),

  /**
   * Invalid JSON error
   */
  invalidJson: {
    error: 'validation_failed' as ErrorType,
    message: 'Invalid JSON in request body',
    status: 400,
  } satisfies ErrorResponse,

  /**
   * Rate limit error
   */
  rateLimit: {
    error: 'rate_limit_exceeded' as ErrorType,
    message: 'Too many requests',
    status: 429,
  } satisfies ErrorResponse,

  /**
   * Internal server error
   */
  internal: {
    error: 'internal_server_error' as ErrorType,
    message: 'Internal server error',
    status: 500,
  } satisfies ErrorResponse,
} as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create a dynamic deployment with a unique ID based on timestamp
 */
export function createDynamicDeployment(overrides: Partial<Deployment> = {}): Deployment {
  const deploymentId = `mock-deploy-${Date.now()}`;
  const now = Math.floor(Date.now() / 1000);

  return {
    deployment: deploymentId,
    files: 5,
    size: 1024000,
    status: 'success',
    config: false,
    labels: [],
    via: null,
    url: `https://${deploymentId}.shipstatic.dev`,
    created: now,
    expires: now + (7 * 24 * 60 * 60), // 7 days
    ...overrides,
  };
}

/**
 * Check if domain is external (custom domain with dots) vs internal (subdomain)
 */
export function isExternalDomain(domain: string): boolean {
  return domain.includes('.');
}

/**
 * Create a dynamic token for testing
 */
export function createDynamicToken(overrides: Partial<Token> = {}): Token {
  const now = Math.floor(Date.now() / 1000);
  const tokenId = `token-${Date.now()}${Math.random().toString(36).substring(2, 8)}`;

  return {
    token: tokenId.padEnd(68, '0'), // Ensure proper length
    account: 'test@example.com',
    ip: null,
    labels: [],
    created: now,
    expires: null,
    used: null,
    ...overrides,
  };
}

/**
 * Create a dynamic domain
 *
 * Matches real API behavior:
 * - External domains (custom): status='pending' until DNS verified
 * - Internal domains (subdomains): status='success' immediately
 */
export function createDynamicDomain(
  domainName: string,
  deploymentId: string,
  overrides: Partial<Domain> = {}
): Domain {
  const now = Math.floor(Date.now() / 1000);
  const isExternal = isExternalDomain(domainName);

  return {
    domain: domainName,
    deployment: deploymentId,
    // External domains start as 'pending' (need DNS verification)
    // Internal domains are immediately 'success'
    status: isExternal ? 'pending' : 'success',
    labels: [],
    url: isExternal
      ? `https://${domainName}`
      : `https://${domainName}.shipstatic.dev`,
    created: now,
    linked: null,
    links: 0,
    ...overrides,
  };
}

// =============================================================================
// EXPORT ALL FIXTURES
// =============================================================================

export const fixtures = {
  timestamps,
  deployments,
  deploymentListResponses,
  domains,
  domainListResponses,
  domainDnsResponses,
  domainRecordsResponses,
  domainShareResponses,
  domainVerifyResponses,
  accounts,
  tokens,
  tokenListItems,
  tokenListResponses,
  tokenCreateResponses,
  configs,
  pingResponses,
  spaCheckResponses,
  errors,
  createDynamicDeployment,
  createDynamicDomain,
  createDynamicToken,
  isExternalDomain,
} as const;

export default fixtures;
