import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiResponse } from '@/types';
import {
  UpdateAvailabilitySlotsSchema,
  UserAvailabilityResponseData,
} from '@/types/availability.types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/users/me/availability
 *
 * Retrieves the complete availability slots (free time vs busy class/exam)
 * for the authenticated user across 7 days of the week.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json<ApiResponse>(
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

    const slots = await prisma.userAvailabilitySlot.findMany({
      where: { userId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });

    const responseData: UserAvailabilityResponseData = {
      userId,
      slots: slots.map((s) => ({
        id: s.id,
        userId: s.userId,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        slotType: s.slotType,
        createdAt: s.createdAt.toISOString(),
      })),
    };

    return NextResponse.json<ApiResponse<UserAvailabilityResponseData>>(
      {
        success: true,
        data: responseData,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error('GET /api/users/me/availability Error:', error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to retrieve availability slots',
        },
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/users/me/availability
 *
 * Replaces the entire availability schedule for the authenticated user.
 * Typically used by students/individuals to configure semester timetables.
 */
export async function PUT(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json<ApiResponse>(
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

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'INVALID_JSON',
            message: 'Malformed or missing JSON request body',
          },
        },
        { status: 400 }
      );
    }

    const parseResult = UpdateAvailabilitySlotsSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid availability slots format',
            details: parseResult.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const { slots } = parseResult.data;

    // Replace all slots within a transaction
    const updatedSlots = await prisma.$transaction(async (tx) => {
      await tx.userAvailabilitySlot.deleteMany({
        where: { userId },
      });

      if (slots.length > 0) {
        await tx.userAvailabilitySlot.createMany({
          data: slots.map((s) => ({
            userId,
            dayOfWeek: s.dayOfWeek,
            startTime: s.startTime,
            endTime: s.endTime,
            slotType: s.slotType,
          })),
        });
      }

      return await tx.userAvailabilitySlot.findMany({
        where: { userId },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });
    });

    const responseData: UserAvailabilityResponseData = {
      userId,
      slots: updatedSlots.map((s) => ({
        id: s.id,
        userId: s.userId,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        slotType: s.slotType,
        createdAt: s.createdAt.toISOString(),
      })),
    };

    return NextResponse.json<ApiResponse<UserAvailabilityResponseData>>(
      {
        success: true,
        data: responseData,
        message: 'Cập nhật thời gian biểu cá nhân thành công',
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error('PUT /api/users/me/availability Error:', error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to update availability slots',
        },
      },
      { status: 500 }
    );
  }
}

