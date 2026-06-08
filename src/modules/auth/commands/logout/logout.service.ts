import { Logger } from '@/infrastructure/logger/logger';
import { SessionRepository } from '../../database/session.repository';
import { LogoutRequestDto } from './logout.request.dto';

export class LogoutService {
  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly logger: Logger
  ) {}

  async execute(dto: LogoutRequestDto): Promise<{ message: string }> {
    this.logger.info('LogoutService: logout request');

    // Idempotent — no error if session not found
    const session = await this.sessionRepository.findByRefreshToken(dto.refreshToken);
    if (session && session.revokedAt === null) {
      await this.sessionRepository.revoke(session.id);
      this.logger.info({ sessionId: session.id.toString() }, 'LogoutService: session revoked');
    }

    return { message: 'Logged out successfully.' };
  }
}
