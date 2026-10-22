import { NextResponse, type NextRequest } from 'next/server';
import { verifyAccessToken } from '@/lib/jwt';

const PUBLIC_API_WHITELIST = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/health',
  '/api/webhooks/github',
];

const UI_PROTECTED_PREFIXES = ['/projects', '/teams', '/profile'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. API Route Protection
  if (pathname.startsWith('/api/')) {
    // Whitelisted public endpoints
    if (PUBLIC_API_WHITELIST.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
      return NextResponse.next();
    }

    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    const cookieToken =
      request.cookies.get('access_token')?.value || request.cookies.get('token')?.value;

    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader || cookieToken;

    if (!token) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication token is required',
          },
        },
        { status: 401 }
      );
    }

    const payload = await verifyAccessToken(token);
    if (!payload || !payload.userId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_TOKEN',
            message: 'Token is invalid or expired',
          },
        },
        { status: 401 }
      );
    }

    // Attach decoded user info into request headers for Route Handlers
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-id', payload.userId);
    requestHeaders.set('x-user-email', payload.email);
    requestHeaders.set('x-user-role', payload.role);
    requestHeaders.set('x-auth-version', String(payload.authVersion || 1));

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  // 2. UI Page Protection
  const isProtectedUI = UI_PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (isProtectedUI) {
    const token =
      request.cookies.get('token')?.value ||
      request.cookies.get('access_token')?.value ||
      request.headers.get('authorization')?.replace('Bearer ', '');

    if (!token) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('from', pathname);
      return NextResponse.redirect(loginUrl);
    }

    const payload = await verifyAccessToken(token);
    if (!payload) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('from', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*', '/projects/:path*', '/teams/:path*', '/profile/:path*'],
};
