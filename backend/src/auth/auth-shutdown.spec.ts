import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthRepository } from './auth.repository.js';
import { PasswordService } from './password.service.js';

it('real module teardown drains accepted auth work before database disposal and prevents reconnection', async () => {
  let finish!: () => void;
  const find = vi.fn(
    () =>
      new Promise<null>((resolve) => {
        finish = () => resolve(null);
      }),
  );
  const disconnect = vi.fn(async () => undefined);
  const fixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({
      client: { user: { findUnique: find } },
      onModuleDestroy: disconnect,
    })
    .overrideProvider(PasswordService)
    .useValue({})
    .compile();
  const repository = fixture.get(AuthRepository);
  const draining = vi.spyOn(repository, 'onModuleDestroy');
  const pending = repository.findLoginUser('teacher@example.test');
  const closing = fixture.close();
  try {
    await vi.waitFor(() => expect(draining).toHaveBeenCalledOnce());
    expect(disconnect).not.toHaveBeenCalled();
    await expect(repository.findLoginUser('new@example.test')).rejects.toThrow(
      'Service unavailable.',
    );
    await expect(repository.authenticate('unneeded')).rejects.toThrow(
      'Service unavailable.',
    );
    await expect(repository.revoke('unneeded')).rejects.toThrow(
      'Service unavailable.',
    );
    await expect(repository.cleanup()).rejects.toThrow('Service unavailable.');
    expect(find).toHaveBeenCalledOnce();
    finish();
    await pending;
    await closing;
    expect(disconnect).toHaveBeenCalledOnce();
    await expect(repository.findLoginUser('new@example.test')).rejects.toThrow(
      'Service unavailable.',
    );
  } finally {
    finish();
    await closing;
  }
});
