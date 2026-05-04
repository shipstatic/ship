/**
 * Event system for Ship SDK
 * Lightweight, reliable event handling with proper error boundaries
 */

import type { ShipEvents } from './types.js';

/**
 * Lightweight typed event emitter.
 *
 * Public API: `on()` / `off()`. `emit()` is internal — only the SDK
 * publishes events. Throwing handlers are evicted automatically and
 * surfaced as `error` events on the next tick.
 */
export class SimpleEvents {
  private handlers = new Map<string, Set<Function>>();

  /**
   * Add event handler
   */
  on<K extends keyof ShipEvents>(event: K, handler: (...args: ShipEvents[K]) => void): void {
    if (!this.handlers.has(event as string)) {
      this.handlers.set(event as string, new Set());
    }
    this.handlers.get(event as string)!.add(handler);
  }

  /**
   * Remove event handler  
   */
  off<K extends keyof ShipEvents>(event: K, handler: (...args: ShipEvents[K]) => void): void {
    const eventHandlers = this.handlers.get(event as string);
    if (eventHandlers) {
      eventHandlers.delete(handler);
      if (eventHandlers.size === 0) {
        this.handlers.delete(event as string);
      }
    }
  }

  /**
   * Emit event (internal use only)
   * @internal
   */
  emit<K extends keyof ShipEvents>(event: K, ...args: ShipEvents[K]): void {
    const eventHandlers = this.handlers.get(event as string);
    if (!eventHandlers) return;

    // Snapshot handlers so a handler that mutates the set during iteration
    // (e.g. by removing itself) doesn't skip or duplicate calls.
    const handlerArray = Array.from(eventHandlers);

    for (const handler of handlerArray) {
      try {
        handler(...args);
      } catch (error) {
        // A throwing handler is treated as broken — drop it so we don't
        // repeatedly invoke it and re-emit the failure as an `error` event
        // for observability. Defer the re-emit so the next tick has a clean
        // call stack and we can't recurse if the error handler also throws.
        eventHandlers.delete(handler);

        if (event !== 'error') {
          setTimeout(() => {
            const err = error instanceof Error ? error : new Error(String(error));
            this.emit('error', err, String(event));
          }, 0);
        }
      }
    }
  }
}