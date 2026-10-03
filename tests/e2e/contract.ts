import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { expect, type APIResponse } from '@playwright/test';

type Operation = {
  operationId: string;
  responses: Record<string, { $ref?: string; content?: Record<string, { schema: unknown }> }>;
};
const spec = JSON.parse(readFileSync('packages/contracts/openapi.json', 'utf8')) as {
  paths: Record<string, Record<string, Operation>>;
  components: { responses: Record<string, { content: Record<string, { schema: unknown }> }> };
};
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addFormat('binary', true);
ajv.addSchema({ $id: 'openapi', components: spec.components });
const operations = new Map(
  Object.values(spec.paths)
    .flatMap(methods => Object.values(methods))
    .map(o => [o.operationId, o]),
);
const toContractRef = (schema: unknown) =>
  JSON.parse(JSON.stringify(schema).replaceAll('"#/components/', '"openapi#/components/'));

/** Asserts the observed status is documented for the operation and the body matches the published schema. */
export async function expectContract(response: APIResponse, operationId: string, status?: number) {
  if (status !== undefined) expect(response.status(), await response.text()).toBe(status);
  const operation = operations.get(operationId);
  expect(operation, `unknown operation ${operationId}`).toBeTruthy();
  const documented = operation!.responses[String(response.status())];
  expect(
    documented,
    `${operationId} returned undocumented ${response.status()}: ${await response.text()}`,
  ).toBeTruthy();
  expect(response.headers()['x-request-id']).toBeTruthy();
  const resolved = documented.$ref ? spec.components.responses[documented.$ref.split('/').pop()!] : documented;
  const [type, media] = Object.entries(resolved.content ?? {})[0] ?? [];
  if (!media) {
    expect(await response.text()).toBe('');
    return undefined;
  }
  expect(response.headers()['content-type']).toContain(type);
  if (!type.includes('json')) return await response.text(); // file downloads: the contract only declares a string body
  const body = await response.json();
  const validate = ajv.compile(toContractRef(media.schema) as object);
  expect(
    validate(body),
    `${operationId} ${response.status()} body violates contract: ${ajv.errorsText(validate.errors)}\n${JSON.stringify(body)}`,
  ).toBe(true);
  return body;
}
