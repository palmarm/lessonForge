import { BadRequestException } from '@nestjs/common';
import { exactObject, expectedVersion } from '../resources/resources.input.js';

export function copyOperationKey(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  )
    throw new BadRequestException('Invalid copy key.');
  return value;
}

export function copyInput(body: unknown) {
  const input = exactObject(body, ['operationKey', 'expectedVersion']);
  return {
    operationKey: copyOperationKey(input.operationKey),
    expectedVersion: expectedVersion(input.expectedVersion),
  };
}
