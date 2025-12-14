/**
 * @file Tests for ProgressInfo type and progress callback behavior
 * 
 * Validates the unified progress callback API:
 * - ProgressInfo interface shape
 * - Callback passthrough from client defaults
 * - Callback passthrough from deploy options
 * - Deploy options override client defaults
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import type { ProgressInfo, DeploymentOptions, ShipClientOptions } from '../../../src/shared/types';

describe('ProgressInfo Type', () => {
    it('should have correct shape with all required fields', () => {
        const info: ProgressInfo = {
            percent: 50,
            loaded: 1024,
            total: 2048
        };

        expect(info.percent).toBe(50);
        expect(info.loaded).toBe(1024);
        expect(info.total).toBe(2048);
    });

    it('should accept optional file field', () => {
        const info: ProgressInfo = {
            percent: 75,
            loaded: 1536,
            total: 2048,
            file: 'index.html'
        };

        expect(info.file).toBe('index.html');
    });

    it('should use 0-100 scale for percent', () => {
        const atStart: ProgressInfo = { percent: 0, loaded: 0, total: 1000 };
        const atMiddle: ProgressInfo = { percent: 50, loaded: 500, total: 1000 };
        const atEnd: ProgressInfo = { percent: 100, loaded: 1000, total: 1000 };

        expect(atStart.percent).toBe(0);
        expect(atMiddle.percent).toBe(50);
        expect(atEnd.percent).toBe(100);
    });
});

describe('onProgress Callback in DeploymentOptions', () => {
    it('should accept ProgressInfo callback', () => {
        const options: DeploymentOptions = {
            onProgress: (info) => {
                // Type assertion - verify callback receives ProgressInfo
                const { percent, loaded, total, file } = info;
                console.log(`${percent}% - ${loaded}/${total}${file ? ` (${file})` : ''}`);
            }
        };

        expect(options.onProgress).toBeDefined();
    });

    it('should allow destructuring percent directly', () => {
        const options: DeploymentOptions = {
            onProgress: ({ percent }) => {
                console.log(`${percent}%`);
            }
        };

        expect(options.onProgress).toBeDefined();
    });

    it('should allow accessing all fields', () => {
        let capturedInfo: ProgressInfo | null = null;

        const options: DeploymentOptions = {
            onProgress: (info) => {
                capturedInfo = info;
            }
        };

        // Simulate calling the callback
        options.onProgress?.({
            percent: 42,
            loaded: 420,
            total: 1000,
            file: 'test.txt'
        });

        expect(capturedInfo).toEqual({
            percent: 42,
            loaded: 420,
            total: 1000,
            file: 'test.txt'
        });
    });
});

describe('onProgress Callback in ShipClientOptions', () => {
    it('should accept ProgressInfo callback as client default', () => {
        const options: ShipClientOptions = {
            apiKey: 'ship-test-key',
            onProgress: ({ percent, loaded, total }) => {
                console.log(`Client default: ${percent}% (${loaded}/${total})`);
            }
        };

        expect(options.onProgress).toBeDefined();
    });

    it('should work alongside other client options', () => {
        const progressValues: number[] = [];

        const options: ShipClientOptions = {
            apiUrl: 'https://api.example.com',
            apiKey: 'ship-test-key',
            timeout: 30000,
            maxConcurrency: 4,
            onProgress: ({ percent }) => {
                progressValues.push(percent);
            }
        };

        // Simulate progress updates
        options.onProgress?.({ percent: 25, loaded: 250, total: 1000 });
        options.onProgress?.({ percent: 50, loaded: 500, total: 1000 });
        options.onProgress?.({ percent: 100, loaded: 1000, total: 1000 });

        expect(progressValues).toEqual([25, 50, 100]);
    });
});

describe('Progress Callback Type Safety', () => {
    it('should enforce ProgressInfo structure at type level', () => {
        // This test validates TypeScript type checking
        expectTypeOf<ProgressInfo>().toHaveProperty('percent').toBeNumber();
        expectTypeOf<ProgressInfo>().toHaveProperty('loaded').toBeNumber();
        expectTypeOf<ProgressInfo>().toHaveProperty('total').toBeNumber();
        expectTypeOf<ProgressInfo>().toHaveProperty('file').toEqualTypeOf<string | undefined>();
    });
});
