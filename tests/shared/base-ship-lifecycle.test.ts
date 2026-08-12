import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Ship } from '../../src/shared/base-ship';
import type { DeployInput, DeploymentOptions, StaticFile } from '../../src/shared/types';
import { apiKey, deployToken } from '../fixtures/builders';

const TEST_API_KEY = apiKey('a');
const TEST_DEPLOY_TOKEN = deployToken('b');

// Concrete test implementation. The `ensureInitialized` no-op skips the
// `GET /limits` fetch so these tests can focus on the credential lifecycle
// without needing to mock platform-limits wiring.
class TestShip extends Ship {
  protected async ensureInitialized(): Promise<void> {
    /* no platform-limits fetch in tests */
  }
  protected async processInput(
    _input: DeployInput,
    _options: DeploymentOptions,
  ): Promise<StaticFile[]> {
    return [
      {
        path: 'test.html',
        content: Buffer.from('<html>Test</html>'),
        size: 18,
        md5: 'test-hash',
      },
    ];
  }
}

describe('Credential Lifecycle', () => {
  let mockApiDeploy: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockApiDeploy = vi.fn().mockResolvedValue({
      id: 'dep_123',
      url: 'https://dep_123.shipstatic.com',
    });
  });

  describe('setToken()', () => {
    it('should take effect immediately, without rebuilding the client', async () => {
      const ship = new TestShip({ apiUrl: 'https://test-api.com' });

      // Override http with mock
      (ship as any).http = {
        deploy: mockApiDeploy,
        ping: vi.fn().mockResolvedValue(true),
        getLimits: vi.fn().mockResolvedValue({}),
      };

      // Anonymous first — no Authorization header.
      expect(await (ship as any).getAuthHeaders()).toEqual({});

      ship.setToken(TEST_DEPLOY_TOKEN);
      expect(await (ship as any).getAuthHeaders()).toEqual({
        Authorization: `Bearer ${TEST_DEPLOY_TOKEN}`,
      });

      const result = await ship.deploy(['./test'] as any);
      expect(result).toEqual({
        id: 'dep_123',
        url: 'https://dep_123.shipstatic.com',
      });
      expect(mockApiDeploy).toHaveBeenCalled();
    });

    it('should validate input', () => {
      const ship = new TestShip({ apiUrl: 'https://test-api.com' });

      expect(() => ship.setToken('')).toThrow('Invalid token');
      expect(() => ship.setToken(null as any)).toThrow('Invalid token');
      expect(() => ship.setToken(undefined as any)).toThrow('Invalid token');
      // Prefixed tokens carry format guarantees — malformed ones fail fast.
      expect(() => ship.setToken('ship-tooshort')).toThrow(/characters total/);
      expect(() => ship.setToken('deploy-tooshort')).toThrow(/characters total/);
    });

    it('should replace the previous credential — last write wins', async () => {
      const ship = new TestShip({
        apiUrl: 'https://test-api.com',
        token: TEST_API_KEY,
      });

      expect(await (ship as any).getAuthHeaders()).toEqual({
        Authorization: `Bearer ${TEST_API_KEY}`,
      });

      ship.setToken(TEST_DEPLOY_TOKEN);

      expect(await (ship as any).getAuthHeaders()).toEqual({
        Authorization: `Bearer ${TEST_DEPLOY_TOKEN}`,
      });
    });

    it('should accept a provider function', async () => {
      const ship = new TestShip({
        apiUrl: 'https://test-api.com',
        token: TEST_API_KEY,
      });

      ship.setToken(() => 'minted-access-token');

      expect(await (ship as any).getAuthHeaders()).toEqual({
        Authorization: 'Bearer minted-access-token',
      });
    });

    it("rejects on a session client — the constructor exclusion holds for the client's life", async () => {
      const ship = new TestShip({ apiUrl: 'https://test-api.com', session: true });

      expect(() => ship.setToken(TEST_API_KEY)).toThrow(
        'Provide either `token` or `session`, not both.',
      );
      expect(() => ship.setToken(() => TEST_API_KEY)).toThrow(
        'Provide either `token` or `session`, not both.',
      );
      // Still cookie-identified — no Authorization header was armed.
      expect(await (ship as any).getAuthHeaders()).toEqual({});
    });
  });

  describe('constructor initialization', () => {
    it('should adopt a constructor token', async () => {
      const ship = new TestShip({
        apiUrl: 'https://test-api.com',
        token: TEST_DEPLOY_TOKEN,
      });

      // Override http with mock
      (ship as any).http = {
        deploy: mockApiDeploy,
        ping: vi.fn().mockResolvedValue(true),
        getLimits: vi.fn().mockResolvedValue({}),
      };

      await ship.deploy(['./test'] as any);
      expect(mockApiDeploy).toHaveBeenCalled();
    });
  });

  describe('setHeaders() / clearHeaders()', () => {
    it('should set global headers on the HTTP client', () => {
      const ship = new TestShip({ apiUrl: 'https://test-api.com' });

      const mockSetGlobalHeaders = vi.fn();
      (ship as any).http.setGlobalHeaders = mockSetGlobalHeaders;

      ship.setHeaders({ 'X-Custom': 'value' });

      expect(mockSetGlobalHeaders).toHaveBeenCalledWith({ 'X-Custom': 'value' });
    });

    it('should clear global headers', () => {
      const ship = new TestShip({ apiUrl: 'https://test-api.com' });

      const mockSetGlobalHeaders = vi.fn();
      (ship as any).http.setGlobalHeaders = mockSetGlobalHeaders;

      ship.setHeaders({ 'X-Custom': 'value' });
      ship.clearHeaders();

      expect(mockSetGlobalHeaders).toHaveBeenLastCalledWith({});
    });
  });
});
