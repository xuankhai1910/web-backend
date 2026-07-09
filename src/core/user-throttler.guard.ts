import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * ThrottlerGuard that tracks authenticated requests PER USER instead of per
 * IP. The default per-IP tracking makes co-located users (e.g. several HRs of
 * one company behind the same office NAT) share a single rate-limit bucket —
 * one HR running the CV batch loop would starve everyone else into 429s.
 *
 * JwtAuthGuard runs first (both are global guards, registered in that order),
 * so `req.user` is already populated for authenticated routes; unauthenticated
 * (@Public) routes still fall back to IP tracking.
 */
@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const user = req?.user as
      | { _id?: string | { toString(): string } }
      | undefined;
    const userId =
      typeof user?._id === 'string' ? user._id : user?._id?.toString();
    return Promise.resolve(userId ? `user:${userId}` : String(req.ip));
  }
}
