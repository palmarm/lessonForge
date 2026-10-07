import { ConfigurationError } from './config/environment.js';

export function resolvePort(value: string | undefined): number {
  if (value === undefined) {
    return 3001;
  }

  const port = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new ConfigurationError(
      'PORT must be a decimal integer between 1 and 65535.',
    );
  }

  return port;
}
