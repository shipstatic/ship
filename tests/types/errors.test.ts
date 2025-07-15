import { describe, it, expect } from 'vitest';
import { ShipError, ShipErrorType } from '@shipstatic/types';

describe('Ship Error System', () => {
  describe('Base ShipError', () => {
    it('should be instantiable with direct constructor', () => {
      const err = new ShipError(ShipErrorType.Business, 'Test message', 400);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ShipError);
      expect(err.name).toBe('ShipError');
      expect(err.message).toBe('Test message');
      expect(err.type).toBe(ShipErrorType.Business);
      expect(err.status).toBe(400);
    });
    
    it('should handle validation errors', () => {
      const err = ShipError.validation('Validation failed', { field: 'test' });
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ShipError);
      expect(err.type).toBe(ShipErrorType.Validation);
      expect(err.message).toBe('Validation failed');
      expect(err.status).toBe(400);
      expect(err.details).toEqual({ field: 'test' });
    });
  });

  describe('API Errors', () => {
    it('should create API error and store details', () => {
      const err = ShipError.api('API issue', 500, 'CODE123', { detail: 'some detail' });
      expect(err).toBeInstanceOf(ShipError);
      expect(err.name).toBe('ShipError');
      expect(err.message).toBe('API issue');
      expect(err.status).toBe(500);
      expect(err.code).toBe('CODE123');
      expect(err.details).toEqual({ code: 'CODE123', data: { detail: 'some detail' } });
      expect(err.type).toBe(ShipErrorType.Api);
    });
  });

  describe('Network Errors', () => {
    it('should create network error and store cause', () => {
      const cause = new Error('Network down');
      const err = ShipError.network('Connection failed', cause);
      expect(err).toBeInstanceOf(ShipError);
      expect(err.name).toBe('ShipError');
      expect(err.message).toBe('Connection failed');
      expect(err.details?.cause).toBe(cause);
      expect(err.type).toBe(ShipErrorType.Network);
      expect(err.status).toBe(undefined);
    });
  });

  describe('Cancelled Errors', () => {
    it('should create cancelled error with custom message', () => {
      const err = ShipError.cancelled('Operation was cancelled');
      expect(err).toBeInstanceOf(ShipError);
      expect(err.name).toBe('ShipError');
      expect(err.message).toBe('Operation was cancelled');
      expect(err.type).toBe(ShipErrorType.Cancelled);
      expect(err.status).toBe(undefined);
    });
    
    it('should create business logic error', () => {
      const err = ShipError.business('Business rule violated', 422);
      expect(err).toBeInstanceOf(ShipError);
      expect(err.message).toBe('Business rule violated');
      expect(err.type).toBe(ShipErrorType.Business);
      expect(err.status).toBe(422);
    });
  });

  describe('Client Errors', () => {
    it('should create client error', () => {
      const err = ShipError.business('Client side problem');
      expect(err).toBeInstanceOf(ShipError);
      expect(err.name).toBe('ShipError');
      expect(err.message).toBe('Client side problem');
      expect(err.type).toBe(ShipErrorType.Business); // client() is an alias for business()
      expect(err.status).toBe(400);
    });
  });

  describe('File Errors', () => {
    it('should create file error and store filePath', () => {
      const err = ShipError.file('File not found', '/path/to/file');
      expect(err).toBeInstanceOf(ShipError);
      expect(err.name).toBe('ShipError');
      expect(err.message).toBe('File not found');
      expect(err.filePath).toBe('/path/to/file');
      expect(err.type).toBe(ShipErrorType.File);
      expect(err.status).toBe(undefined);
    });
  });

  describe('Config Errors', () => {
    it('should create invalid config error', () => {
      const err = ShipError.config('Config is bad');
      expect(err).toBeInstanceOf(ShipError);
      expect(err.name).toBe('ShipError');
      expect(err.message).toBe('Config is bad');
      expect(err.type).toBe(ShipErrorType.Config);
      expect(err.status).toBe(undefined);
    });
  });
  
  describe('Error Conversion', () => {
    it('should convert to and from response format', () => {
      const original = ShipError.validation('Invalid input', { field: 'email' });
      const response = original.toResponse();
      
      expect(response.error).toBe(ShipErrorType.Validation);
      expect(response.message).toBe('Invalid input');
      expect(response.status).toBe(400);
      expect(response.details).toEqual({ field: 'email' });
      
      const restored = ShipError.fromResponse(response);
      expect(restored.type).toBe(original.type);
      expect(restored.message).toBe(original.message);
      expect(restored.status).toBe(original.status);
      expect(restored.details).toEqual(original.details);
    });
  });
  
  describe('Helper Methods', () => {
    it('should provide helper getters for common properties', () => {
      const fileError = ShipError.file('File error', '/test/path');
      expect(fileError.filePath).toBe('/test/path');
      
      const apiError = ShipError.api('API error', 500, 'ERR_CODE');
      expect(apiError.code).toBe('ERR_CODE');
    });
  });
});