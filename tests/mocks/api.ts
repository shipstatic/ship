/**
 * @file API mocks for CLI testing
 * Simple, deterministic responses based on our actual API implementation
 */

import { http, HttpResponse } from 'msw';
import type { DeploymentListResponse, DomainListResponse, Deployment, Domain, Account } from '@shipstatic/types';

// Mock data - predictable and minimal for testing
const mockDeployments: Deployment[] = [
  {
    deployment: 'test-deployment-1.shipstatic.com',
    files: 5,
    size: 1024000,
    status: 'success',
    config: false,
    labels: ['production', 'v1.0.0'],
    via: null,
    created: 1640995200, // 2022-01-01
    expires: 1672531200  // 2023-01-01
  },
  {
    deployment: 'test-deployment-2.shipstatic.com',
    files: 3,
    size: 512000,
    status: 'success',
    config: false,
    labels: [],
    via: null,
    created: 1640995100,
    expires: 1672531100
  }
];

const mockDomains: Domain[] = [
  {
    domain: 'staging',
    deployment: 'test-deployment-1.shipstatic.com',
    status: 'success',
    labels: [],
    created: 1640995200,
    linked: null,
    links: 0
  },
  {
    domain: 'production',
    deployment: 'test-deployment-2.shipstatic.com',
    status: 'success',
    labels: [],
    created: 1640995100,
    linked: null,
    links: 0
  }
];

const mockAccount: Account = {
  email: 'test@example.com',
  name: 'Test User',
  picture: 'https://example.com/avatar.jpg',
  plan: 'free',
  usage: { customDomains: 0 },
  created: 1640995000,
  activated: null,
  hint: null,
  grace: null,
};

// Default: Return empty lists for deterministic tests
const emptyState = {
  deployments: [],
  domains: []
};

/**
 * Setup mock API server for testing
 */
export async function setupMockApiServer() {
  // Clear any previous requests
  (globalThis as any).__lastMockRequest = null;

  return {
    getLastRequest() {
      return (globalThis as any).__lastMockRequest;
    },
    getAllRequests() {
      return [(globalThis as any).__lastMockRequest].filter(Boolean);
    },
    reset() {
      (globalThis as any).__lastMockRequest = null;
    }
  };
}

/**
 * Teardown mock API server
 */
export async function teardownMockApiServer(server: any) {
  // Clean up if needed
  if (server) {
    server.reset();
  }
}

export const apiHandlers = [
  // GET /ping
  http.get('*/ping', () => {
    return HttpResponse.json({
      success: true,
      timestamp: Date.now()
    });
  }),

  // GET /account
  http.get('*/account', () => {
    return HttpResponse.json(mockAccount);
  }),

  // GET /deployments - Default: empty list for predictable tests
  http.get('*/deployments', ({ request }) => {
    const url = new URL(request.url);
    const populate = url.searchParams.get('populate');

    const response: DeploymentListResponse = {
      deployments: populate === 'true' ? mockDeployments : emptyState.deployments,
      cursor: null,
      total: populate === 'true' ? mockDeployments.length : 0
    };

    return HttpResponse.json(response);
  }),

  // GET /deployments/:id
  http.get('*/deployments/:id', ({ params }) => {
    const deployment = mockDeployments.find(d => d.deployment === params.id);
    if (!deployment) {
      return HttpResponse.json(
        {
          error: 'not_found',
          message: `Deployment ${params.id} not found`,
          status: 404
        },
        { status: 404 }
      );
    }
    return HttpResponse.json(deployment);
  }),

  // POST /deployments - Create deployment
  http.post('*/deployments', async ({ request }) => {
    // Extract files from multipart form data to test directory structure
    const formData = await request.formData();
    const files: any[] = [];
    let labels: string[] | undefined = undefined;

    // Process uploaded files and labels
    for (const [key, value] of formData.entries()) {
      if (key === 'files[]' && value instanceof File) {
        files.push({
          path: value.name, // This should preserve the directory structure
          size: value.size,
          type: value.type
        });
      }
      if (key === 'labels' && typeof value === 'string') {
        try {
          labels = JSON.parse(value);
        } catch (e) {
          // Invalid labels format
        }
      }
    }

    const newDeployment: Deployment = {
      deployment: 'newly-created-deployment.shipstatic.com',
      files: files,
      size: files.reduce((total, f) => total + (f.size || 0), 0),
      status: 'success',
      config: false,
      labels: labels,
      via: null,
      created: Math.floor(Date.now() / 1000),
      expires: Math.floor(Date.now() / 1000) + 86400
    };

    // Store request for testing inspection
    (globalThis as any).__lastMockRequest = {
      method: 'POST',
      formData,
      files,
      labels
    };

    return HttpResponse.json(newDeployment, { status: 201 });
  }),

  // DELETE /deployments/:id
  http.delete('*/deployments/:id', ({ params }) => {
    const deployment = mockDeployments.find(d => d.deployment === params.id);
    if (!deployment) {
      return HttpResponse.json(
        {
          error: 'not_found',
          message: `Deployment ${params.id} not found`,
          status: 404
        },
        { status: 404 }
      );
    }
    return HttpResponse.json({
      message: 'Deployment marked for removal',
      deployment: params.id,
      status: 'deleting'
    }, { status: 202 });
  }),

  // GET /domains - Default: empty list for predictable tests
  http.get('*/domains', ({ request }) => {
    const url = new URL(request.url);
    const populate = url.searchParams.get('populate');

    const response: DomainListResponse = {
      domains: populate === 'true' ? mockDomains : emptyState.domains,
      cursor: null,
      total: populate === 'true' ? mockDomains.length : 0
    };

    return HttpResponse.json(response);
  }),

  // GET /domains/:name
  http.get('*/domains/:name', ({ params }) => {
    const domain = mockDomains.find(d => d.domain === params.name);
    if (!domain) {
      return HttpResponse.json(
        {
          error: 'not_found',
          message: `Domain ${params.name} not found`,
          status: 404
        },
        { status: 404 }
      );
    }
    return HttpResponse.json(domain);
  }),

  // PUT /domains/:name - Create/update domain (deployment is optional — supports reservation)
  http.put('*/domains/:name', async ({ params, request }) => {
    const body = await request.json() as { deployment?: string; labels?: string[] };

    // Check if deployment exists (only when linking)
    if (body.deployment) {
      const deploymentExists = mockDeployments.some(d => d.deployment === body.deployment);
      if (!deploymentExists) {
        return HttpResponse.json(
          {
            error: 'not_found',
            message: `Deployment ${body.deployment} not found`,
            status: 404
          },
          { status: 404 }
        );
      }
    }

    const domainResult: Domain & { isCreate: boolean } = {
      domain: params.name as string,
      deployment: body.deployment ? (body.deployment.includes('.') ? body.deployment : `${body.deployment}.shipstatic.com`) : null,
      status: 'success',
      labels: body.labels ?? [],
      created: Math.floor(Date.now() / 1000),
      linked: null,
      links: 0,
      isCreate: true
    };

    return HttpResponse.json(domainResult, { status: 201 });
  }),

  // DELETE /domains/:name
  http.delete('*/domains/:name', ({ params }) => {
    const domain = mockDomains.find(d => d.domain === params.name);
    if (!domain) {
      return HttpResponse.json(
        {
          error: 'not_found',
          message: `Domain ${params.name} not found`,
          status: 404
        },
        { status: 404 }
      );
    }
    return new HttpResponse(null, { status: 204 });
  })
];