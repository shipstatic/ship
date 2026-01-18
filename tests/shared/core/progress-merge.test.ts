/**
 * @file Tests for onProgress callback merging in config
 * 
 * Validates that onProgress is correctly merged from client defaults to deployment options.
 */
import { describe, it, expect } from 'vitest';
import { mergeDeployOptions } from '../../../src/shared/core/config';
import type { ProgressInfo, DeploymentOptions, ShipClientOptions } from '../../../src/shared/types';

describe('mergeDeployOptions - onProgress callback', () => {
    it('should merge onProgress from client defaults when not in options', () => {
        const clientCallback = (_info: ProgressInfo) => { };

        const clientDefaults: ShipClientOptions = {
            apiUrl: 'https://api.example.com',
            onProgress: clientCallback
        };

        const options: DeploymentOptions = {};

        const merged = mergeDeployOptions(options, clientDefaults);

        expect(merged.onProgress).toBe(clientCallback);
    });

    it('should NOT override options onProgress with client default', () => {
        const clientCallback = (_info: ProgressInfo) => { };
        const optionsCallback = (_info: ProgressInfo) => { };

        const clientDefaults: ShipClientOptions = {
            onProgress: clientCallback
        };

        const options: DeploymentOptions = {
            onProgress: optionsCallback
        };

        const merged = mergeDeployOptions(options, clientDefaults);

        expect(merged.onProgress).toBe(optionsCallback);
        expect(merged.onProgress).not.toBe(clientCallback);
    });

    it('should preserve undefined when neither has onProgress', () => {
        const clientDefaults: ShipClientOptions = {
            apiUrl: 'https://api.example.com'
        };

        const options: DeploymentOptions = {};

        const merged = mergeDeployOptions(options, clientDefaults);

        expect(merged.onProgress).toBeUndefined();
    });

    it('should merge onProgress alongside other options', () => {
        const progressCallback = ({ percent }: ProgressInfo) => {
            console.log(`${percent}%`);
        };

        const clientDefaults: ShipClientOptions = {
            apiUrl: 'https://api.example.com',
            timeout: 30000,
            onProgress: progressCallback
        };

        const options: DeploymentOptions = {
            tags: ['production'],
            subdomain: 'my-app'
        };

        const merged = mergeDeployOptions(options, clientDefaults);

        expect(merged.onProgress).toBe(progressCallback);
        expect(merged.tags).toEqual(['production']);
        expect(merged.subdomain).toBe('my-app');
        expect(merged.timeout).toBe(30000);
    });
});

describe('mergeDeployOptions - caller option', () => {
    it('should merge caller from client defaults when not in options', () => {
        const clientDefaults: ShipClientOptions = {
            apiUrl: 'https://api.example.com',
            caller: 'my-ci-system'
        };

        const options: DeploymentOptions = {};

        const merged = mergeDeployOptions(options, clientDefaults);

        expect(merged.caller).toBe('my-ci-system');
    });

    it('should NOT override options caller with client default', () => {
        const clientDefaults: ShipClientOptions = {
            caller: 'client-default-caller'
        };

        const options: DeploymentOptions = {
            caller: 'per-deploy-caller'
        };

        const merged = mergeDeployOptions(options, clientDefaults);

        expect(merged.caller).toBe('per-deploy-caller');
    });

    it('should preserve undefined when neither has caller', () => {
        const clientDefaults: ShipClientOptions = {
            apiUrl: 'https://api.example.com'
        };

        const options: DeploymentOptions = {};

        const merged = mergeDeployOptions(options, clientDefaults);

        expect(merged.caller).toBeUndefined();
    });

    it('should merge caller alongside other options', () => {
        const clientDefaults: ShipClientOptions = {
            apiUrl: 'https://api.example.com',
            timeout: 30000,
            caller: 'github-actions'
        };

        const options: DeploymentOptions = {
            tags: ['production'],
            via: 'cli'
        };

        const merged = mergeDeployOptions(options, clientDefaults);

        expect(merged.caller).toBe('github-actions');
        expect(merged.tags).toEqual(['production']);
        expect(merged.via).toBe('cli');
        expect(merged.timeout).toBe(30000);
    });
});
