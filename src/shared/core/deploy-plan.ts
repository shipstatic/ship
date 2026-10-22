/**
 * @file How a deploy is split across requests: arithmetic, never measurement.
 *
 * One request carries at most `DEPLOY_REQUEST_CONSTRAINTS.MAX_BYTES`, as
 * `Content-Length` counts it, framing included. Everything that fits is one
 * request. Everything that does not is a bare declaration (the manifest, the
 * options, the root `ship.json`, which the API compiles at the declaration,
 * and the root `index.html` when the declaration asks the single-page
 * question of it) followed by batches of whole files, packed in order under
 * the same ceiling.
 *
 * The count is a ceiling on what any runtime's `FormData` emits, so the
 * server's count never exceeds it, and a 413 on a request planned here means
 * the arithmetic is wrong. Each part is counted as its bytes, plus its name as
 * the body will carry it, plus `PART_OVERHEAD`, which the multipart standard
 * bounds (a boundary is at most 70 characters; the part's two header lines
 * and its line breaks are the rest). One more `PART_OVERHEAD` covers the
 * body's closing delimiter, which no part owns. Values are counted
 * SERIALIZED, because the encoding is specified, not measured: a text field's
 * line breaks travel as CRLF, and a filename's quote, CR and LF travel as
 * three-byte escapes (the HTML standard's multipart/form-data rules). A
 * deploy path never needs the escapes, since the path rules refuse those
 * characters; a build source's name can, and is counted as sent.
 */

import {
  DEPLOY_FIELDS,
  DEPLOY_REQUEST_CONSTRAINTS,
  DEPLOYMENT_CONFIG_FILENAME,
  formatFileSize,
  ShipError,
} from '@shipstatic/types';
import type { StaticFile } from '../types.js';
import type { DeployField } from './deploy-body.js';

const { MAX_BYTES, PART_OVERHEAD } = DEPLOY_REQUEST_CONSTRAINTS;

const encoder = new TextEncoder();

/** A text field's value as the body carries it: UTF-8, line breaks as CRLF. */
export function serializedValueBytes(value: string): number {
  return encoder.encode(value.replace(/\r\n|\r|\n/g, '\r\n')).length;
}

/** A filename as the body carries it: UTF-8, its quote, CR and LF escaped. */
export function serializedNameBytes(name: string): number {
  return encoder.encode(name.replace(/"/g, '%22').replace(/\r/g, '%0D').replace(/\n/g, '%0A'))
    .length;
}

/** What one file adds to a body: its bytes, its name as sent, its framing. */
function fileBytes(file: StaticFile): number {
  return file.size + serializedNameBytes(file.path) + PART_OVERHEAD;
}

/**
 * The most a body of these files and fields can be: every part, and the
 * closing delimiter. A ceiling on what any runtime's `FormData` emits for it.
 */
export function bodyBytes(files: StaticFile[], fields: DeployField[]): number {
  const parts = fields.reduce(
    (sum, [, value]) => sum + serializedValueBytes(value) + PART_OVERHEAD,
    files.reduce((sum, file) => sum + fileBytes(file), 0),
  );
  return parts + PART_OVERHEAD;
}

/** How a deploy is sent: the files its declaration carries, then each fill's. */
export interface DeployPlan {
  declaration: StaticFile[];
  fills: StaticFile[][];
}

/**
 * What a project sent for building is told when it does not fit one
 * request. A build reads the whole project in the request that asks for it,
 * so it is never split; the server cannot tell a build from a site before it
 * parses the body, which is why this client says it first. It names the way
 * out: a built site has no such ceiling, since it is sent in as many
 * requests as it needs.
 */
export const BUILD_TOO_LARGE = `We can build projects up to ${formatFileSize(MAX_BYTES)}. Build this one on your computer and upload the built folder instead.`;

/** The page the single-page question is asked of. */
const INDEX_PATH = 'index.html';

/**
 * Plan a deploy: one request when everything fits, otherwise a bare
 * declaration and as many fills as the files need.
 *
 * What the declaration asks decides what it must carry, so the plan reads it
 * from the fields rather than from a second statement of the same options. A
 * build or a prerender reads every file in the request that asks for it, so
 * it is never split. Otherwise the bare declaration carries the root
 * `ship.json`, which the API compiles there, and, when it asks the
 * single-page question, the root `index.html` the question is asked of.
 */
export function planDeploy(files: StaticFile[], fields: DeployField[]): DeployPlan {
  const asks = (name: string) => fields.some(([field]) => field === name);
  if (bodyBytes(files, fields) <= MAX_BYTES) return { declaration: files, fills: [] };
  if (asks(DEPLOY_FIELDS.BUILD) || asks(DEPLOY_FIELDS.PRERENDER)) {
    throw ShipError.validation(BUILD_TOO_LARGE);
  }

  const spa = asks(DEPLOY_FIELDS.SPA);
  const declared = (file: StaticFile) =>
    file.path === DEPLOYMENT_CONFIG_FILENAME || (spa && file.path === INDEX_PATH);
  const declaration = files.filter(declared);
  const fills: StaticFile[][] = [];
  let batch: StaticFile[] = [];
  let size = PART_OVERHEAD;
  for (const file of files) {
    if (declared(file)) continue;
    const bytes = fileBytes(file);
    if (batch.length > 0 && size + bytes > MAX_BYTES) {
      fills.push(batch);
      batch = [];
      size = PART_OVERHEAD;
    }
    batch.push(file);
    size += bytes;
  }
  if (batch.length > 0) fills.push(batch);
  return { declaration, fills };
}
