/**
 * @file The transport's vehicles — a request to carry, for tests about carriage.
 *
 * `http*.test.ts` is the transport tier: headers, the credential, retries,
 * timeouts, events, error normalization. Every row there needs *a* request and
 * never a particular one, so what it reaches for should be the cheapest thing
 * the platform answers.
 *
 * They used to reach for methods ON the transport — `apiHttp.ping()`,
 * `.getAccount()`, `.listDeployments()`, `.deploy()`. The endpoint tier folded
 * down into `resources.ts` on 2026-08-12 and the transport stopped knowing what
 * a ping is, which is the point of the fold. Naming the vehicles here keeps
 * those rows reading exactly as before while putting the vocabulary where it
 * now lives: a path and a verb, handed to `request`.
 *
 * They live in ONE file rather than three copies, because three copies of a
 * path is the class of restatement the fold existed to remove.
 */

import { type AccountGetResponse, API_PATHS, type PlatformLimits } from '@shipstatic/types';
import type { ApiHttp } from '../../../src/shared/api/http';
import { createDeploymentResource } from '../../../src/shared/resources';
import type { DeployInput, StaticFile } from '../../../src/shared/types';

export const ping = (api: ApiHttp) =>
  api.request<{ success: boolean; timestamp: number }>(API_PATHS.PING, { method: 'GET' }, 'Ping');

export const getLimits = (api: ApiHttp) =>
  api.request<PlatformLimits>(API_PATHS.LIMITS, { method: 'GET' }, 'Get limits');

export const getAccount = (api: ApiHttp) =>
  api.request<AccountGetResponse>(API_PATHS.ACCOUNT, { method: 'GET' }, 'Get account');

export const listDeployments = (api: ApiHttp) =>
  api.request(API_PATHS.DEPLOYMENTS, { method: 'GET' }, 'List deployments');

export const listDomains = (api: ApiHttp) =>
  api.request(API_PATHS.DOMAINS, { method: 'GET' }, 'List domains');

/**
 * A deployment resource over a given transport — the one vehicle that cannot be
 * a bare `request`, because a deploy's body is BUILT rather than written, and
 * its ceiling is chosen rather than defaulted.
 *
 * Used only where the row's subject is how the transport carries a deploy: the
 * three timeout budgets, a caller's own signal, cookie credentials. Everything
 * else about deploying is in `tests/shared/resources-deployments.test.ts`.
 *
 * `processInput` is the identity, so a row hands it the `StaticFile[]` it wants
 * on the wire and nothing collects anything.
 */
export const deploymentsOver = (api: ApiHttp) =>
  createDeploymentResource({
    getApi: () => api,
    processInput: async (input) => input as unknown as StaticFile[],
  });

/**
 * Deploy exactly these files through `api`, bypassing collection.
 *
 * `spaDetect: false` by default, and that default is load-bearing: the SPA
 * pre-flight is a SECOND request, made before the deploy, and the transport
 * rows here are about the deploy's own carriage. Leaving it on made the
 * fake-timer ceiling rows hang on `/spa-check` and never reach the request
 * they were measuring. A row that wants the pre-flight can ask for it.
 */
export const deploy = (
  api: ApiHttp,
  files: Array<Partial<StaticFile>>,
  options: Parameters<ReturnType<typeof deploymentsOver>['upload']>[1] = {},
) => deploymentsOver(api).upload(files as unknown as DeployInput, { spaDetect: false, ...options });
