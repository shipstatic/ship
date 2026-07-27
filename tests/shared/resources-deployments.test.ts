import { DEPLOYMENT_CONFIG_FILENAME } from '@shipstatic/types';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiHttp } from '../../src/shared/api/http';
import { createDeploymentResource, type DeploymentResource } from '../../src/shared/resources';
import type { DeploymentOptions } from '../../src/shared/types';
import { makeDeployment } from '../fixtures/builders';

// No `vi.mock` of `../../../src/shared/lib/spa` here, deliberately. An earlier
// revision mocked `detectAndConfigureSPA` with a hand-written reimplementation
// of its branching — so the "SPA detection is applied" test below asserted the
// fake's behaviour, and would have kept passing had the real function stopped
// injecting anything. The real module runs; `mockApiHttp.checkSPA` is the only
// seam, which is exactly the decision this file needs to observe.

describe('Deployment Resource (Unified Architecture)', () => {
  let mockApiHttp: ApiHttp;
  let mockProcessInput: Mock;
  // Parameterized exactly as `base-ship` declares it — since types
  // 2.5.0-beta.0 the interface admits the SDK's extended options directly.
  let deploymentResource: DeploymentResource<DeploymentOptions>;
  let mockEnsureInit: Mock;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock API client — resolved values come from the canonical builder, so
    // this file cannot drift into fictional wire shapes (the audit found an
    // `{id, url}` deployment here; the real field is `deployment`).
    mockApiHttp = {
      deploy: vi.fn().mockResolvedValue(makeDeployment()),
      ping: vi.fn().mockResolvedValue(true),
      checkSPA: vi.fn().mockResolvedValue(false),
    } as any;

    // Mock processInput function (environment-specific)
    mockProcessInput = vi.fn().mockResolvedValue([
      { path: 'index.html', content: Buffer.from('<html></html>'), size: 13, md5: 'abc123' },
      { path: 'style.css', content: Buffer.from('body {}'), size: 7, md5: 'def456' },
    ]);

    // Mock initialization
    mockEnsureInit = vi.fn().mockResolvedValue(undefined);

    // Create deployment resource with mocks
    deploymentResource = createDeploymentResource({
      getApi: () => mockApiHttp,
      ensureInit: mockEnsureInit,
      processInput: mockProcessInput,
    });
  });

  const spaDetectOn: DeploymentOptions = { spaDetect: true };

  describe('upload', () => {
    it('should process input and deploy files through unified pipeline', async () => {
      const mockInput = ['./dist'];
      const options: DeploymentOptions = {};

      const result = await deploymentResource.upload(mockInput as any, options);

      // Verify the pipeline executed correctly
      expect(mockEnsureInit).toHaveBeenCalled();
      expect(mockProcessInput).toHaveBeenCalledWith(mockInput, options);
      expect(mockApiHttp.deploy).toHaveBeenCalled();
      expect(result).toEqual(makeDeployment());
    });

    it('should pass labels option to API deploy call', async () => {
      const mockInput = ['./dist'];
      const labels = ['production', 'v1.0.0'];
      const options: DeploymentOptions = { labels };

      (mockApiHttp.deploy as any).mockResolvedValue(makeDeployment({ labels }));

      const result = await deploymentResource.upload(mockInput as any, options);

      // Verify labels were passed through the pipeline
      expect(mockApiHttp.deploy).toHaveBeenCalled();
      const deployCallArgs = (mockApiHttp.deploy as any).mock.calls[0];
      const deployOptions = deployCallArgs[1];
      expect(deployOptions.labels).toEqual(labels);
      expect(result.labels).toEqual(labels);
    });

    it('should handle deployment with multiple labels', async () => {
      const mockInput = ['./dist'];
      const labels = ['production', 'v2.0.0', 'stable', 'release-2024'];
      const options: DeploymentOptions = { labels };

      (mockApiHttp.deploy as any).mockResolvedValue(makeDeployment({ labels }));

      const result = await deploymentResource.upload(mockInput as any, options);

      const deployCallArgs = (mockApiHttp.deploy as any).mock.calls[0];
      const deployOptions = deployCallArgs[1];
      expect(deployOptions.labels).toEqual(labels);
      expect(result.labels).toEqual(labels);
    });

    it('should handle deployment without labels', async () => {
      const mockInput = ['./dist'];
      const options: DeploymentOptions = {};

      const result = await deploymentResource.upload(mockInput as any, options);

      const deployCallArgs = (mockApiHttp.deploy as any).mock.calls[0];
      const deployOptions = deployCallArgs[1];
      expect(deployOptions.labels).toBeUndefined();
      expect(result.labels).toEqual([]);
    });

    it('should handle empty labels array', async () => {
      const mockInput = ['./dist'];
      const options: DeploymentOptions = { labels: [] };

      const _result = await deploymentResource.upload(mockInput as any, options);

      const deployCallArgs = (mockApiHttp.deploy as any).mock.calls[0];
      const deployOptions = deployCallArgs[1];
      expect(deployOptions.labels).toEqual([]);
    });

    it('injects the SPA config into the deploy body when the API says it is a SPA', async () => {
      (mockApiHttp.checkSPA as any).mockResolvedValue(true);

      await deploymentResource.upload(['./dist'] as any, spaDetectOn);

      const [deployedFiles] = (mockApiHttp.deploy as any).mock.calls[0];
      expect(deployedFiles).toHaveLength(3); // 2 original + the real ship.json
      const config = deployedFiles.find((f: any) => f.path === DEPLOYMENT_CONFIG_FILENAME);
      expect(JSON.parse(config.content.toString())).toEqual({
        rewrites: [{ source: '/(.*)', destination: '/index.html' }],
      });
    });

    it('leaves the deploy body alone when the API says it is not a SPA', async () => {
      (mockApiHttp.checkSPA as any).mockResolvedValue(false);

      await deploymentResource.upload(['./dist'] as any, spaDetectOn);

      const [deployedFiles] = (mockApiHttp.deploy as any).mock.calls[0];
      expect(deployedFiles).toHaveLength(2);
    });

    it('deploys the original files when the SPA pre-flight fails', async () => {
      // Salvaged from integration/unified-behavior.test.ts. `spa.test.ts` proves
      // detectAndConfigureSPA RETURNS the untouched list on error; this proves
      // the deploy still happens with it. A flaky pre-flight must never fail a
      // deploy — and it must not silently drop files either.
      (mockApiHttp.checkSPA as any).mockRejectedValue(new Error('SPA check unavailable'));

      await deploymentResource.upload(['./dist'] as any, spaDetectOn);

      const [deployedFiles] = (mockApiHttp.deploy as any).mock.calls[0];
      expect(deployedFiles.some((f: any) => f.path === DEPLOYMENT_CONFIG_FILENAME)).toBe(false);
      expect(deployedFiles).toEqual(await mockProcessInput.mock.results[0].value);
    });

    it('should handle processInput function not provided', async () => {
      const brokenResource = createDeploymentResource({
        getApi: () => mockApiHttp,
        ensureInit: mockEnsureInit,
        processInput: undefined as any,
      });

      await expect(brokenResource.upload(['./dist'] as any, {})).rejects.toThrow(
        'processInput function is not provided.',
      );
    });

    it('passes per-call options to processInput unmodified', async () => {
      const options: DeploymentOptions = { pathDetect: false, labels: ['audit'] };
      await deploymentResource.upload(['./dist'] as any, options);

      const processInputCall = mockProcessInput.mock.calls[0];
      expect(processInputCall[1]).toEqual(options);
    });
  });

  describe('list', () => {
    it('should call API listDeployments after initialization', async () => {
      const mockList = { deployments: [], cursor: null, total: 0 };
      mockApiHttp.listDeployments = vi.fn().mockResolvedValue(mockList);

      const result = await deploymentResource.list();

      expect(mockEnsureInit).toHaveBeenCalled();
      expect(mockApiHttp.listDeployments).toHaveBeenCalled();
      expect(result).toEqual(mockList);
    });

    it('forwards pagination options to the API', async () => {
      mockApiHttp.listDeployments = vi
        .fn()
        .mockResolvedValue({ deployments: [], cursor: null, total: 0 });

      await deploymentResource.list({ limit: 2, cursor: 'abc' });

      expect(mockApiHttp.listDeployments).toHaveBeenCalledWith({ limit: 2, cursor: 'abc' });
    });
  });

  describe('get', () => {
    it('should call API getDeployment after initialization', async () => {
      const mockDeployment = { id: 'dep_123', url: 'https://example.com' };
      mockApiHttp.getDeployment = vi.fn().mockResolvedValue(mockDeployment);

      const result = await deploymentResource.get('dep_123');

      expect(mockEnsureInit).toHaveBeenCalled();
      expect(mockApiHttp.getDeployment).toHaveBeenCalledWith('dep_123');
      expect(result).toEqual(mockDeployment);
    });
  });

  describe('remove', () => {
    it('should call API removeDeployment after initialization', async () => {
      mockApiHttp.removeDeployment = vi.fn().mockResolvedValue(undefined);

      await deploymentResource.remove('dep_123');

      expect(mockEnsureInit).toHaveBeenCalled();
      expect(mockApiHttp.removeDeployment).toHaveBeenCalledWith('dep_123');
    });
  });
});
