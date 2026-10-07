import { loadEnvFile } from 'node:process';

export class ConfigurationError extends Error {}

// Both src/config and dist/config are two levels below backend/.
export const backendEnvironmentFile = new URL('../../.env', import.meta.url);

export function loadBackendEnvironment(
  path: URL = backendEnvironmentFile,
): void {
  try {
    // Node preserves variables already provided by the shell.
    loadEnvFile(path);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return;
    }
    throw new ConfigurationError(
      'Could not load backend environment file. Check file access.',
    );
  }
}
