import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Ship } from '../../src/shared/base-ship';
import type { ShipClientOptions, DeployInput, DeploymentOptions, StaticFile, DeployBodyCreator } from '../../src/shared/types';

const mockDeployBodyCreator: DeployBodyCreator = async () => ({
    body: new ArrayBuffer(0),
    headers: { 'Content-Type': 'multipart/form-data' }
});

// Concrete implementation for testing
class TestShip extends Ship {
    protected resolveInitialConfig(options: ShipClientOptions): any {
        return {
            apiUrl: options.apiUrl || 'https://test-api.com',
            apiKey: options.apiKey,
            deployToken: options.deployToken
        };
    }

    protected async loadFullConfig(): Promise<void> {
        return Promise.resolve();
    }

    protected async processInput(input: DeployInput, options: DeploymentOptions): Promise<StaticFile[]> {
        return Promise.resolve([]);
    }

    protected getDeployBodyCreator(): DeployBodyCreator {
        return mockDeployBodyCreator;
    }
}

describe('Authentication with useCredentials', () => {
    let mockApiDeploy: vi.Mock;

    beforeEach(() => {
        vi.clearAllMocks();
        mockApiDeploy = vi.fn().mockResolvedValue({ id: 'dep_123', url: 'https://test.ship.com' });
    });

    it('should auto-fetch agent token when no auth provided', async () => {
        const ship = new TestShip({ apiUrl: 'https://test-api.com' });

        // Mock internal http client with agent token support
        (ship as any).http = {
            deploy: mockApiDeploy,
            fetchAgentToken: vi.fn().mockResolvedValue({ secret: 'token-agent-auto', token: 'agt1d00', labels: [], expires: null })
        };

        await ship.deploy(['test'] as any);
        expect((ship as any).http.fetchAgentToken).toHaveBeenCalled();
        expect(mockApiDeploy).toHaveBeenCalled();
    });

    it('should allow deployment when useCredentials is true (skipping auth check)', async () => {
        const ship = new TestShip({
            apiUrl: 'https://test-api.com',
            useCredentials: true
        });

        // Mock internal http client
        (ship as any).http = {
            deploy: mockApiDeploy
        };

        // Should not throw
        await ship.deploy(['test'] as any);

        expect(mockApiDeploy).toHaveBeenCalled();
    });

    it('should NOT produce Authorization header when useCredentials is set without apiKey', async () => {
        const ship = new TestShip({
            apiUrl: 'https://test-api.com',
            useCredentials: true
        });

        // Access private method for testing
        const authHeaders = (ship as any).getAuthHeaders();

        expect(authHeaders).toEqual({});
    });

    it('should still support apiKey even if useCredentials is true (though unlikely usage)', async () => {
        const ship = new TestShip({
            apiUrl: 'https://test-api.com',
            apiKey: 'ship-key-123',
            useCredentials: true
        });

        // Access private method for testing
        const authHeaders = (ship as any).getAuthHeaders();

        expect(authHeaders).toEqual({ 'Authorization': 'Bearer ship-key-123' });

        // Verify check still passes
        expect((ship as any).hasAuth()).toBe(true);
    });
});
