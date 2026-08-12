/**
 * @file A `Transport` test double, answering by OPERATION NAME.
 *
 * Several files stub a `Ship`'s transport rather than run one — `base-ship*`,
 * the two platform entries — because their subject is what the class does
 * around a request, not the request. They used to stub it as an object of
 * endpoint METHODS (`{ deploy, ping, getLimits, checkSPA, … }`), which stopped
 * being possible on 2026-08-12: the endpoints folded down into `resources.ts`
 * and a transport has two methods now, whatever the request is.
 *
 * So the double keys on the one thing that still distinguishes one request from
 * another at this seam — the operation name every call already carries for its
 * error messages. A row says "answer `Get limits` with this" and reads exactly
 * as the old method stub did, without inventing a method that does not exist.
 *
 * The upside over the old shape is that it CANNOT go stale. An endpoint-method
 * stub survives every rename of the method it names, silently — this file's
 * predecessors listed `listApiKeys`, `removeApiKey`, `getAliases` and `get`,
 * all from removed eras, and no assertion could ever have caught them.
 */

import { vi } from 'vitest';
import type { RequestResult, ShipRequestInit, Transport } from '../../src/shared/api/http';

/** One recorded request, as the resource composed it. */
export interface CarriedRequest {
  path: string;
  init: ShipRequestInit;
  operation: string;
  timeoutMs?: number;
}

export type FakeTransport = Transport & {
  request: ReturnType<typeof vi.fn>;
  requestWithStatus: ReturnType<typeof vi.fn>;
  /** Every request this transport was asked to carry, in order. */
  carried: CarriedRequest[];
  /** The requests for one operation — `carriedFor('Deploy')`. */
  carriedFor: (operation: string) => CarriedRequest[];
  /** Change what one operation answers, mid-test. */
  answer: (operation: string, value: OperationAnswer) => void;
};

/**
 * An answer for one operation: a value to resolve, or a function of the
 * request. A function that throws (or a rejected promise) fails the request,
 * which is how a row makes one operation fail while the rest succeed.
 */
export type OperationAnswer = unknown | ((req: CarriedRequest) => unknown);

/**
 * @param answers - Keyed by the operation name the caller passes to `request`
 *   (`'Ping'`, `'Get limits'`, `'Deploy'`, `'SPA check'`, …). An unlisted
 *   operation resolves `undefined`, which is what an endpoint the row does not
 *   care about should do.
 * @param deploy - Overrides for the deploy carriage the deployment resource
 *   reads (endpoint and the two ceilings).
 */
export function fakeTransport(
  answers: Record<string, OperationAnswer> = {},
  deploy: Partial<Transport['deploy']> = {},
): FakeTransport {
  const carried: CarriedRequest[] = [];

  const answer = async (req: CarriedRequest) => {
    carried.push(req);
    const value = answers[req.operation];
    return typeof value === 'function' ? (value as (r: CarriedRequest) => unknown)(req) : value;
  };

  const request = vi.fn(
    async (path: string, init: ShipRequestInit, operation: string, timeoutMs?: number) =>
      answer({ path, init, operation, timeoutMs }),
  );

  const requestWithStatus = vi.fn(
    async (path: string, init: ShipRequestInit, operation: string): Promise<RequestResult<never>> =>
      ({
        data: await answer({ path, init, operation }),
        status: 200,
      }) as RequestResult<never>,
  );

  return {
    request,
    requestWithStatus,
    deploy: { endpoint: '/deployments', timeout: 300_000, buildTimeout: 600_000, ...deploy },
    carried,
    carriedFor: (operation: string) => carried.filter((c) => c.operation === operation),
    answer: (operation: string, value: OperationAnswer) => {
      answers[operation] = value;
    },
  } as unknown as FakeTransport;
}
