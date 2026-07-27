/**
 * @file Single source of truth for ambient-config field validation.
 *
 * Both the SDK env reader (`node/core/config.ts`) and the CLI file loader
 * (`node/cli/shiprc.ts`) import these — if we tighten or relax a rule,
 * both layers update together. The `token` field accepts any platform token;
 * strict prefix-classified format validation happens once, at the `Ship`
 * constructor boundary, for every source uniformly.
 *
 * Lives in its own file because it's a pure data constant: tests that mock
 * runtime config behavior shouldn't have to forward this through their mocks.
 */

import { z } from 'zod';

export const CREDENTIAL_FIELDS = {
  apiUrl: z.string().url().optional(),
  token: z.string().min(1).optional(),
};
