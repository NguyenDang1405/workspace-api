import { SignJWT, jwtVerify } from 'jose';

const JWT_SECRET_STRING =
  process.env.JWT_ACCESS_SECRET ||
  process.env.JWT_SECRET ||
  'super-secret-workspace-key-123456';
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_STRING);

export interface AccessTokenPayload {
  userId: string;
  email: string;
  role: string;
  authVersion: number;
  fullName?: string;
}

export type JWTPayload = AccessTokenPayload;

/**
 * Pure Edge-compatible JWT creation using jose (HS256)
 */
export async function createAccessToken(payload: {
  userId: string;
  email: string;
  role: string;
  authVersion: number;
  fullName?: string;
}): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
}

/**
 * Pure Edge-compatible JWT verification using jose
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const verified = await jwtVerify(token, JWT_SECRET);
    return verified.payload as unknown as AccessTokenPayload;
  } catch {
    return null;
  }
}

export const verifyJWT = verifyAccessToken;
export const signJWT = createAccessToken;

