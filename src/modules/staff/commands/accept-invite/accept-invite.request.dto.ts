export interface AcceptInviteRequestDto {
  token: string;
  password: string;
  name: string | null;
  ip: string | null;
  userAgent: string | null;
}
