import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Ship } from '../../src/shared/base-ship';
import type { ShipClientOptions, DeployInput, DeploymentOptions, StaticFile } from '../../src/shared/types';

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
}

describe('Authentication with useCredentials', () => {
    let mockApiDeploy: vi.Mock;

    beforeEach(() => {
        vi.clearAllMocks();
        mockApiDeploy = vi.fn().mockResolvedValue({ id: 'dep_123', url: 'https://test.ship.com' });
    });

    it('should throw error when no auth provided (default behavior)', async () => {
        const ship = new TestShip({ apiUrl: 'https://test-api.com' });

        // Mock internal http client to avoid actual network calls
        (ship as any).http = {
            deploy: mockApiDeploy
        };

        await expect(ship.deploy(['test'] as any)).rejects.toThrow('Authentication credentials are required');
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
