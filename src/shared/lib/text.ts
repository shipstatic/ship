/**
 * @file `pluralize`: a count beside its word.
 */

/**
 * The word in the form the count asks for, after the count: `1 file`,
 * `3 files`. `includeCount: false` answers the word alone.
 */
export function pluralize(
  count: number,
  singular: string,
  plural: string,
  includeCount: boolean = true,
): string {
  const word = count === 1 ? singular : plural;
  return includeCount ? `${count} ${word}` : word;
}
