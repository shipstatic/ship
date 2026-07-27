/**
 * @file Subject: `src/shared/core/config.ts` — `mergeDeployOptions`, the one
 * pure helper that folds a client's defaults into a per-deploy option bag.
 *
 * Consolidates the former `shared/core/progress-merge.test.ts` (whose name
 * described one field rather than its subject) with the `mergeDeployOptions`
 * describe that had drifted into `node/core/config.test.ts` — a file whose
 * actual subject is `readEnvConfig`.
 */
import { describe, expect, it } from 'vitest';
import { mergeDeployOptions } from '../../../src/shared/core/config';
import type { DeploymentOptions, ProgressInfo, ShipClientOptions } from '../../../src/shared/types';

describe('mergeDeployOptions', () => {
  describe('precedence', () => {
    it('takes the client default when the call omits the option', () => {
      const result = mergeDeployOptions({ timeout: 5000 }, { timeout: 10000, maxConcurrency: 3 });

      expect(result).toEqual({ timeout: 5000, maxConcurrency: 3 });
    });

    it('never lets a default override an explicit call option', () => {
      const result = mergeDeployOptions(
        { timeout: 5000, maxConcurrency: 8 },
        { timeout: 10000, maxConcurrency: 3 },
      );

      expect(result).toEqual({ timeout: 5000, maxConcurrency: 8 });
    });
  });

  describe('what may flow from the client', () => {
    it('merges only deploy concerns — the client identity stays on the instance', () => {
      // Credentials, the API URL, and the caller identifier are not deploy
      // options: one client is one principal speaking for one end user. Only
      // progress, timing, and concurrency flow from client defaults into a
      // deploy.
      const result = mergeDeployOptions(
        {},
        {
          apiUrl: 'https://api.example.com',
          token: 'default-token',
          timeout: 10000,
          caller: 'tenant-1',
        },
      );

      expect(result).toEqual({ timeout: 10000 });
    });
  });

  describe('onProgress', () => {
    const clientCallback = (_info: ProgressInfo) => {};
    const optionsCallback = (_info: ProgressInfo) => {};

    it('adopts the client default when the call has none', () => {
      const clientDefaults: ShipClientOptions = {
        apiUrl: 'https://api.example.com',
        onProgress: clientCallback,
      };

      expect(mergeDeployOptions({}, clientDefaults).onProgress).toBe(clientCallback);
    });

    it('keeps the call option and drops the default', () => {
      const merged = mergeDeployOptions(
        { onProgress: optionsCallback },
        { onProgress: clientCallback },
      );

      expect(merged.onProgress).toBe(optionsCallback);
    });

    it('stays undefined when neither side supplies one', () => {
      const merged = mergeDeployOptions({}, { apiUrl: 'https://api.example.com' });

      expect(merged.onProgress).toBeUndefined();
    });

    it('merges alongside the other deploy options', () => {
      const clientDefaults: ShipClientOptions = {
        apiUrl: 'https://api.example.com',
        timeout: 30000,
        onProgress: clientCallback,
      };
      // `labels` and `password` are real DeploymentOptions members. An earlier
      // revision used `subdomain`, which the type has never had — the test only
      // compiled because `tests/**` sat outside `pnpm typecheck`.
      const options: DeploymentOptions = { labels: ['production'], password: 'hunter22' };

      const merged = mergeDeployOptions(options, clientDefaults);

      expect(merged).toEqual({
        labels: ['production'],
        password: 'hunter22',
        timeout: 30000,
        onProgress: clientCallback,
      });
    });
  });
});
