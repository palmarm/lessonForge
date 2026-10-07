import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  backendEnvironmentFile,
  loadBackendEnvironment,
} from './environment.js';

describe('backend environment loading', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'lessonforge-config-'));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.LESSONFORGE_TEST_FILE_VALUE;
    rmSync(directory, { recursive: true, force: true });
  });

  it('resolves backend/.env independently of the working directory', () => {
    expect(backendEnvironmentFile).toEqual(
      new URL('../../.env', import.meta.url),
    );
  });

  it('loads file values and preserves existing shell values', () => {
    const file = pathToFileURL(join(directory, 'environment.fixture'));
    writeFileSync(
      file,
      'LESSONFORGE_TEST_SHELL_VALUE=file\nLESSONFORGE_TEST_FILE_VALUE=loaded\n',
    );
    vi.stubEnv('LESSONFORGE_TEST_SHELL_VALUE', 'shell');
    loadBackendEnvironment(file);
    expect(process.env.LESSONFORGE_TEST_SHELL_VALUE).toBe('shell');
    expect(process.env.LESSONFORGE_TEST_FILE_VALUE).toBe('loaded');
  });

  it('allows a missing file', () => {
    expect(() =>
      loadBackendEnvironment(pathToFileURL(join(directory, 'missing.fixture'))),
    ).not.toThrow();
  });

  it('reports unreadable input without exposing its path', () => {
    expect(() => loadBackendEnvironment(pathToFileURL(directory))).toThrow(
      'Could not load backend environment file.',
    );
  });
});
