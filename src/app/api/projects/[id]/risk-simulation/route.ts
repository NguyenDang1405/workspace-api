import { NextResponse, type NextRequest } from 'next/server';
import { runMonteCarloSimulation } from '@/services/rescheduling-engine.service';
import { MonteCarloSimulationResult } from '@/types/rescheduling.types';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: {
    id: string;
  };
}

/**
 * GET /api/projects/[id]/risk-simulation
 *
 * Runs a Monte Carlo risk simulation (N = 1,000) with PERT-Beta distribution
 * and returns P50, P80, P95 percentiles and a 10-bin histogram.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const projectId = params.id;
    const currentUserId = request.headers.get('x-user-id');

    // 1. Authentication Check
    if (!currentUserId) {
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

    // 2. Validate Project ID
    if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Project ID is missing or invalid',
          },
        },
        { status: 400 }
      );
    }

    // 3. Parse Iterations Query Parameter
    const { searchParams } = new URL(request.url);
    const iterationsParam = parseInt(searchParams.get('iterations') || '1000', 10);
    const iterations = Math.max(100, Math.min(2000, isNaN(iterationsParam) ? 1000 : iterationsParam));

    // 4. Run Monte Carlo Simulation
    const simulationResult: MonteCarloSimulationResult = await runMonteCarloSimulation(
      projectId,
      iterations
    );

    return NextResponse.json<ApiResponse<MonteCarloSimulationResult>>(
      {
        success: true,
        data: simulationResult,
        message: `Monte Carlo simulation with ${iterations} iterations completed successfully`,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error('GET /api/projects/[id]/risk-simulation Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    let statusCode = 500;

    if (errorMessage === 'PROJECT_HAS_NO_TASKS') {
      statusCode = 400;
    }

    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: errorMessage,
          message: error instanceof Error ? error.message : 'Failed to run Monte Carlo risk simulation',
        },
      },
      { status: statusCode }
    );
  }
}

