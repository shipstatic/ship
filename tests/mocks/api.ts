/**
 * @file API mocks for CLI testing
 * Simple, deterministic responses based on our actual API implementation
 */

import { http, HttpResponse } from 'msw';
import type { DeploymentListResponse, AliasListResponse, Deployment, Alias, Account } from '@shipstatic/types';

// Mock data - predictable and minimal for testing
const mockDeployments: Deployment[] = [
  {
    deployment: 'test-deployment-1',
    files: 5,
    size: 1024000,
    status: 'success',
    config: false,
    url: 'https://test-deployment-1.shipstatic.com',
    created: 1640995200, // 2022-01-01
    expires: 1672531200  // 2023-01-01
  },
  {
    deployment: 'test-deployment-2',
    files: 3,
    size: 512000,
    status: 'success',
    url: 'https://test-deployment-2.shipstatic.com',
    created: 1640995100,
    expires: 1672531100
  }
];

const mockAliases: Alias[] = [
  {
    alias: 'staging',
    deployment: 'test-deployment-1',
    status: 'success',
    url: 'https://staging.shipstatic.com',
    created: 1640995200,
    confirmed: 1640995200
  },
  {
    alias: 'production',
    deployment: 'test-deployment-2',
    status: 'success',
    url: 'https://production.shipstatic.com',
    created: 1640995100,
    confirmed: 1640995100
  }
];

const mockAccount: Account = {
  email: 'test@example.com',
  name: 'Test User',
  picture: 'https://example.com/avatar.jpg',
  plan: 'free',
  created: 1640995000
};

// Default: Return empty lists for deterministic tests
const emptyState = {
  deployments: [],
  aliases: []
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
    
    // Process uploaded files
    for (const [key, value] of formData.entries()) {
      if (key === 'files[]' && value instanceof File) {
        files.push({
          path: value.name, // This should preserve the directory structure
          size: value.size,
          type: value.type
        });
      }
    }
    
    const newDeployment: Deployment = {
      deployment: 'newly-created-deployment',
      files: files,
      size: files.reduce((total, f) => total + (f.size || 0), 0),
      status: 'success',
      url: 'https://newly-created-deployment.shipstatic.com',
      created: Math.floor(Date.now() / 1000),
      expires: Math.floor(Date.now() / 1000) + 86400
    };
    
    // Store request for testing inspection
    (globalThis as any).__lastMockRequest = {
      method: 'POST',
      formData,
      files
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
      status: 'removing'
    }, { status: 202 });
  }),

  // GET /aliases - Default: empty list for predictable tests
  http.get('*/aliases', ({ request }) => {
    const url = new URL(request.url);
    const populate = url.searchParams.get('populate');
    
    const response: AliasListResponse = {
      aliases: populate === 'true' ? mockAliases : emptyState.aliases,
      cursor: null,
      total: populate === 'true' ? mockAliases.length : 0
    };
    
    return HttpResponse.json(response);
  }),

  // GET /aliases/:name
  http.get('*/aliases/:name', ({ params }) => {
    const alias = mockAliases.find(a => a.alias === params.name);
    if (!alias) {
      return HttpResponse.json(
        { 
          error: 'not_found', 
          message: `Alias ${params.name} not found`,
          status: 404
        },
        { status: 404 }
      );
    }
    return HttpResponse.json(alias);
  }),

  // PUT /aliases/:name - Create/update alias
  http.put('*/aliases/:name', async ({ params, request }) => {
    const body = await request.json() as { deployment: string };
    
    // Check if deployment exists
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

    const aliasResult: Alias = {
      alias: params.name as string,
      deployment: body.deployment,
      status: 'success',
      url: `https://${params.name}.shipstatic.com`,
      created: Math.floor(Date.now() / 1000),
      confirmed: Math.floor(Date.now() / 1000),
      isCreate: true
    };

    return HttpResponse.json(aliasResult, { status: 201 });
  }),

  // DELETE /aliases/:name
  http.delete('*/aliases/:name', ({ params }) => {
    const alias = mockAliases.find(a => a.alias === params.name);
    if (!alias) {
      return HttpResponse.json(
        { 
          error: 'not_found', 
          message: `Alias ${params.name} not found`,
          status: 404
        },
        { status: 404 }
      );
    }
    return new HttpResponse(null, { status: 204 });
  })
];