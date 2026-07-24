import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Ship } from '../../src/shared/base-ship';
import type { DeployInput, DeploymentOptions, StaticFile, DeployBodyCreator } from '../../src/shared/types';

const TEST_API_KEY = 'ship-' + 'a'.repeat(64);
const TEST_DEPLOY_TOKEN = 'deploy-' + 'b'.repeat(64);

const mockDeployBodyCreator: DeployBodyCreator = async () => ({
    body: new ArrayBuffer(0),
    headers: { 'Content-Type': 'multipart/form-data' }
});

// Concrete test implementation. The `ensureInitialized` no-op skips the
// `GET /limits` fetch — these tests focus on the credential model and don't
// need platform limits hydrated.
class TestShip extends Ship {
    protected async ensureInitialized(): Promise<void> { /* no platform-limits fetch in tests */ }
    protected async processInput(_input: DeployInput, _options: DeploymentOptions): Promise<StaticFile[]> {
        return [];
    }
    protected getDeployBodyCreator(): DeployBodyCreator {
        return mockDeployBodyCreator;
    }
}

describe('The credential slot', () => {
    let mockApiDeploy: vi.Mock;

    beforeEach(() => {
        vi.clearAllMocks();
        mockApiDeploy = vi.fn().mockResolvedValue({ id: 'dep_123', url: 'https://test.ship.com' });
    });

    describe('anonymous', () => {
        it('deploys with no credential — the request simply carries no Authorization header', async () => {
            const ship = new TestShip({ apiUrl: 'https://test-api.com' });

            (ship as any).http = { deploy: mockApiDeploy };
            await ship.deploy(['test'] as any);

            expect(mockApiDeploy).toHaveBeenCalled();
            expect(await (ship as any).getAuthHeaders()).toEqual({});
        });
    });

    describe('static token', () => {
        it('emits any platform token verbatim as the bearer', async () => {
            // One slot, three populations: the value's shape says what it is;
            // the server classifies — the client never has to.
            for (const token of [TEST_API_KEY, TEST_DEPLOY_TOKEN, 'oauth-opaque-access-token']) {
                const ship = new TestShip({ apiUrl: 'https://test-api.com', token });
                expect(await (ship as any).getAuthHeaders()).toEqual({ 'Authorization': `Bearer ${token}` });
            }
        });

        it('validates prefixed tokens at the boundary', () => {
            // ship- and deploy- values carry format guarantees; a malformed one
            // fails fast locally instead of as a confusing server 401.
            expect(() => new TestShip({ token: 'ship-tooshort' })).toThrow(/characters total/);
            expect(() => new TestShip({ token: 'deploy-tooshort' })).toThrow(/characters total/);
        });

        it('normalizes empty string to absence (anonymous)', async () => {
            // Shell expansion of an unset CI variable produces '' — absence of
            // credential intent, not a credential.
            const ship = new TestShip({ apiUrl: 'https://test-api.com', token: '' });
            expect((ship as any).credential).toBeNull();
            expect(await (ship as any).getAuthHeaders()).toEqual({});
        });
    });

    describe('token provider', () => {
        it('is invoked per request — rotation needs no client rebuild', async () => {
            let current = TEST_API_KEY;
            const ship = new TestShip({ apiUrl: 'https://test-api.com', token: () => current });

            expect(await (ship as any).getAuthHeaders()).toEqual({ 'Authorization': `Bearer ${TEST_API_KEY}` });
            current = TEST_DEPLOY_TOKEN;
            expect(await (ship as any).getAuthHeaders()).toEqual({ 'Authorization': `Bearer ${TEST_DEPLOY_TOKEN}` });
        });

        it('supports async providers', async () => {
            const ship = new TestShip({
                apiUrl: 'https://test-api.com',
                token: async () => 'minted-access-token',
            });
            expect(await (ship as any).getAuthHeaders()).toEqual({ 'Authorization': 'Bearer minted-access-token' });
        });

        it('fails closed when the provider yields nothing — never degrades to anonymous', async () => {
            const ship = new TestShip({ apiUrl: 'https://test-api.com', token: () => '' });
            await expect((ship as any).getAuthHeaders()).rejects.toMatchObject({
                message: 'Token provider returned no token.',
            });
        });

        it('fails typed when the provider yields a non-string — never puts garbage on the wire', async () => {
            const ship = new TestShip({ apiUrl: 'https://test-api.com', token: (() => ({})) as any });
            await expect((ship as any).getAuthHeaders()).rejects.toMatchObject({
                message: 'Token provider returned a non-string value.',
            });
        });
    });

    describe('caller identity', () => {
        it('validates at construction — a value the API would drop throws instead', () => {
            expect(() => new TestShip({ caller: 'has space' })).toThrow(/Caller/);
            expect(() => new TestShip({ caller: 'a'.repeat(129) })).toThrow(/Caller/);
        });

        it('accepts a well-shaped caller and treats empty string as absence', () => {
            expect(() => new TestShip({ caller: 'mcp.user-42' })).not.toThrow();
            expect(() => new TestShip({ caller: '' })).not.toThrow();
        });
    });

    describe('session', () => {
        it('emits no Authorization header — cookies carry the identity', async () => {
            const ship = new TestShip({ apiUrl: 'https://test-api.com', session: true });
            expect(await (ship as any).getAuthHeaders()).toEqual({});
        });

        it('deploys with the cookie session', async () => {
            const ship = new TestShip({ apiUrl: 'https://test-api.com', session: true });
            (ship as any).http = { deploy: mockApiDeploy };
            await ship.deploy(['test'] as any);
            expect(mockApiDeploy).toHaveBeenCalled();
        });
    });

    describe('one client, one identity', () => {
        it('rejects token + session at construction', () => {
            expect(() => new TestShip({ token: TEST_API_KEY, session: true })).toThrow(
                'Provide either `token` or `session`, not both.'
            );
        });
    });
});
