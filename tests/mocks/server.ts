/**
 * @file Simple HTTP mock server for CLI tests
 * Runs actual HTTP server for child process CLI testing
 */

import { createServer } from 'http';
import type { Server } from 'http';
import type { DeploymentListResponse, AliasListResponse, Deployment, Alias, Account } from '@shipstatic/types';

// Mock data - predictable and minimal for testing
const mockDeployments: Deployment[] = [
  {
    deployment: 'test-deployment-1',
    files: 5,
    size: 1024000,
    status: 'success',
    config: false,
    url: 'https://test-deployment-1.statichost.dev',
    created: 1640995200, // 2022-01-01T00:00:00Z
    expires: 1672531200  // 2023-01-01T00:00:00Z
  }
];

const mockAliases: Alias[] = [
  {
    alias: 'staging',
    deployment: 'test-deployment-1',
    status: 'success',
    url: 'https://staging.statichost.dev',
    created: 1640995200,
    confirmed: 1640995200
  }
];

const mockAccount: Account = {
  email: 'test@example.com',
  name: 'Test User',
  picture: 'https://example.com/avatar.jpg',
  plan: 'free',
  created: 1640995000,
  subscribed: 1640995000
};

let server: Server | null = null;

function handleRequest(req: any, res: any) {
  const url = new URL(req.url, 'http://localhost:3000');
  const method = req.method;
  const path = url.pathname;

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  // Handle OPTIONS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  console.log(`Mock API: ${method} ${path} - Auth: ${req.headers.authorization ? 'Yes' : 'No'}`);

  // Mock authentication check - accept any auth header or test API key in env
  const isPublicEndpoint = path === '/ping' || path === '/config';
  const hasAuth = req.headers.authorization || req.headers['x-api-key'];
  
  if (!isPublicEndpoint && !hasAuth) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'authentication_failed', status: 401 }));
    return;
  }

  try {
    // Routes
    if (path === '/ping' && method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, timestamp: Date.now() }));
    } 
    else if (path === '/account' && method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify(mockAccount));
    }
    else if (path === '/config' && method === 'GET') {
      // Mock config response - matches ConfigResponse from API
      res.writeHead(200);
      res.end(JSON.stringify({
        maxFileSize: 10485760,      // 10MB
        maxFilesCount: 1000,
        maxTotalSize: 104857600     // 100MB
      }));
    }
    else if (path === '/spa-check' && method === 'POST') {
      // Mock SPA detection response - matches SPACheckResponse from API
      let body = '';
      req.on('data', (chunk: any) => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          // Simple heuristic: if files include index.html and it contains "root" div, it's a SPA
          const hasIndexHtml = data.files && data.files.includes('index.html');
          const indexContent = data.index || '';
          const hasReactRoot = indexContent.includes('id="root"') || indexContent.includes("id='root'");
          const isSPA = hasIndexHtml && hasReactRoot;
          
          res.writeHead(200);
          res.end(JSON.stringify({
            isSPA,
            debug: {
              tier: isSPA ? 'inclusions' : 'exclusions',
              reason: isSPA ? 'React mount point detected' : 'No SPA indicators found'
            }
          }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ 
            error: 'invalid_json', 
            message: 'Invalid JSON in request body',
            status: 400
          }));
        }
      });
      return; // Important: return here to prevent response from ending immediately
    }
    else if (path === '/deployments' && method === 'GET') {
      const populate = url.searchParams.get('populate');
      const response: DeploymentListResponse = {
        deployments: populate === 'true' ? mockDeployments : [],
        cursor: null,
        total: populate === 'true' ? mockDeployments.length : 0
      };
      res.writeHead(200);
      res.end(JSON.stringify(response));
    }
    else if (path === '/deployments' && method === 'POST') {
      // Mock deployment creation
      let body = '';
      req.on('data', (chunk: any) => body += chunk);
      req.on('end', () => {
        const deploymentId = `mock-deploy-${Date.now()}`;
        const deployment: Deployment = {
          deployment: deploymentId,
          files: 5,
          size: 1024000,
          status: 'success',
          config: false,
          url: `https://${deploymentId}.statichost.dev`,
          created: Math.floor(Date.now() / 1000),
          expires: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
        };
        
        // Add to mock deployments for subsequent queries
        mockDeployments.push(deployment);
        
        res.writeHead(201);
        res.end(JSON.stringify(deployment));
      });
      return; // Important: return here to prevent response from ending immediately
    }
    else if (path.startsWith('/deployments/') && method === 'GET') {
      const id = path.split('/')[2];
      const deployment = mockDeployments.find(d => d.deployment === id);
      if (!deployment) {
        res.writeHead(404);
        res.end(JSON.stringify({ 
          error: 'not_found', 
          message: `Deployment ${id} not found`,
          status: 404
        }));
      } else {
        res.writeHead(200);
        res.end(JSON.stringify(deployment));
      }
    }
    else if (path.startsWith('/deployments/') && method === 'DELETE') {
      const id = path.split('/')[2];
      const deployment = mockDeployments.find(d => d.deployment === id);
      if (!deployment) {
        res.writeHead(404);
        res.end(JSON.stringify({ 
          error: 'not_found', 
          message: `Deployment ${id} not found`,
          status: 404
        }));
      } else {
        res.writeHead(202);
        res.end(JSON.stringify({
          message: 'Deployment marked for removal',
          deployment: id,
          status: 'removing'
        }));
      }
    }
    else if (path === '/aliases' && method === 'GET') {
      const populate = url.searchParams.get('populate');
      const response: AliasListResponse = {
        aliases: populate === 'true' ? mockAliases : [],
        cursor: null,
        total: populate === 'true' ? mockAliases.length : 0
      };
      res.writeHead(200);
      res.end(JSON.stringify(response));
    }
    else if (path.startsWith('/aliases/') && method === 'GET') {
      const aliasName = path.split('/')[2];
      const alias = mockAliases.find(a => a.alias === aliasName);
      if (!alias) {
        res.writeHead(404);
        res.end(JSON.stringify({ 
          error: 'not_found', 
          message: `Alias ${aliasName} not found`,
          status: 404
        }));
      } else {
        res.writeHead(200);
        res.end(JSON.stringify(alias));
      }
    }
    else if (path.startsWith('/aliases/') && method === 'PUT') {
      const aliasName = path.split('/')[2];
      let body = '';
      req.on('data', (chunk: any) => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.deployment) {
            res.writeHead(400);
            res.end(JSON.stringify({ 
              error: 'validation_error', 
              message: 'deployment is required',
              status: 400
            }));
            return;
          }
          
          // Check if deployment exists
          const deploymentExists = mockDeployments.some(d => d.deployment === data.deployment);
          if (!deploymentExists) {
            res.writeHead(404);
            res.end(JSON.stringify({ 
              error: 'not_found', 
              message: `Deployment ${data.deployment} not found`,
              status: 404
            }));
            return;
          }
          
          const now = Math.floor(Date.now() / 1000);
          const aliasResult = {
            alias: aliasName,
            deployment: data.deployment,
            status: 'success' as const,
            url: `https://${aliasName}.statichost.dev`,
            created: now,
            confirmed: now
          };
          
          res.writeHead(201);
          res.end(JSON.stringify(aliasResult));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ 
            error: 'invalid_json', 
            message: 'Invalid JSON in request body',
            status: 400
          }));
        }
      });
      return; // Important: return here to prevent the response from ending immediately
    }
    else if (path.startsWith('/aliases/') && method === 'DELETE') {
      const aliasName = path.split('/')[2];
      const alias = mockAliases.find(a => a.alias === aliasName);
      if (!alias) {
        res.writeHead(404);
        res.end(JSON.stringify({ 
          error: 'not_found', 
          message: `Alias ${aliasName} not found`,
          status: 404
        }));
      } else {
        res.writeHead(204);
        res.end();
      }
    }
    else {
      // 404 for unknown routes
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (error) {
    console.error('Mock server error:', error);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

export function setupMockServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve();
      return;
    }

    server = createServer(handleRequest);
    
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.log('Mock server: Port 3000 already in use, assuming it\'s already running');
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
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    server.close(() => {
      console.log('Mock API server stopped');
      server = null;
      resolve();
    });
  });
}

export function resetMockServer() {
  // Reset to original static data between tests
  mockDeployments.length = 0;
  mockDeployments.push({
    deployment: 'test-deployment-1',
    files: 5,
    size: 1024000,
    status: 'success',
    config: false,
    url: 'https://test-deployment-1.statichost.dev',
    created: 1640995200, // 2022-01-01T00:00:00Z
    expires: 1672531200  // 2023-01-01T00:00:00Z
  });
  
  mockAliases.length = 0;
  mockAliases.push({
    alias: 'staging',
    deployment: 'test-deployment-1',
    status: 'success',
    url: 'https://staging.statichost.dev',
    created: 1640995200,
    confirmed: 1640995200
  });
}