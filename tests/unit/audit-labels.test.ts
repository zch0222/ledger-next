import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, auditLabel } from '@/lib/audit-labels';

// Every action the domain writes to the audit trail must have a Chinese name on the settings page ("最近操作").
// Actions are found where they are written: audit(...) calls, `action = '...'` choices and writePlan(..., '<action>').
const DOMAIN = join(process.cwd(), 'packages/domain/src');
function writtenActions() {
  const found = new Set<string>();
  for (const file of readdirSync(DOMAIN).filter(f => f.endsWith('.ts'))) {
    for (const line of readFileSync(join(DOMAIN, file), 'utf8').split('\n')) {
      if (!/audit\(|action = |writePlan\(/.test(line)) continue;
      for (const [, action] of line.matchAll(/'([a-z_]+\.[a-z_]+)'/g)) found.add(action);
    }
  }
  // `approval.${input.decision}`: the decision enum is approved | rejected (contracts/platform.ts).
  found.add('approval.approved');
  found.add('approval.rejected');
  return [...found].sort();
}

describe('audit trail labels', () => {
  it('names every action the domain records', () => {
    const actions = writtenActions();
    expect(actions.length).toBeGreaterThan(30);
    expect(actions.filter(a => !AUDIT_ACTIONS[a])).toEqual([]);
  });
  it('falls back to the code for an unknown action', () => {
    expect(auditLabel('category.created')).toBe('新建分类');
    expect(auditLabel('something.new')).toBe('something.new');
  });
});
