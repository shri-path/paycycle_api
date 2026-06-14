import { LanguagePreferenceEntity } from '../domain/language-preference.entity';
import { PrismaTransaction } from '@/infrastructure/database/prisma.client';

export interface ILanguagePreferenceRepository {
  findByUser(userId: bigint): Promise<LanguagePreferenceEntity | null>;
  upsert(
    entity: LanguagePreferenceEntity,
    tx?: PrismaTransaction
  ): Promise<LanguagePreferenceEntity>;
}
