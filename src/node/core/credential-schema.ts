/**
 * @file The fields a credential source may hold, and the rule for each.
 *
 * Both the SDK's env reader (`config.ts`) and the CLI's file loader
 * (`../cli/shiprc.ts`) read these, so a rule that is tightened or relaxed
 * moves for both. The `token` field accepts any platform token: its format
 * is judged once, by the `Ship` constructor, whatever the source.
 */

import { z } from 'zod';

export const CREDENTIAL_FIELDS = {
  apiUrl: z.string().url().optional(),
  token: z.string().min(1).optional(),
};
