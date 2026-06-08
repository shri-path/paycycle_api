import { StaffInvitationStatus } from '@prisma/client';
import { StaffInvitationEntity } from '../../domain/staff-invitation.entity';
import { InviteToken } from '../../domain/value-objects/invite-token.value-object';
import { ExpiredInviteError, InvalidInviteError } from '../../domain/staff.errors';
import { INVITATION_TTL_MS } from '../../domain/staff-invitation.types';

function buildInvitation(rawToken = InviteToken.generate().raw): StaffInvitationEntity {
  return StaffInvitationEntity.create(
    { vendorId: 1n, vendorUserId: 2n, invitedByUserId: 3n, phone: '+919000000010' },
    rawToken
  );
}

describe('StaffInvitationEntity', () => {
  it('creates a PENDING invitation expiring 7 days out, storing only the hash', () => {
    const { raw, hash } = InviteToken.generate();
    const inv = buildInvitation(raw);
    const props = inv.getProps();
    expect(props.status).toBe(StaffInvitationStatus.PENDING);
    expect(props.tokenHash).toBe(hash);
    expect(props.tokenHash).not.toBe(raw); // never stores the raw token
    const ttl = props.expiresAt.getTime() - props.createdAt.getTime();
    expect(Math.abs(ttl - INVITATION_TTL_MS)).toBeLessThan(2000);
  });

  it('isUsable is true while PENDING and unexpired', () => {
    expect(buildInvitation().isUsable()).toBe(true);
  });

  it('accept transitions PENDING → ACCEPTED', () => {
    const inv = buildInvitation();
    inv.accept();
    const props = inv.getProps();
    expect(props.status).toBe(StaffInvitationStatus.ACCEPTED);
    expect(props.acceptedAt).toBeInstanceOf(Date);
  });

  it('accept on an expired invitation throws ExpiredInviteError (422)', () => {
    const inv = buildInvitation();
    const future = new Date(Date.now() + INVITATION_TTL_MS + 60_000);
    expect(() => inv.accept(future)).toThrow(ExpiredInviteError);
  });

  it('accept on a non-PENDING invitation throws InvalidInviteError', () => {
    const inv = buildInvitation();
    inv.accept();
    expect(() => inv.accept()).toThrow(InvalidInviteError);
  });

  it('revoke moves PENDING → REVOKED', () => {
    const inv = buildInvitation();
    inv.revoke();
    expect(inv.getProps().status).toBe(StaffInvitationStatus.REVOKED);
  });
});
