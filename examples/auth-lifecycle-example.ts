/**
 * Authentication Lifecycle Example
 *
 * Demonstrates how to use the new setDeployToken() and setApiKey() methods
 * to manage authentication credentials dynamically.
 */

import { Ship } from '@shipstatic/ship';

// Example 1: Setting auth after initialization
async function example1_setAuthAfterInit() {
  console.log('\n=== Example 1: Set Auth After Initialization ===\n');

  // Create Ship instance without auth
  const ship = new Ship({
    apiUrl: 'https://api.shipstatic.dev'
  });

  // Later, when you have a deploy token (e.g., from user input or OAuth)
  ship.setDeployToken('token-1234567890abcdef...');

  // Now you can deploy
  try {
    const deployment = await ship.deploy('./dist');
    console.log(`Deployed to: ${deployment.url}`);
  } catch (error) {
    console.error('Deployment failed:', error);
  }
}

// Example 2: Switching between different auth credentials
async function example2_switchingCredentials() {
  console.log('\n=== Example 2: Switching Between Credentials ===\n');

  const ship = new Ship({
    apiUrl: 'https://api.shipstatic.dev'
  });

  // Deploy with user A's token
  ship.setDeployToken('token-userA-credentials');
  const deploymentA = await ship.deploy('./project-a');
  console.log(`User A deployed to: ${deploymentA.url}`);

  // Later, switch to user B's API key
  ship.setApiKey('ship-userB-credentials');
  const deploymentB = await ship.deploy('./project-b');
  console.log(`User B deployed to: ${deploymentB.url}`);
}

// Example 3: OAuth flow example
async function example3_oauthFlow() {
  console.log('\n=== Example 3: OAuth Flow ===\n');

  // 1. Create Ship instance without credentials
  const ship = new Ship({
    apiUrl: 'https://api.shipstatic.dev'
  });

  // 2. User goes through OAuth flow
  console.log('Redirecting user to OAuth provider...');

  // 3. After successful OAuth, you receive an API key
  const apiKeyFromOAuth = 'ship-oauth-received-key-123';

  // 4. Set the API key on the existing Ship instance
  ship.setApiKey(apiKeyFromOAuth);

  // 5. Now the user can deploy
  const deployment = await ship.deploy('./dist');
  console.log(`OAuth user deployed to: ${deployment.url}`);
}

// Example 4: Per-deployment override (still works)
async function example4_perDeploymentOverride() {
  console.log('\n=== Example 4: Per-Deployment Override ===\n');

  // Instance has default credentials
  const ship = new Ship({
    apiUrl: 'https://api.shipstatic.dev',
    apiKey: 'ship-default-key'
  });

  // Regular deployment uses default credentials
  const deployment1 = await ship.deploy('./project');
  console.log(`Deployed with default key: ${deployment1.url}`);

  // Override with specific token for this deployment only
  const deployment2 = await ship.deploy('./special-project', {
    deployToken: 'token-special-deployment'
  });
  console.log(`Deployed with specific token: ${deployment2.url}`);

  // Next deployment uses default credentials again
  const deployment3 = await ship.deploy('./another-project');
  console.log(`Deployed with default key again: ${deployment3.url}`);
}

// Example 5: Error handling - no auth provided
async function example5_errorHandling() {
  console.log('\n=== Example 5: Error Handling - No Auth ===\n');

  const ship = new Ship({
    apiUrl: 'https://api.shipstatic.dev'
  });

  try {
    // This will fail because no auth is set
    await ship.deploy('./dist');
  } catch (error) {
    console.error('Expected error:', error.message);
    // Error: Authentication credentials are required for deployment.
    // Please call setDeployToken() or setApiKey() first, or pass credentials in the deployment options.
  }

  // Fix by setting credentials
  ship.setDeployToken('token-valid-credentials');
  const deployment = await ship.deploy('./dist');
  console.log(`Fixed: Deployed to ${deployment.url}`);
}

// Example 6: Validation errors
async function example6_validation() {
  console.log('\n=== Example 6: Validation ===\n');

  const ship = new Ship({
    apiUrl: 'https://api.shipstatic.dev'
  });

  try {
    // Invalid token (empty string)
    ship.setDeployToken('');
  } catch (error) {
    console.error('Expected validation error:', error.message);
    // Error: Invalid deploy token provided. Deploy token must be a non-empty string.
  }

  try {
    // Invalid API key (null)
    ship.setApiKey(null as any);
  } catch (error) {
    console.error('Expected validation error:', error.message);
    // Error: Invalid API key provided. API key must be a non-empty string.
  }
}

// Run examples
if (require.main === module) {
  (async () => {
    console.log('🚀 Ship SDK - Authentication Lifecycle Examples');
    console.log('='.repeat(50));

    // Note: These examples won't actually run without valid credentials
    // They're here to demonstrate the API

    console.log('\n✨ New Features:');
    console.log('  - ship.setDeployToken(token)  - Set/update deploy token');
    console.log('  - ship.setApiKey(key)         - Set/update API key');
    console.log('\n💡 Use Cases:');
    console.log('  1. Set credentials after Ship initialization');
    console.log('  2. Update credentials when switching users');
    console.log('  3. Handle OAuth flows dynamically');
    console.log('  4. Per-deployment credential overrides');
    console.log('\n🔒 Benefits:');
    console.log('  - Type-safe authentication state management');
    console.log('  - Prevents conflicting auth methods');
    console.log('  - Clear error messages when auth is missing');
    console.log('  - Seamless credential updates');

    console.log('\n' + '='.repeat(50));
  })();
}

export {
  example1_setAuthAfterInit,
  example2_switchingCredentials,
  example3_oauthFlow,
  example4_perDeploymentOverride,
  example5_errorHandling,
  example6_validation
};
