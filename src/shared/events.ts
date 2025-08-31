/**
 * Event system for Ship SDK
 * Lightweight, reliable event handling with proper error boundaries
 */

import type { ShipEvents } from './types.js';

/**
 * Lightweight event system
 * - Add handler: on() 
 * - Remove handler: off()
 * - Emit events: emit() [internal]
 * - Transfer events: transfer() [internal]
 * - Reliable error handling and cleanup
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

    // Create array to prevent modification during iteration
    const handlerArray = Array.from(eventHandlers);
    
    for (const handler of handlerArray) {
      try {
        handler(...args);
      } catch (error) {
        // Remove failing handlers to prevent repeated failures
        eventHandlers.delete(handler);
        
        // Re-emit as error event (only if not already error to prevent loops)
        if (event !== 'error') {
          // Use setTimeout to break out of current call stack and prevent infinite recursion
          setTimeout(() => {
            if (error instanceof Error) {
              this.emit('error', error, String(event));
            } else {
              this.emit('error', new Error(String(error)), String(event));
            }
          }, 0);
        }
      }
    }
  }

  /**
   * Transfer all handlers to another events instance
   * @internal
   */
  transfer(target: SimpleEvents): void {
    this.handlers.forEach((handlers, event) => {
      handlers.forEach(handler => {
        target.on(event as keyof ShipEvents, handler as (...args: any[]) => void);
      });
    });
  }

  /**
   * Clear all handlers (for cleanup)
   * @internal  
   */
  clear(): void {
    this.handlers.clear();
  }
}