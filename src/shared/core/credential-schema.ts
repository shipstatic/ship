/**
 * @file Single source of truth for credential field validation.
 *
 * Both the SDK env reader (`node/core/config.ts`) and the CLI file loader
 * (`node/cli/shiprc.ts`) import these — if we tighten or relax a rule
 * (e.g. enforcing the `ship-` prefix), both layers update together.
 *
 * Lives in its own file (not alongside `resolveConfig`) because it's a pure
 * data constant: tests that mock the runtime behavior of `resolveConfig` /
 * `mergeDeployOptions` shouldn't have to forward this through their mocks.
 */

import { z } from 'zod';

export const CREDENTIAL_FIELDS = {
  apiUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  deployToken: z.string().min(1).optional(),
};
