/**
 * @file The deploy request bodies: one builder, both platforms.
 *
 * A deploy is declared, then filled: the declaration carries the manifest,
 * the deployment's options and any of its files, and each fill carries more
 * of its files (`POST /deployments/:deployment/files`). A deployment that fits
 * one request is declared with every file, which is the whole deploy.
 *
 * Every body is a native `FormData`: `fetch` sets the boundary and the
 * `Content-Type` itself, which is why nothing here composes headers. The
 * declaration's text fields are stated once, in order, by
 * {@link deployFields}, and both the body and the planner read that list
 * (`deploy-plan.ts`), so what is counted is what is sent.
 */

import {
  DEPLOY_FIELDS,
  type DeploymentViaType,
  type ManifestEntry,
  type StaticFile,
} from '@shipstatic/types';

/** One text field of a deploy body: its name and its value, as sent. */
export type DeployField = readonly [name: string, value: string];

/**
 * What a declaration says beside its files: each option a field carries,
 * already through its own check (`validateLabels`, `validatePassword`,
 * `validateTtl`, the build settings').
 */
export interface DeployDeclaration {
  labels?: string[] | undefined;
  /** Which client is deploying. */
  via?: DeploymentViaType | undefined;
  /** The plaintext password, trimmed as the rule that judged it trims it. */
  password?: string | undefined;
  /** The requested lifetime in SECONDS. The API stamps the expiry against its own clock. */
  ttl?: number | undefined;
  /** Whether the platform is asked the single-page question (`spa`). */
  spa?: boolean | undefined;
  /** @internal The server builds the project. */
  build?: boolean | undefined;
  /** @internal The server prerenders the site. */
  prerender?: boolean | undefined;
  /** @internal The command a build runs. */
  buildCommand?: string | undefined;
  /** @internal The folder a build's site lands in. */
  outputDir?: string | undefined;
  /** @internal The proof a first-party uploader sends for a person without a credential. */
  captcha?: string | undefined;
}

/**
 * The deployment's manifest: every file it holds, by path, size and MD5. The
 * API checks each arriving file against its entry and storage checks its
 * bytes against the digest, so a deploy is verified whatever count of
 * requests carries it.
 */
export function deployManifest(files: StaticFile[]): ManifestEntry[] {
  return files.map(({ path, size, md5 }) => ({ path, size, md5 }));
}

/**
 * The declaration's text fields, in the order the body carries them: the
 * manifest, then each option that was set. A flag is sent only as `true`,
 * since absence is the API's "no". The build settings are sent whenever they
 * are set: whether they may ride without `build` is the API's to say.
 */
export function deployFields(
  manifest: ManifestEntry[],
  declaration: DeployDeclaration = {},
): DeployField[] {
  const { labels, via, password, ttl, spa, build, prerender, buildCommand, outputDir, captcha } =
    declaration;
  const fields: DeployField[] = [[DEPLOY_FIELDS.MANIFEST, JSON.stringify(manifest)]];
  if (labels?.length) fields.push([DEPLOY_FIELDS.LABELS, JSON.stringify(labels)]);
  if (via) fields.push([DEPLOY_FIELDS.VIA, via]);
  if (password) fields.push([DEPLOY_FIELDS.PASSWORD, password]);
  if (ttl !== undefined) fields.push([DEPLOY_FIELDS.TTL, String(ttl)]);
  if (spa) fields.push([DEPLOY_FIELDS.SPA, 'true']);
  if (build) fields.push([DEPLOY_FIELDS.BUILD, 'true']);
  if (prerender) fields.push([DEPLOY_FIELDS.PRERENDER, 'true']);
  if (buildCommand) fields.push([DEPLOY_FIELDS.BUILD_COMMAND, buildCommand]);
  if (outputDir) fields.push([DEPLOY_FIELDS.OUTPUT_DIR, outputDir]);
  if (captcha) fields.push([DEPLOY_FIELDS.CAPTCHA, captcha]);
  return fields;
}

/**
 * What every file part says its type is. The API reads a file's type from its
 * path and never from the part, so a browser's guess about a `File` is not
 * sent.
 */
const PART_TYPE = 'application/octet-stream';

/**
 * Append each file as a `files[]` part named by its deploy path, which the
 * API reads back as the part's filename.
 *
 * The name is given to `append`, never to a `File` built around the content:
 * Bun names a `File` built around a file on disk by its disk path.
 */
function appendFiles(body: FormData, files: StaticFile[]): void {
  for (const { content, path } of files) {
    body.append(DEPLOY_FIELDS.FILES, content.slice(0, content.size, PART_TYPE), path);
  }
}

/** The declaration: the files it carries, then its text fields. */
export function createDeployBody(files: StaticFile[], fields: DeployField[]): FormData {
  const body = new FormData();
  appendFiles(body, files);
  for (const [name, value] of fields) body.append(name, value);
  return body;
}

/** A fill: files and nothing else, since the declaration stated the rest. */
export function createFillBody(files: StaticFile[]): FormData {
  const body = new FormData();
  appendFiles(body, files);
  return body;
}
