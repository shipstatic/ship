/**
 * @file Subject: `src/shared/events.ts` — `SimpleEvents`, the typed emitter
 * `ApiHttp` extends and `Ship.on`/`Ship.off` delegate to.
 *
 * The module had NO mirror test until 2026-07-27; its behaviour was smeared
 * across two `integration/event-system*.test.ts` files that drove it through
 * HTTP and asserted `toBeGreaterThanOrEqual(1)`. One of them recorded the
 * emitter's contract backwards — "no circuit breaker in simple
 * implementation" — while `emit()` has always EVICTED a throwing handler.
 * That is the sort of claim a direct test cannot get wrong.
 *
 * Split by altitude: the emitter's own rules are exercised on the class, and
 * only the properties that need a real request (response-clone readability,
 * one event per response, request-before-response) drive a Ship.
 */

import { describe, expect, it, vi } from 'vitest';
import { Ship } from '../../src/node/index';
import { SimpleEvents } from '../../src/shared/events';
import type { Fetch } from '../../src/shared/types';
import { apiKey } from '../fixtures/builders';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('SimpleEvents', () => {
  describe('registration', () => {
    it('calls every registered handler with the emitted arguments', () => {
      const events = new SimpleEvents();
      const first = vi.fn();
      const second = vi.fn();

      events.on('request', first);
      events.on('request', second);
      events.emit('request', 'https://api.example.com/ping', { method: 'GET' });

      expect(first).toHaveBeenCalledWith('https://api.example.com/ping', { method: 'GET' });
      expect(second).toHaveBeenCalledWith('https://api.example.com/ping', { method: 'GET' });
    });

    it('registers a handler once however many times it is added', () => {
      const events = new SimpleEvents();
      const handler = vi.fn();

      events.on('request', handler);
      events.on('request', handler);
      events.emit('request', 'https://api.example.com/ping', {});

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('stops calling a handler after off()', () => {
      const events = new SimpleEvents();
      const handler = vi.fn();

      events.on('request', handler);
      events.off('request', handler);
      events.emit('request', 'https://api.example.com/ping', {});

      expect(handler).not.toHaveBeenCalled();
    });

    it('leaves other handlers registered when one is removed', () => {
      const events = new SimpleEvents();
      const removed = vi.fn();
      const kept = vi.fn();

      events.on('request', removed);
      events.on('request', kept);
      events.off('request', removed);
      events.emit('request', 'https://api.example.com/ping', {});

      expect(removed).not.toHaveBeenCalled();
      expect(kept).toHaveBeenCalledTimes(1);
    });

    it('is a no-op to emit an event nobody listens to', () => {
      const events = new SimpleEvents();

      expect(() => events.emit('error', new Error('boom'), 'url')).not.toThrow();
    });

    it('is a no-op to off() a handler that was never on()', () => {
      const events = new SimpleEvents();

      expect(() => events.off('request', vi.fn())).not.toThrow();
    });
  });

  describe('handler mutation during emit', () => {
    it('still calls the remaining handlers when one removes itself', () => {
      // emit() iterates a snapshot for exactly this reason: mutating the live
      // Set mid-iteration would skip the handler that follows the remover.
      const events = new SimpleEvents();
      const after = vi.fn();
      const selfRemoving = vi.fn(() => events.off('request', selfRemoving));

      events.on('request', selfRemoving);
      events.on('request', after);
      events.emit('request', 'https://api.example.com/ping', {});

      expect(selfRemoving).toHaveBeenCalledTimes(1);
      expect(after).toHaveBeenCalledTimes(1);
    });
  });

  describe('a throwing handler is broken, not retried', () => {
    it('evicts the handler rather than invoking it again', () => {
      const events = new SimpleEvents();
      const throwing = vi.fn(() => {
        throw new Error('handler is broken');
      });

      events.on('request', throwing);
      events.emit('request', 'https://api.example.com/ping', {});
      events.emit('request', 'https://api.example.com/ping', {});

      expect(throwing).toHaveBeenCalledTimes(1);
    });

    it('does not stop the handlers registered after it', () => {
      const events = new SimpleEvents();
      const throwing = vi.fn(() => {
        throw new Error('handler is broken');
      });
      const healthy = vi.fn();

      events.on('request', throwing);
      events.on('request', healthy);
      events.emit('request', 'https://api.example.com/ping', {});

      expect(healthy).toHaveBeenCalledTimes(1);
    });

    it('re-emits the failure as an error event on the next tick', async () => {
      vi.useFakeTimers();
      try {
        const events = new SimpleEvents();
        const onError = vi.fn();

        events.on('error', onError);
        events.on('request', () => {
          throw new Error('handler is broken');
        });
        events.emit('request', 'https://api.example.com/ping', {});

        // Deferred deliberately: re-emitting inline would run the error
        // handler on the failing handler's own stack.
        expect(onError).not.toHaveBeenCalled();
        vi.runAllTimers();

        expect(onError).toHaveBeenCalledWith(expect.any(Error), 'request');
        expect(onError.mock.calls[0][0].message).toBe('handler is broken');
      } finally {
        vi.useRealTimers();
      }
    });

    it('wraps a non-Error throw so the error event always carries an Error', async () => {
      vi.useFakeTimers();
      try {
        const events = new SimpleEvents();
        const onError = vi.fn();

        events.on('error', onError);
        events.on('request', () => {
          throw 'a string, not an Error';
        });
        events.emit('request', 'https://api.example.com/ping', {});
        vi.runAllTimers();

        expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(onError.mock.calls[0][0].message).toBe('a string, not an Error');
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not recurse when the error handler itself throws', () => {
      vi.useFakeTimers();
      try {
        const events = new SimpleEvents();
        const throwingErrorHandler = vi.fn(() => {
          throw new Error('error handler is broken too');
        });

        events.on('error', throwingErrorHandler);
        events.emit('error', new Error('original'), 'request');
        vi.runAllTimers();

        // Called once, evicted, and no error event re-emitted for an error
        // event — otherwise this is an infinite loop.
        expect(throwingErrorHandler).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe('Ship event delegation', () => {
  /** Answers `/limits` then `/ping`, so each assertion can target one route. */
  function stubApi(pingResponse: () => Response): Fetch {
    return vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/limits')) {
        return json({ maxFileSize: 20971520, maxFilesCount: 500, maxTotalSize: 52428800 });
      }
      return pingResponse();
    }) as unknown as Fetch;
  }

  const newShip = (fetch: Fetch) =>
    new Ship({ apiUrl: 'https://api.example.com', token: apiKey('a'), fetch });

  it('hands the response event a body that is still readable', async () => {
    // The emitted Response is a clone; handing out the original would consume
    // the stream the SDK is about to parse.
    const ship = newShip(stubApi(() => json({ success: true })));
    const bodies: unknown[] = [];

    ship.on('response', async (response, url) => {
      if (url.endsWith('/ping')) bodies.push(await response.json());
    });

    await ship.ping();

    expect(bodies).toEqual([{ success: true }]);
  });

  it('emits exactly one response event per request', async () => {
    const ship = newShip(stubApi(() => json({ success: true })));
    const urls: string[] = [];

    ship.on('response', (_response, url) => urls.push(url));

    await ship.ping();

    expect(urls.filter((u) => u.endsWith('/ping'))).toHaveLength(1);
  });

  it('emits exactly one response event for a body-less 204 too', async () => {
    // Aimed at `/ping` specifically: an earlier version mocked ONE response and
    // the lazy `/limits` call consumed it, so the 204 never reached the request
    // the test named.
    const ship = newShip(stubApi(() => new Response(null, { status: 204 })));
    const statuses: number[] = [];

    ship.on('response', (response, url) => {
      if (url.endsWith('/ping')) statuses.push(response.status);
    });

    await ship.ping();

    expect(statuses).toEqual([204]);
  });

  it('emits request before response for the same URL', async () => {
    const ship = newShip(stubApi(() => json({ success: true })));
    const order: string[] = [];

    ship.on('request', (url) => {
      if (url.endsWith('/ping')) order.push('request');
    });
    ship.on('response', (_response, url) => {
      if (url.endsWith('/ping')) order.push('response');
    });

    await ship.ping();

    expect(order).toEqual(['request', 'response']);
  });

  it('carries the Authorization header into the request event', async () => {
    const ship = newShip(stubApi(() => json({ success: true })));
    const auth: Array<string | undefined> = [];

    ship.on('request', (url, init) => {
      if (url.endsWith('/ping')) {
        auth.push((init.headers as Record<string, string>)?.Authorization);
      }
    });

    await ship.ping();

    expect(auth).toEqual([`Bearer ${apiKey('a')}`]);
  });

  it('emits an error event when the transport fails', async () => {
    const ship = newShip(
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }) as unknown as Fetch,
    );
    const errors: Array<{ message: string; url: string }> = [];

    ship.on('error', (error, url) => errors.push({ message: error.message, url }));

    await expect(ship.ping()).rejects.toThrow();

    expect(errors).toHaveLength(1);
    expect(errors[0].url).toBe('https://api.example.com/limits');
  });
});
