import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import { CLIError } from './errors.js';
import { verbose } from './logger.js';
import { getCliVersion } from './version.js';

export type RefSource = 'version-lock' | 'override';

export interface TemplateSource {
  name: string;
  owner: string;
  repo: string;
  ref: string;
  refSource: RefSource;
  /** Subdirectory within the repo that contains this template, if not the repo root. */
  subdir?: string;
}

type TemplateRegistryEntry = Pick<TemplateSource, 'owner' | 'repo' | 'subdir'>;

/**
 * Registry of available templates. New templates can be added here (or backed by their
 * own repos) without changing any download/scaffold logic.
 *
 * No `ref` is stored here: by default every template is scaffolded from the Git tag
 * matching this CLI's own version (e.g. create-midnight@1.2.0 -> tag v1.2.0), so that
 * published CLI versions always produce a deterministic, reproducible result. Use
 * `--ref` to scaffold from a different branch/tag/commit (development only).
 */
const TEMPLATE_REGISTRY: Record<string, TemplateRegistryEntry> = {
  starter: {
    owner: 'wolf1276',
    repo: 'Midnight-starter-template'
  }
  // Future templates, e.g.:
  // contract: { owner: 'wolf1276', repo: 'Midnight-starter-template', subdir: 'contracts' },
  // dashboard: { owner: 'wolf1276', repo: 'midnight-dashboard-template' },
};

/**
 * Resolves which template + Git ref to scaffold from.
 *
 * By default the ref is version-locked: it's derived from the CLI's own version
 * (`v${cliVersion}`), so create-midnight@1.2.0 always scaffolds
 * Midnight-starter-template@v1.2.0, never whatever happens to be on `main`.
 *
 * `refOverride` (the `--ref` flag) bypasses version locking entirely and is intended
 * for development use only (tracking `main`, a feature branch, an unreleased tag, etc.).
 */
export function resolveTemplate(templateName: string, refOverride?: string): TemplateSource {
  const entry = TEMPLATE_REGISTRY[templateName];
  if (!entry) {
    const available = Object.keys(TEMPLATE_REGISTRY).join(', ');
    throw new CLIError(
      'UNKNOWN',
      `Unknown template "${templateName}". Available templates: ${available}.`
    );
  }

  if (refOverride) {
    return { name: templateName, ...entry, ref: refOverride, refSource: 'override' };
  }

  return { name: templateName, ...entry, ref: `v${getCliVersion()}`, refSource: 'version-lock' };
}

/**
 * Downloads a template into destDir. Supports a local override via
 * CREATE_MIDNIGHT_LOCAL_TEMPLATE (a path on disk) for offline development/testing.
 */
export async function downloadTemplate(source: TemplateSource, destDir: string): Promise<void> {
  const localOverride = process.env.CREATE_MIDNIGHT_LOCAL_TEMPLATE;
  if (localOverride) {
    verbose(`Using local template override: ${localOverride}`);
    await copyLocalTemplate(localOverride, destDir);
    return;
  }

  await fsp.mkdir(destDir, { recursive: true });

  const url = `https://codeload.github.com/${source.owner}/${source.repo}/tar.gz/${source.ref}`;
  verbose(`Downloading template from ${url}`);

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new CLIError('NETWORK_FAILURE', 'Failed to reach GitHub to download the template.', error);
  }

  if (!response.ok || !response.body) {
    if (response.status === 404 && source.refSource === 'version-lock') {
      throw new CLIError(
        'TEMPLATE_VERSION_NOT_FOUND',
        `Compatible template version not found.\n\n` +
          `  Expected:   ${source.ref}\n` +
          `  Repository: ${source.owner}/${source.repo}`
      );
    }
    throw new CLIError(
      'NETWORK_FAILURE',
      `Failed to download template (HTTP ${response.status} ${response.statusText}) for ref "${source.ref}".`
    );
  }

  const stripPrefix = source.subdir ? `${source.repo}-${source.ref}/${source.subdir}` : undefined;

  try {
    await pipeline(
      response.body as unknown as NodeJS.ReadableStream,
      tar.extract({
        cwd: destDir,
        strip: source.subdir ? stripPrefix!.split('/').length : 1,
        filter: (entryPath) => (stripPrefix ? entryPath.startsWith(stripPrefix) : true)
      })
    );
  } catch (error) {
    throw new CLIError('NETWORK_FAILURE', 'Failed to extract the downloaded template archive.', error);
  }

  const entries = await fsp.readdir(destDir);
  if (entries.length === 0) {
    throw new CLIError(
      'NETWORK_FAILURE',
      `Template extracted but produced no files. The "${source.name}" template may be misconfigured.`
    );
  }
}

async function copyLocalTemplate(sourceDir: string, destDir: string): Promise<void> {
  if (!fs.existsSync(sourceDir)) {
    throw new CLIError('UNKNOWN', `Local template override path does not exist: ${sourceDir}`);
  }
  await fsp.mkdir(destDir, { recursive: true });
  await fsp.cp(sourceDir, destDir, {
    recursive: true,
    filter: (src) => !/(^|\/)(\.git|node_modules|dist|\.next)(\/|$)/.test(src)
  });
}
