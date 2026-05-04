import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Ship } from '../../src/shared/base-ship';
import { ShipError } from '@shipstatic/types';
import type { ShipClientOptions, DeployInput, DeploymentOptions, StaticFile, DeployBodyCreator } from '../../src/shared/types';

const mockDeployBodyCreator: DeployBodyCreator = async () => ({
    body: new ArrayBuffer(0),
    headers: { 'Content-Type': 'multipart/form-data' }
});

// Concrete test implementation. The `ensureInitialized` no-op skips the
// `GET /limits` fetch — these tests focus on auth flow and don't need
// platform limits hydrated.
class TestShip extends Ship {
    protected async ensureInitialized(): Promise<void> { /* no platform-limits fetch in tests */ }
    protected async processInput(_input: DeployInput, _options: DeploymentOptions): Promise<StaticFile[]> {
        return [];
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

    it('should throw rate limit error when agent token fetch is rate-limited', async () => {
        const ship = new TestShip({ apiUrl: 'https://test-api.com' });

        (ship as any).http = {
            deploy: mockApiDeploy,
            fetchAgentToken: vi.fn().mockRejectedValue(ShipError.rateLimit('Too many requests'))
        };

        await expect(ship.deploy(['test'] as any)).rejects.toMatchObject({
            type: 'rate_limit_exceeded',
            message: expect.stringContaining('public deploy rate limit exceeded')
        });
    });

    it('should propagate non-rate-limit errors from agent token fetch', async () => {
        const ship = new TestShip({ apiUrl: 'https://test-api.com' });

        (ship as any).http = {
            deploy: mockApiDeploy,
            fetchAgentToken: vi.fn().mockRejectedValue(ShipError.network('Connection refused'))
        };

        await expect(ship.deploy(['test'] as any)).rejects.toMatchObject({
            message: 'Connection refused'
        });
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
