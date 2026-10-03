import { describe, expect, it } from 'vitest';
import {
  DomainError,
  protectLastOwner,
  requireOrigin,
  requireRole,
  requireVersion,
  type Role,
} from '@ledger/domain/policy';
describe('authorization', () => {
  for (const role of ['owner', 'editor', 'viewer'] as Role[]) {
    for (const required of ['owner', 'editor', 'viewer'] as Role[]) {
      it(`${role} → ${required}`, () => {
        const ranks = { owner: 2, editor: 1, viewer: 0 };
        if (ranks[role] >= ranks[required]) expect(() => requireRole(role, required)).not.toThrow();
        else expect(() => requireRole(role, required)).toThrow(DomainError);
      });
    }
  }
  it('conceals nonexistent membership', () => {
    expect(() => requireRole(undefined)).toThrow(expect.objectContaining({ status: 404 }));
  });
});
describe('concurrency contract', () => {
  it('requires a current exact ETag', () => {
    expect(() => requireVersion(null, 1)).toThrow(expect.objectContaining({ status: 428 }));
    for (const value of ['*', 'v1', '"v0"', 'W/"v1"']) {
      expect(() => requireVersion(value, 1)).toThrow(expect.objectContaining({ status: 412 }));
    }
    expect(() => requireVersion('"v1"', 1)).not.toThrow();
  });
  it('protects removal and downgrade of the final owner', () => {
    for (const role of ['viewer', 'editor', null] as const) {
      expect(() => protectLastOwner('owner', role, 1)).toThrow(expect.objectContaining({ code: 'LAST_OWNER' }));
    }
    expect(() => protectLastOwner('owner', 'owner', 1)).not.toThrow();
    expect(() => protectLastOwner('owner', null, 2)).not.toThrow();
    expect(() => protectLastOwner('editor', null, 1)).not.toThrow();
  });
});
it('rejects cross-site, missing, null and deceptive Origins', () => {
  for (const origin of [
    null,
    'null',
    'https://evil.example',
    'https://ledger.example.evil.com',
    'http://ledger.example',
  ]) {
    expect(() => requireOrigin(origin, 'https://ledger.example')).toThrow(expect.objectContaining({ status: 403 }));
  }
  expect(() => requireOrigin('https://ledger.example', 'https://ledger.example/')).not.toThrow();
});
