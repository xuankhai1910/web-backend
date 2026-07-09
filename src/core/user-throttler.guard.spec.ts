import { UserAwareThrottlerGuard } from './user-throttler.guard';

describe('UserAwareThrottlerGuard', () => {
  const guard = new UserAwareThrottlerGuard(
    { throttlers: [] } as any,
    {} as any,
    {} as any,
  );
  const getTracker = (req: Record<string, any>) =>
    (guard as any).getTracker(req) as Promise<string>;

  it('tracks authenticated requests per user, not per IP', async () => {
    await expect(
      getTracker({ user: { _id: 'user-1' }, ip: '10.0.0.1' }),
    ).resolves.toBe('user:user-1');
  });

  it('falls back to IP for unauthenticated (public) requests', async () => {
    await expect(getTracker({ ip: '10.0.0.1' })).resolves.toBe('10.0.0.1');
  });
});
