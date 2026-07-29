/**
 * @file The `--json` acknowledgement envelope — the CLI's machine-readable
 * contract for mutations that leave no entity behind, asserted across every
 * deletion that produces one.
 *
 * **The law: text translates, JSON transmits.** A deletion answers with an
 * acknowledgement — the resource noun carrying its canonical key, plus the
 * resource's own state field where the state changed (`@shipstatic/types`,
 * `DeploymentDeleteResponse`). Prose is deliberately absent from it: "an
 * acknowledgement is data, and each surface composes its own copy". So the
 * text channel writes a sentence and the JSON channel transmits the shape,
 * and neither may substitute for the other.
 *
 * Why this file exists: the SDK began resolving these acknowledgements in
 * `11fc633` ("the SDK reaches what the API offers"), and the same commit
 * widened the branch's guard from "there is no result" to "the operation is a
 * deletion" — so it began intercepting the very acknowledgement that commit
 * had just plumbed through. `--json` emitted a `{ success: "<sentence>" }`
 * envelope: prose in the channel reserved for data, carrying a bare slug where
 * the platform names an FQDN, and dropping `status`, the one field the 202
 * exists to convey. Text mode composed its sentence from the caller's argument
 * rather than the response, so deleting one deployment by slug and by hostname
 * produced two different sentences for a single operation.
 *
 * This is the acknowledgement twin of `json-errors.test.ts`, and the same
 * reasoning applies: fence every producer, not the one that was reported.
 * The complement is structural — `OutputContext` no longer carries the
 * caller's argument at all, so a sentence composed from input is not
 * expressible.
 */

import { describe, expect, it } from 'vitest';
import { deploymentId } from '../../fixtures/builders';
import { runProgram } from './harness';

/** The seeded deployment (`tests/mocks/state.ts`), and the bare slug that also addresses it. */
const SEEDED = deploymentId();
const SEEDED_SLUG = SEEDED.split('.')[0];

/** Parse the single JSON document the CLI wrote to stdout. */
function parseAck(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim());
}

describe('--json deletion acknowledgements', () => {
  it('transmits the deployment acknowledgement verbatim, including status', async () => {
    const result = await runProgram(['--json', 'deployments', 'delete', SEEDED_SLUG]);

    expect(result.exitCode).toBe(0);
    const ack = parseAck(result.stdout);

    // The shape is the wire's, not a message envelope.
    expect(Object.keys(ack).sort()).toEqual(['deployment', 'status']);
    expect(ack).not.toHaveProperty('success');

    // Addressed by slug, acknowledged by hostname.
    expect(ack.deployment).toBe(SEEDED);

    // `status` is why this acknowledgement is not just a key: the 202 says
    // accepted, and the state is what a caller learns without a re-read.
    expect(ack.status).toBe('deleting');
  });

  it('transmits the domain acknowledgement — the key alone, a hard delete', async () => {
    await runProgram(['domains', 'set', 'www.ack-fence.com']);
    const result = await runProgram(['--json', 'domains', 'delete', 'www.ack-fence.com']);

    expect(result.exitCode).toBe(0);
    const ack = parseAck(result.stdout);

    expect(Object.keys(ack)).toEqual(['domain']);
    expect(ack.domain).toBe('www.ack-fence.com');
    expect(ack).not.toHaveProperty('success');
  });

  it('transmits the token acknowledgement — the key alone, revocation is synchronous', async () => {
    const created = await runProgram(['--json', 'tokens', 'create']);
    const id = parseAck(created.stdout).token as string;

    const result = await runProgram(['--json', 'tokens', 'delete', id]);

    expect(result.exitCode).toBe(0);
    const ack = parseAck(result.stdout);

    expect(Object.keys(ack)).toEqual(['token']);
    expect(ack.token).toBe(id);
    expect(ack).not.toHaveProperty('success');
  });

  it('never emits prose under a data key on any deletion', async () => {
    // The regression in one assertion: whatever a deletion writes to the JSON
    // channel, no value in it may be a sentence about the operation.
    await runProgram(['domains', 'set', 'www.prose-fence.com']);
    const deletions = [
      await runProgram(['--json', 'deployments', 'delete', SEEDED_SLUG]),
      await runProgram(['--json', 'domains', 'delete', 'www.prose-fence.com']),
    ];

    for (const deletion of deletions) {
      const ack = parseAck(deletion.stdout);
      expect(ack).not.toHaveProperty('success');
      for (const value of Object.values(ack)) {
        expect(String(value)).not.toContain('deleted');
      }
    }
  });
});

describe('deletion sentences are composed from the response', () => {
  it('names the same deployment identically however it was addressed', async () => {
    // One operation, two ways to address it. The sentence is a statement about
    // the deployment, so it cannot depend on which form the caller typed.
    const bySlug = await runProgram(['deployments', 'delete', SEEDED_SLUG]);
    const byHostname = await runProgram(['deployments', 'delete', SEEDED]);

    expect(bySlug.stdout).toBe(byHostname.stdout);
    expect(bySlug.stdout).toBe(
      `${SEEDED} deployment deleting — served until cleanup completes\n\n`,
    );
  });
});
