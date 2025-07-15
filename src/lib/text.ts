/**
 * Utility functions for string manipulation.
 */

/**
 * Simple utility to pluralize a word based on a count.
 * @param count The number to determine pluralization.
 * @param singular The singular form of the word.
 * @param plural The plural form of the word.
 * @param includeCount Whether to include the count in the returned string. Defaults to true.
 * @returns A string with the count and the correctly pluralized word.
 */
export function pluralize(
  count: number,
  singular: string,
  plural: string,
  includeCount: boolean = true
): string {
  const word = count === 1 ? singular : plural;
  return includeCount ? `${count} ${word}` : word;
}
