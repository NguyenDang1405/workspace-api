import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashPassword, signJWT } from '@/lib/auth';

const RegisterSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  fullName: z.string().min(2, 'Full name is required'),
  department: z.enum(['FRONTEND', 'BACKEND', 'DEVOPS', 'QA', 'FULLSTACK']).optional().default('FULLSTACK'),
  role: z.enum(['ADMIN', 'PM', 'LEADER', 'MEMBER']).optional().default('MEMBER'),
  level: z.enum(['INTERN', 'FRESHER', 'JUNIOR', 'MIDDLE', 'SENIOR']).optional().default('JUNIOR'),
  skills: z.array(z.string()).optional().default([]),
  bioSummary: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validatedData = RegisterSchema.parse(body);

    const existingUser = await prisma.user.findUnique({
      where: { email: validatedData.email },
    });

    if (existingUser) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 400 });
    }

    const passwordHash = await hashPassword(validatedData.password);

    const user = await prisma.user.create({
      data: {
        email: validatedData.email,
        passwordHash,
        fullName: validatedData.fullName,
        department: validatedData.department,
        role: validatedData.role,
        level: validatedData.level,
        skills: validatedData.skills,
        bioSummary: validatedData.bioSummary,
      },
    });

    const token = await signJWT({
      userId: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
    });

    const response = NextResponse.json(
      { message: 'User registered successfully', user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role } },
      { status: 201 }
    );

    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });

    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 400 });
    }
    console.error('Register API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
