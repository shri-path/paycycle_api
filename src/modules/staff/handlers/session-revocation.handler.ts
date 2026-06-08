import { Logger } from '@/infrastructure/logger/logger';
import { SessionRepository } from '@/modules/auth/database/session.repository';

/**
 * Revokes a user's active sessions when their staff membership is disabled or
 * removed (story edge cases #1/#6 — "logout on next API call").
 *
 * Invoked by the disable/remove staff commands. The `identifyUserRole`
 * middleware also re-checks status=ACTIVE on every request, so a disabled staff
 * member is blocked on their next call even before sessions expire — this
 * handler proactively kills any live refresh tokens as defence-in-depth.
 *
 * Never throws into the request path — failures are logged and swallowed.
 */
export class SessionRevocationHandler {
  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly logger: Logger
  ) {}

  async revokeAllForUser(userId: bigint, reason: string, correlationId: string): Promise<void> {
    try {
      await this.sessionRepository.revokeAll(userId);
      this.logger.info(
        { userId: userId.toString(), reason, correlationId },
        'SessionRevocationHandler: revoked all sessions for user'
      );
    } catch (error) {
      this.logger.warn(
        { err: error, userId: userId.toString(), reason, correlationId },
        'SessionRevocationHandler: failed to revoke sessions (swallowed)'
      );
    }
  }
}
