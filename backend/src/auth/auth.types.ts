import type { Request } from 'express';
import type { UserRole } from '../generated/prisma/enums.js';
export type SafeUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
};
export type Principal = { user: SafeUser; expiresAt: Date };
export type AuthRequest = Request & { principal?: Principal };
