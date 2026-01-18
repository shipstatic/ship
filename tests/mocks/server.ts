/**
 * @file Simple HTTP mock server for CLI tests
 *
 * Runs actual HTTP server for child process CLI testing.
 * Uses typed fixtures from tests/fixtures/api-responses.ts for consistent data.
 *
 * Rate Limiting Testing:
 * - Set header `X-Mock-Rate-Limit: true` to trigger 429 responses
 * - Or use query param `?__mock_rate_limit=true`
 *
 * Server Lifecycle:
 * - Uses reference counting to handle parallel test files
 * - Server starts on first setupMockServer() call
 * - Server stops when last cleanupMockServer() call happens
 */

import { createServer } from 'http';
import type { Server, IncomingMessage, ServerResponse } from 'http';
import type { Deployment, DeploymentListResponse, Domain, DomainListResponse, Token, TokenListResponse } from '@shipstatic/types';
import {
  deployments as deploymentFixtures,
  domains as domainFixtures,
  accounts,
  configs,
  spaCheckResponses,
  errors,
  createDynamicDeployment,
  createDynamicDomain,
  createDynamicToken,
  domainDnsResponses,
  domainRecordsResponses,
  domainShareResponses,
  domainVerifyResponses,
  isExternalDomain,
} from '../fixtures/api-responses';

// =============================================================================
// SERVER STATE
// =============================================================================

let server: Server | null = null;

// =============================================================================
// MUTABLE STATE (reset between tests)
// =============================================================================

let mockDeployments: Deployment[] = [];
let mockDomains: Domain[] = [];
let mockTokens: Token[] = [];

// Track rate-limited domains for verify endpoint
const rateLimitedDomains = new Set<string>();

function resetState(): void {
  mockDeployments = [{ ...deploymentFixtures.success }];
  mockDomains = [{ ...domainFixtures.verified }];
  mockTokens = [];
  rateLimitedDomains.clear();
}

// Initialize state
resetState();

// =============================================================================
// REQUEST HANDLER
// =============================================================================

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '/', 'http://localhost:3000');
  const method = req.method || 'GET';
  const path = url.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Mock-Rate-Limit');
  res.setHeader('Content-Type', 'application/json');

  // OPTIONS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  console.log(`Mock API: ${method} ${path} - Auth: ${req.headers.authorization ? 'Yes' : 'No'}`);

  // Rate limiting simulation (for testing 429 responses)
  const shouldRateLimit =
    req.headers['x-mock-rate-limit'] === 'true' ||
    url.searchParams.get('__mock_rate_limit') === 'true';

  if (shouldRateLimit) {
    res.setHeader('Retry-After', '60');
    res.writeHead(429);
    res.end(JSON.stringify(errors.rateLimit));
    return;
  }

  // Authentication check
  const isPublicEndpoint = path === '/ping' || path === '/config' || (path === '/tokens' && method === 'POST');
  const hasAuth = req.headers.authorization || req.headers['x-api-key'];

  if (!isPublicEndpoint && !hasAuth) {
    res.writeHead(401);
    res.end(JSON.stringify(errors.authenticationFailed));
    return;
  }

  try {
    routeRequest(req, res, method, path, url);
  } catch (error) {
    console.error('Mock server error:', error);
    res.writeHead(500);
    res.end(JSON.stringify(errors.internal));
  }
}

// =============================================================================
// ROUTE HANDLERS
// =============================================================================

function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  url: URL
): void {
  // Ping
  if (path === '/ping' && method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, timestamp: Date.now() }));
    return;
  }

  // Account
  if (path === '/account' && method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify(accounts.free));
    return;
  }

  // Config
  if (path === '/config' && method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify(configs.standard));
    return;
  }

  // SPA Check
  if (path === '/spa-check' && method === 'POST') {
    handleSpaCheck(req, res);
    return;
  }

  // Deployments
  if (path === '/deployments') {
    if (method === 'GET') {
      handleDeploymentsList(res, url);
    } else if (method === 'POST') {
      handleDeploymentCreate(req, res);
    }
    return;
  }

  if (path.startsWith('/deployments/')) {
    const id = path.split('/')[2];
    if (method === 'GET') {
      handleDeploymentGet(res, id);
    } else if (method === 'DELETE') {
      handleDeploymentDelete(res, id);
    }
    return;
  }

  // Domains
  if (path === '/domains') {
    if (method === 'GET') {
      handleDomainsList(res, url);
    }
    return;
  }

  if (path.startsWith('/domains/')) {
    const pathParts = path.split('/');
    const domainName = decodeURIComponent(pathParts[2]);
    const subRoute = pathParts[3]; // dns, records, share, verify

    // Advanced domain routes
    if (subRoute === 'dns' && method === 'GET') {
      handleDomainDns(res, domainName);
      return;
    }
    if (subRoute === 'records' && method === 'GET') {
      handleDomainRecords(res, domainName);
      return;
    }
    if (subRoute === 'share' && method === 'GET') {
      handleDomainShare(res, domainName);
      return;
    }
    if (subRoute === 'verify' && method === 'POST') {
      handleDomainVerify(res, domainName);
      return;
    }

    // Basic domain routes
    if (!subRoute) {
      if (method === 'GET') {
        handleDomainGet(res, domainName);
      } else if (method === 'PUT') {
        handleDomainSet(req, res, domainName);
      } else if (method === 'DELETE') {
        handleDomainDelete(res, domainName);
      }
      return;
    }
  }

  // Tokens
  if (path === '/tokens') {
    if (method === 'GET') {
      handleTokensList(res);
    } else if (method === 'POST') {
      handleTokenCreate(req, res);
    }
    return;
  }

  if (path.startsWith('/tokens/')) {
    const tokenHash = path.split('/')[2];
    if (method === 'DELETE') {
      handleTokenDelete(res, tokenHash);
    }
    return;
  }

  // 404 for unknown routes
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
}

// =============================================================================
// DEPLOYMENT HANDLERS
// =============================================================================

function handleDeploymentsList(res: ServerResponse, url: URL): void {
  const populate = url.searchParams.get('populate');
  const response: DeploymentListResponse = {
    deployments: populate === 'true' ? mockDeployments : [],
    cursor: undefined,
    total: populate === 'true' ? mockDeployments.length : 0,
  };
  res.writeHead(200);
  res.end(JSON.stringify(response));
}

function handleDeploymentCreate(req: IncomingMessage, res: ServerResponse): void {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const deployment = createDynamicDeployment();
    mockDeployments.push(deployment);
    res.writeHead(201);
    res.end(JSON.stringify(deployment));
  });
}

function handleDeploymentGet(res: ServerResponse, id: string): void {
  const deployment = mockDeployments.find((d) => d.deployment === id);
  if (!deployment) {
    res.writeHead(404);
    res.end(JSON.stringify(errors.notFound('Deployment', id)));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify(deployment));
}

function handleDeploymentDelete(res: ServerResponse, id: string): void {
  const deployment = mockDeployments.find((d) => d.deployment === id);
  if (!deployment) {
    res.writeHead(404);
    res.end(JSON.stringify(errors.notFound('Deployment', id)));
    return;
  }
  res.writeHead(202);
  res.end(JSON.stringify({
    message: 'Deployment marked for removal',
    deployment: id,
    status: 'removing',
  }));
}

// =============================================================================
// DOMAIN HANDLERS
// =============================================================================

function handleDomainsList(res: ServerResponse, _url: URL): void {
  // Always return all mock domains (matches real API behavior)
  const response: DomainListResponse = {
    domains: mockDomains,
    cursor: undefined,
    total: mockDomains.length,
  };
  res.writeHead(200);
  res.end(JSON.stringify(response));
}

function handleDomainGet(res: ServerResponse, domainName: string): void {
  const domain = mockDomains.find((d) => d.domain === domainName);
  if (!domain) {
    res.writeHead(404);
    res.end(JSON.stringify(errors.notFound('Domain', domainName)));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify(domain));
}

function handleDomainSet(req: IncomingMessage, res: ServerResponse, domainName: string): void {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      if (!data.deployment) {
        res.writeHead(400);
        res.end(JSON.stringify(errors.validationError('deployment is required')));
        return;
      }

      // Check if deployment exists
      const deploymentExists = mockDeployments.some((d) => d.deployment === data.deployment);
      if (!deploymentExists) {
        res.writeHead(404);
        res.end(JSON.stringify(errors.notFound('Deployment', data.deployment)));
        return;
      }

      // Check if domain already exists (update) or is new (create)
      const existingIndex = mockDomains.findIndex((d) => d.domain === domainName);
      const domain = createDynamicDomain(domainName, data.deployment, {
        tags: data.tags,
      });

      if (existingIndex >= 0) {
        // Update existing domain
        mockDomains[existingIndex] = domain;
        res.writeHead(200);
      } else {
        // Create new domain
        mockDomains.push(domain);
        res.writeHead(201);
      }

      res.end(JSON.stringify(domain));
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify(errors.invalidJson));
    }
  });
}

function handleDomainDelete(res: ServerResponse, domainName: string): void {
  const domain = mockDomains.find((d) => d.domain === domainName);
  if (!domain) {
    res.writeHead(404);
    res.end(JSON.stringify(errors.notFound('Domain', domainName)));
    return;
  }
  res.writeHead(204);
  res.end();
}

// =============================================================================
// ADVANCED DOMAIN HANDLERS
// =============================================================================

function handleDomainDns(res: ServerResponse, domainName: string): void {
  // Only available for external domains
  if (!isExternalDomain(domainName)) {
    res.writeHead(400);
    res.end(JSON.stringify(errors.validationError('DNS information is only available for external domains')));
    return;
  }

  const domain = mockDomains.find((d) => d.domain === domainName);
  if (!domain) {
    res.writeHead(404);
    res.end(JSON.stringify(errors.notFound('Domain', domainName)));
    return;
  }

  // Only available for unverified domains
  if (domain.verified) {
    res.writeHead(400);
    res.end(JSON.stringify(errors.validationError('DNS information is only available for unverified domains')));
    return;
  }

  res.writeHead(200);
  res.end(JSON.stringify({
    domain: domainName,
    dns: { provider: { name: 'Cloudflare' } },
  }));
}

function handleDomainRecords(res: ServerResponse, domainName: string): void {
  // Only available for external domains
  if (!isExternalDomain(domainName)) {
    res.writeHead(400);
    res.end(JSON.stringify(errors.validationError('DNS information is only available for external domains')));
    return;
  }

  const domain = mockDomains.find((d) => d.domain === domainName);
  if (!domain) {
    res.writeHead(404);
    res.end(JSON.stringify(errors.notFound('Domain', domainName)));
    return;
  }

  res.writeHead(200);
  res.end(JSON.stringify({
    domain: domainName,
    records: domainRecordsResponses.standard.records,
  }));
}

function handleDomainShare(res: ServerResponse, domainName: string): void {
  // Only available for external domains
  if (!isExternalDomain(domainName)) {
    res.writeHead(400);
    res.end(JSON.stringify(errors.validationError('Setup sharing is only available for external domains')));
    return;
  }

  const domain = mockDomains.find((d) => d.domain === domainName);
  if (!domain) {
    res.writeHead(404);
    res.end(JSON.stringify(errors.notFound('Domain', domainName)));
    return;
  }

  // Only available for unverified domains
  if (domain.verified) {
    res.writeHead(400);
    res.end(JSON.stringify(errors.validationError('Setup sharing is only available for unverified domains')));
    return;
  }

  res.writeHead(200);
  res.end(JSON.stringify({
    domain: domainName,
    hash: domainShareResponses.standard.hash,
  }));
}

function handleDomainVerify(res: ServerResponse, domainName: string): void {
  // Only available for external domains
  if (!isExternalDomain(domainName)) {
    res.writeHead(400);
    res.end(JSON.stringify(errors.validationError('DNS verification is only available for external domains')));
    return;
  }

  const domain = mockDomains.find((d) => d.domain === domainName);
  if (!domain) {
    res.writeHead(404);
    res.end(JSON.stringify(errors.notFound('Domain', domainName)));
    return;
  }

  // Only available for unverified domains
  if (domain.verified) {
    res.writeHead(400);
    res.end(JSON.stringify(errors.validationError('DNS verification is only available for unverified domains')));
    return;
  }

  // Rate limit check (simulates real API behavior)
  if (rateLimitedDomains.has(domainName)) {
    res.writeHead(429);
    res.end(JSON.stringify(errors.validationError('DNS verification already requested recently. Please wait before retrying.')));
    return;
  }

  // Add to rate-limited set (in real tests, this persists for the test duration)
  rateLimitedDomains.add(domainName);

  res.writeHead(200);
  res.end(JSON.stringify(domainVerifyResponses.queued));
}

// =============================================================================
// TOKEN HANDLERS
// =============================================================================

function handleTokensList(res: ServerResponse): void {
  const response: TokenListResponse = {
    tokens: mockTokens,
    count: mockTokens.length,
  };
  res.writeHead(200);
  res.end(JSON.stringify(response));
}

function handleTokenCreate(req: IncomingMessage, res: ServerResponse): void {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    try {
      const data = body ? JSON.parse(body) : {};
      const token = createDynamicToken({
        tags: data.tags,
        expires: data.ttl ? Math.floor(Date.now() / 1000) + data.ttl : undefined,
      });

      mockTokens.push(token);

      // Return only the token value (and tags if provided)
      const response: { token: string; tags?: string[] } = { token: token.token };
      if (data.tags) {
        response.tags = data.tags;
      }

      res.writeHead(201);
      res.end(JSON.stringify(response));
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify(errors.invalidJson));
    }
  });
}

function handleTokenDelete(res: ServerResponse, tokenHash: string): void {
  const tokenIndex = mockTokens.findIndex((t) => t.token === tokenHash || t.token.startsWith(tokenHash));
  if (tokenIndex === -1) {
    res.writeHead(404);
    res.end(JSON.stringify(errors.notFound('Token')));
    return;
  }

  mockTokens.splice(tokenIndex, 1);
  res.writeHead(200);
  res.end(JSON.stringify({ success: true, message: 'Token marked for deletion' }));
}

// =============================================================================
// SPA CHECK HANDLER
// =============================================================================

function handleSpaCheck(req: IncomingMessage, res: ServerResponse): void {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const hasIndexHtml = data.files?.includes('index.html');
      const indexContent = data.index || '';
      const hasReactRoot = indexContent.includes('id="root"') || indexContent.includes("id='root'");
      const isSPA = hasIndexHtml && hasReactRoot;

      res.writeHead(200);
      res.end(JSON.stringify(isSPA ? spaCheckResponses.isSpa : spaCheckResponses.notSpa));
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify(errors.invalidJson));
    }
  });
}

// =============================================================================
// SERVER LIFECYCLE
// =============================================================================

export function setupMockServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Already running - just resolve
    if (server) {
      resolve();
      return;
    }

    server = createServer(handleRequest);

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Port in use = another test worker started the server, that's fine
        resolve();
      } else {
        reject(err);
      }
    });

    server.listen(3000, () => {
      console.log('Mock API server running on http://localhost:3000');
      resolve();
    });
  });
}

export function cleanupMockServer(): Promise<void> {
  // Never close - let Node clean up on exit
  // This prevents race conditions with parallel test files
  return Promise.resolve();
}

export function resetMockServer(): void {
  resetState();
}
