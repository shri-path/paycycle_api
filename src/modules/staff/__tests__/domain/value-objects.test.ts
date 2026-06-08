import { VendorUserStatus } from '@prisma/client';
import { ArgumentInvalidException } from '@/common/errors/app-error';
import { InviteToken } from '../../domain/value-objects/invite-token.value-object';
import {
  PermissionKey,
  PermissionKeyVO,
} from '../../domain/value-objects/permission-key.value-object';
import { MembershipStatus } from '../../domain/value-objects/membership-status.value-object';
import { InvalidStatusTransitionError } from '../../domain/staff.errors';

describe('InviteToken (CSPRNG)', () => {
  it('generates a 64-hex raw token and a matching 64-hex sha256 hash', () => {
    const { raw, hash } = InviteToken.generate();
    expect(raw).toMatch(/^[a-f0-9]{64}$/); // 32 bytes hex
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(InviteToken.hash(raw)).toBe(hash);
  });

  it('produces distinct tokens across calls (not deterministic)', () => {
    const a = InviteToken.generate().raw;
    const b = InviteToken.generate().raw;
    expect(a).not.toBe(b);
  });

  it('rejects empty raw token', () => {
    expect(() => InviteToken.hash('')).toThrow(ArgumentInvalidException);
  });

  it('validates hash shape', () => {
    expect(InviteToken.isValidHash('a'.repeat(64))).toBe(true);
    expect(InviteToken.isValidHash('xyz')).toBe(false);
  });
});

describe('PermissionKey', () => {
  it('parses known keys', () => {
    expect(PermissionKeyVO.from('mark_deliveries')).toBe(PermissionKey.MARK_DELIVERIES);
  });

  it('throws on unknown keys', () => {
    expect(() => PermissionKeyVO.from('hack')).toThrow(ArgumentInvalidException);
  });

  it('reports all three grantable keys', () => {
    expect(PermissionKeyVO.all()).toHaveLength(3);
  });
});

describe('MembershipStatus state machine', () => {
  it('allows INVITED → ACTIVE', () => {
    expect(
      MembershipStatus.create(VendorUserStatus.INVITED).canTransitionTo(VendorUserStatus.ACTIVE)
    ).toBe(true);
  });

  it('allows ACTIVE → DISABLED and DISABLED → ACTIVE', () => {
    expect(
      MembershipStatus.create(VendorUserStatus.ACTIVE).canTransitionTo(VendorUserStatus.DISABLED)
    ).toBe(true);
    expect(
      MembershipStatus.create(VendorUserStatus.DISABLED).canTransitionTo(VendorUserStatus.ACTIVE)
    ).toBe(true);
  });

  it('treats REMOVED as terminal', () => {
    const removed = MembershipStatus.create(VendorUserStatus.REMOVED);
    expect(removed.isTerminal()).toBe(true);
    expect(() => removed.assertTransition(VendorUserStatus.ACTIVE)).toThrow(
      InvalidStatusTransitionError
    );
  });

  it('rejects INVITED → DISABLED', () => {
    expect(() =>
      MembershipStatus.create(VendorUserStatus.INVITED).assertTransition(VendorUserStatus.DISABLED)
    ).toThrow(InvalidStatusTransitionError);
  });
});
