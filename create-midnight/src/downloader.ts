import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import { CLIError } from './errors.js';
import { verbose } from './logger.js';

export interface TemplateSource {
  name: string;
  owner: string;
  repo: string;
  ref: string;
  /** Subdirectory within the repo that contains this template, if not the repo root. */
  subdir?: string;
}

/**
 * Registry of available templates. New templates can be added here (or backed by their
 * own repos) without changing any download/scaffold logic.
 */
const TEMPLATE_REGISTRY: Record<string, Omit<TemplateSource, 'name'>> = {
  starter: {
    owner: 'wolf1276',
    repo: 'Midnight-starter-template',
    ref: 'main'
  }
  // Future templates, e.g.:
  // contract: { owner: 'wolf1276', repo: 'Midnight-starter-template', ref: 'main', subdir: 'contracts' },
  // dashboard: { owner: 'wolf1276', repo: 'midnight-dashboard-template', ref: 'main' },
};

export function resolveTemplate(templateName: string): TemplateSource {
  const entry = TEMPLATE_REGISTRY[templateName];
  if (!entry) {
    const available = Object.keys(TEMPLATE_REGISTRY).join(', ');
    throw new CLIError(
      'UNKNOWN',
      `Unknown template "${templateName}". Available templates: ${available}.`
    );
  }
  return { name: templateName, ...entry };
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
    throw new CLIError(
      'NETWORK_FAILURE',
      `Failed to download template (HTTP ${response.status} ${response.statusText}).`
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
