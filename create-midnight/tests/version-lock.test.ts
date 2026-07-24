import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureTemplate = path.join(here, 'fixtures', 'template');

vi.mock('../src/version.js', () => ({
  getCliVersion: vi.fn(() => '1.2.0')
}));

// Imported after the mock so resolveTemplate/downloadTemplate see the mocked version.
const { resolveTemplate, downloadTemplate } = await import('../src/downloader.js');

/** Builds a tarball shaped like GitHub's codeload output: everything under `${repo}-${ref}/`. */
async function makeCodeloadTarball(repo: string, ref: string, sourceDir: string): Promise<Buffer> {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'create-midnight-tar-'));
  const wrappedDir = path.join(tmpRoot, `${repo}-${ref}`);
  await fsp.cp(sourceDir, wrappedDir, { recursive: true });

  const chunks: Buffer[] = [];
  const stream = tar.create({ gzip: true, cwd: tmpRoot }, [`${repo}-${ref}`]);
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  await fsp.rm(tmpRoot, { recursive: true, force: true });
  return Buffer.concat(chunks);
}

describe('resolveTemplate (version locking)', () => {
  it('derives the template ref from the CLI version by default', () => {
    const source = resolveTemplate('starter');
    expect(source.ref).toBe('v1.2.0');
    expect(source.refSource).toBe('version-lock');
    expect(source.owner).toBe('wolf1276');
    expect(source.repo).toBe('Midnight-starter-template');
  });

  it('uses the --ref override instead of the version-locked tag when provided', () => {
    const source = resolveTemplate('starter', 'main');
    expect(source.ref).toBe('main');
    expect(source.refSource).toBe('override');
  });

  it('supports arbitrary override refs (branch, tag, commit-ish)', () => {
    expect(resolveTemplate('starter', 'develop').ref).toBe('develop');
    expect(resolveTemplate('starter', 'feature/foo').ref).toBe('feature/foo');
    expect(resolveTemplate('starter', 'v1.1.0').ref).toBe('v1.1.0');
  });

  it('rejects an unknown template name regardless of ref', () => {
    expect(() => resolveTemplate('nonexistent')).toThrow(/Unknown template/);
  });
});

describe('downloadTemplate (version locking, mocked network)', () => {
  let destDir: string;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    destDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'create-midnight-dl-'));
  });

  afterEach(async () => {
    await fsp.rm(destDir, { recursive: true, force: true });
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('downloads the tag matching the CLI version and requests exactly that ref', async () => {
    const source = resolveTemplate('starter'); // ref = v1.2.0 (mocked CLI version)
    const tarball = await makeCodeloadTarball(source.repo, source.ref, fixtureTemplate);

    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(
        `https://codeload.github.com/${source.owner}/${source.repo}/tar.gz/${source.ref}`
      );
      return { ok: true, status: 200, body: Readable.from(tarball) } as unknown as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await downloadTemplate(source, destDir);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const pkg = JSON.parse(await fsp.readFile(path.join(destDir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('midnight-starter-template');
  });

  it('throws a friendly "compatible template version not found" error on a missing version-locked tag (404) without falling back to main', async () => {
    const source = resolveTemplate('starter'); // ref = v1.2.0, does not exist upstream
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      body: null
    })) as unknown as typeof fetch;

    await expect(downloadTemplate(source, destDir)).rejects.toMatchObject({
      code: 'TEMPLATE_VERSION_NOT_FOUND',
      message: expect.stringContaining('Compatible template version not found')
    });
    await expect(downloadTemplate(source, destDir)).rejects.toMatchObject({
      message: expect.stringContaining('Expected:   v1.2.0')
    });
    await expect(downloadTemplate(source, destDir)).rejects.toMatchObject({
      message: expect.stringContaining('Repository: wolf1276/Midnight-starter-template')
    });
  });

  it('does NOT use the version-locked "not found" message for a missing --ref override (no silent main fallback, but different wording)', async () => {
    const source = resolveTemplate('starter', 'some-nonexistent-branch');
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      body: null
    })) as unknown as typeof fetch;

    await expect(downloadTemplate(source, destDir)).rejects.toMatchObject({
      code: 'NETWORK_FAILURE'
    });
  });

  it('a --ref override successfully downloads from the given ref', async () => {
    const source = resolveTemplate('starter', 'main');
    const tarball = await makeCodeloadTarball(source.repo, source.ref, fixtureTemplate);
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: Readable.from(tarball)
    })) as unknown as typeof fetch;

    await downloadTemplate(source, destDir);
    expect(await fsp.readdir(destDir)).toContain('package.json');
  });
});
