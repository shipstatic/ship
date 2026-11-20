/**
 * @file A `fetch` for a row to hand its client: it answers by path and keeps
 * what was sent.
 *
 * `fetch` is a published option (`ShipClientOptions.fetch`), so a row whose
 * subject is what `Ship` does around a request builds a real client on this
 * and reads the requests that left it. Nothing inside the SDK is replaced.
 */

import type { Fetch } from '../../src/shared/types';

/** One request, as the client handed it to `fetch`. */
export interface Sent {
  url: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * What one path answers: a value, sent as JSON, or a function of the request
 * that returns one. A function that throws is a request that never arrived.
 */
export type Answer = unknown | ((sent: Sent) => unknown);

/** @param answers - Keyed by path (`'/limits'`). A path not listed answers `{}`. */
export function fakeApi(answers: Record<string, Answer> = {}) {
  const sent: Sent[] = [];

  const fetch = (async (url: string, init: RequestInit = {}) => {
    const request: Sent = {
      url,
      path: new URL(url).pathname,
      headers: init.headers as Record<string, string>,
      body: init.body,
    };
    sent.push(request);

    const answer = answers[request.path];
    return Response.json((typeof answer === 'function' ? answer(request) : answer) ?? {});
  }) as Fetch;

  return {
    fetch,
    /** Every request, in order. */
    sent,
    /** The requests one path received. */
    sentTo: (path: string) => sent.filter((request) => request.path === path),
    /** Change what a path answers from here on. */
    answer: (path: string, value: Answer) => {
      answers[path] = value;
    },
  };
}
