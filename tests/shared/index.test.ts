import { describe, it, expect } from 'vitest';
// This test file is for src/index.ts itself, focusing on re-exports.

describe('Main SDK Index (src/index.ts)', () => {
  it('should have Ship class available', async () => {
    const { __setTestEnvironment } = await import('../../src/shared/lib/env');
    await __setTestEnvironment('node');
    const Exports = await import('../../src/index');
    expect(Exports.Ship).toBeDefined();
    expect(typeof Exports.Ship).toBe('function');
  });

  it('should re-export ShipClient type from types/index', async () => {
    // This checks that ShipClient is part of the exported module signature.
    // Actual type checking is done by TypeScript during compilation.
    // We expect 'ShipClient' to be undefined at runtime as it's a type.
    const TypesExports = await import('../../src/shared/types');
    expect(typeof TypesExports.ShipClient).toBe('undefined');
  });

  it('should re-export UploadInput and UploadOptions types from core/client', async () => {
    // No runtime check possible for type re-exports, this is mostly a structural reminder
    const TypesExports = await import('../../src/shared/types');
    expect(typeof TypesExports.UploadInput).toBe('undefined');
    expect(typeof TypesExports.UploadOptions).toBe('undefined');
  });

  it('should re-export __setTestEnvironment from utils/env', async () => {
    const Exports = await import('../../src/shared/lib/env');
    expect(Exports.__setTestEnvironment).toBeDefined();
    expect(Exports.__setTestEnvironment).toBe((await import('../../src/shared/lib/env')).__setTestEnvironment);
  });

  it('should re-export all common types from types/index', async () => {
    const TypesExports = await import('../../src/shared/types');
    expect(typeof TypesExports.StaticFile).toBe('undefined');
    expect(typeof TypesExports.ShipClientOptions).toBe('undefined');
    expect(typeof TypesExports.ApiUploadOptions).toBe('undefined');
    expect(typeof TypesExports.ApiUploadResponse).toBe('undefined');
    expect(typeof TypesExports.PingResponse).toBe('undefined');
    expect(typeof TypesExports.ApiUploadErrorResponse).toBe('undefined');
    expect(typeof TypesExports.ApiUploadSuccessResponse).toBe('undefined');
    expect(typeof TypesExports.ProgressStats).toBe('undefined');
  });

  it('should re-export unified ShipError class and ErrorType enum from @shipstatic/types', async () => {
    const ErrorExports = await import('@shipstatic/types');
    const Exports = await import('../../src/index');
    // Check that the unified ShipError class is exported
    expect(Exports.ShipError).toBe(ErrorExports.ShipError);
    expect(typeof Exports.ShipError).toBe('function'); // ShipError is a class (function)

    // Check that the ErrorType enum is exported
    expect(Exports.ErrorType).toBe(ErrorExports.ErrorType);
    expect(typeof Exports.ErrorType).toBe('object'); // Enum is an object

    // Verify the enum has all the expected error types (from shared types)
    expect(Exports.ErrorType.Validation).toBe('validation_failed');
    expect(Exports.ErrorType.NotFound).toBe('not_found');
    expect(Exports.ErrorType.RateLimit).toBe('rate_limit_exceeded');
    expect(Exports.ErrorType.Authentication).toBe('authentication_failed');
    expect(Exports.ErrorType.Business).toBe('business_logic_error');
    expect(Exports.ErrorType.Api).toBe('internal_server_error');
    expect(Exports.ErrorType.Network).toBe('network_error');
    expect(Exports.ErrorType.Cancelled).toBe('operation_cancelled');
    expect(Exports.ErrorType.File).toBe('file_error');
    expect(Exports.ErrorType.Config).toBe('config_error');
  });

  it('should have Ship as the default export', async () => {
    const { __setTestEnvironment } = await import('../../src/shared/lib/env');
    await __setTestEnvironment('node');
    const Exports = await import('../../src/index');
    expect(Exports.default).toBeDefined();
    expect(Exports.default).toBe(Exports.Ship);
    expect(typeof Exports.default).toBe('function');
  });
});

