/**
 * @file The deploy pipelines' refusals. The rules, their order and their
 * sentences are the platform's one table in `@shipstatic/types` ("Deploy
 * rules"), which the API judges a deployment by too; these only throw what it
 * says, so a refusal reads the same here as at the API, and both pipelines
 * (node and browser) refuse alike by construction.
 */
import type { DeployEntry, DeployRuleFile, PlatformLimits } from '@shipstatic/types';
import { brokenSetRule, firstBrokenRule, ShipError } from '@shipstatic/types';

/**
 * Refuse a file by the first rule it breaks.
 *
 * @param file - The file and the deployment so far (`totalSize` INCLUDES it)
 * @param limits - The platform's limits, from `/limits`
 * @throws {ShipError} The first broken rule's sentence
 */
export function validateDeployFile(file: DeployRuleFile, limits: PlatformLimits): void {
  const broken = firstBrokenRule(file, limits);
  if (broken) throw ShipError.validation(broken.sentence(file, limits));
}

/**
 * Refuse the deployment as a whole by the first set rule it breaks: no files,
 * too many, or no home page at its root.
 *
 * @param files - The files the deployment was sent, empty ones included: the
 *   rules count only what is published, and say when the home page is empty
 * @param limits - The platform's limits, from `/limits`
 * @throws {ShipError} The first broken rule's sentence
 */
export function validateDeploySet(files: readonly DeployEntry[], limits: PlatformLimits): void {
  const broken = brokenSetRule(files, limits);
  if (broken) throw ShipError.validation(broken.sentence(files, limits));
}
