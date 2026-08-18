import { describe, it, expect } from 'vitest';
import {
  encryptJson,
  decryptJson,
  shouldEncryptConfigFilesAtRest,
} from '@electron/utils/crypto-helper';
import crypto from 'crypto';

describe('crypto-helper', () => {
  it('should return false for shouldEncryptConfigFilesAtRest temporarily', () => {
    expect(shouldEncryptConfigFilesAtRest('fakekey')).toBe(false);
    expect(shouldEncryptConfigFilesAtRest(null)).toBe(false);
  });

  it('encryptJson and decryptJson should work symmetrically', () => {
    const key = crypto.randomBytes(32).toString('hex');
    const data = {
      foo: 'bar',
      baz: 123,
    };
    
    const encrypted = encryptJson(data, key);
    expect(encrypted.startsWith('CLAWX_ENCRYPTED_v1:')).toBe(true);
    
    const decrypted = decryptJson(encrypted, key);
    expect(decrypted).toEqual(data);
  });

  it('decryptJson should fallback to plain text if no magic header', () => {
    const key = crypto.randomBytes(32).toString('hex');
    const plainJson = JSON.stringify({ plain: true });
    
    const decrypted = decryptJson(plainJson, key);
    expect(decrypted).toEqual({ plain: true });
  });

  it('decryptJson should throw if key length is invalid', () => {
    expect(() => decryptJson('data', 'shortkey')).toThrow(/Invalid config key length/);
  });
});
