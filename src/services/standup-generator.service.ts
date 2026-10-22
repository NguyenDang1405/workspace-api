import { prisma } from '@/lib/prisma';
import OpenAI from 'openai';
import { FlowMetricsSnapshot, StandupReportDto } from '@/types/standup.types';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'dummy-key-for-build',
  timeout: 8000,
});

/**
 * Generates or regenerates an automated Daily Standup report for a project.
 * Implements idempotent UPSERT keyed by (projectId, reportDate).
 *
 * @param projectId - Target project UUID
 * @param targetDateStr - Optional target date formatted as YYYY-MM-DD (defaults to today)
 * @returns StandupReportDto with executive summary and flow metrics snapshot
 */
export async function generateDailyStandupForProject(
  projectId: string,
  targetDateStr?: string
): Promise<StandupReportDto> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });

  if (!project) {
    throw new Error('PROJECT_NOT_FOUND');
  }

  const now = targetDateStr ? new Date(`${targetDateStr}T12:00:00.000Z`) : new Date();
  const dateString = now.toISOString().split('T')[0];
  const reportDateOnly = new Date(`${dateString}T00:00:00.000Z`);
  const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // 1. Evidence-Based Activity Mining (Last 24 Hours)
  const [recentStatusHistory, recentPRs, activeTasks, blockedTasks] = await Promise.all([
    // Task status transitions in past 24h
    prisma.taskStatusHistory.findMany({
      where: {
        task: { projectId },
        createdAt: { gte: past24h },
      },
      include: {
        task: { select: { id: true, title: true, isCriticalPath: true } },
        changer: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),

    // Git Pull Requests in past 24h
    prisma.gitPullRequest.findMany({
      where: {
        task: { projectId },
        createdAt: { gte: past24h },
      },
      select: {
        id: true,
        prNumber: true,
        branchName: true,
        status: true,
        authorGithubUsername: true,
        mergedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),

    // Currently active WIP tasks
    prisma.task.findMany({
      where: {
        projectId,
        status: { in: ['TODO', 'IN_PROGRESS', 'REVIEW'] },
      },
      select: {
        id: true,
        title: true,
        status: true,
        isCriticalPath: true,
        estimatedHours: true,
        assignee: { select: { fullName: true } },
      },
    }),

    // Blocked tasks
    prisma.task.findMany({
      where: {
        projectId,
        isBlocked: true,
      },
      select: {
        id: true,
        title: true,
        blockReason: true,
        assignee: { select: { fullName: true } },
      },
    }),
  ]);

  // 2. Real-time Flow Metrics Snapshot Calculation
  const completedIn24h = recentStatusHistory.filter((h) => h.toStatus === 'DONE').length;
  const criticalHoursRemaining = activeTasks
    .filter((t) => t.isCriticalPath)
    .reduce((sum, t) => sum + Number(t.estimatedHours), 0);

  const flowMetrics: FlowMetricsSnapshot = {
    activeWip: activeTasks.length,
    completedLast24h: completedIn24h,
    blockedTasksCount: blockedTasks.length,
    criticalPathRemainingHours: Number(criticalHoursRemaining.toFixed(1)),
    openPRsCount: recentPRs.filter((p) => p.status === 'OPEN').length,
    burnRateAlert: blockedTasks.length >= 2,
  };

  // 3. Prepare Context for LLM Synthesis
  const contextData = {
    projectName: project.name,
    activities24h: recentStatusHistory.map((h) => ({
      task: h.task.title,
      from: h.fromStatus,
      to: h.toStatus,
      by: h.changer?.fullName || 'Hệ thống',
      isCritical: h.task.isCriticalPath,
    })),
    pullRequests: recentPRs.map((pr) => ({
      prNumber: pr.prNumber,
      branch: pr.branchName,
      status: pr.status,
      author: pr.authorGithubUsername,
    })),
    wipPlan: activeTasks.map((t) => ({
      task: t.title,
      status: t.status,
      assignee: t.assignee?.fullName || 'Chưa gán',
      isCritical: t.isCriticalPath,
    })),
    blockers: blockedTasks.map((b) => ({
      task: b.title,
      reason: b.blockReason || 'Không nêu lý do',
      assignee: b.assignee?.fullName || 'Chưa gán',
    })),
  };

  // Fallback heuristic summaries
  let summaryYesterday =
    recentStatusHistory.length > 0 || recentPRs.length > 0
      ? `Đội ngũ đã chuyển đổi trạng thái ${recentStatusHistory.length} tác vụ và ghi nhận ${recentPRs.length} Pull Requests trong 24 giờ qua.`
      : 'Đội ngũ tiếp tục triển khai các tác vụ theo tiến độ danh định.';

  let planToday =
    activeTasks.length > 0
      ? `Tập trung giải quyết ${activeTasks.length} tác vụ đang mở (${activeTasks.filter((t) => t.isCriticalPath).length} tác vụ trên đường găng).`
      : 'Tập trung giải quyết các tác vụ trong kế hoạch sprint hiện tại.';

  let identifiedBlockers =
    blockedTasks.length > 0
      ? `Phát hiện ${blockedTasks.length} điểm nghẽn: ${blockedTasks
          .map((b) => `Tác vụ "${b.title}" bị nghẽn do ${b.blockReason || 'chưa rõ lý do'}`)
          .join('; ')}. Cần ưu tiên phối hợp tháo gỡ.`
      : 'Không có điểm nghẽn nào được ghi nhận.';

  // 4. Call OpenAI gpt-4o-mini
  try {
    const prompt = `Bạn là Trợ lý AI Scrum Master chuyên nghiệp. Dựa vào dữ liệu thực tế 24 giờ qua của dự án "${project.name}":
${JSON.stringify(contextData, null, 2)}

Hãy tổng hợp bản báo cáo Daily Standup ngắn gọn, chuyên nghiệp và có giá trị hành động cao.
Định dạng trả về JSON bắt buộc:
{
  "summaryYesterday": "<Tóm tắt 2-3 câu các task đã chuyển trạng thái hoặc PRs đã tạo/merge>",
  "planToday": "<Tóm tắt 2-3 câu trọng tâm công việc hôm nay, nhấn mạnh các task đường găng critical path>",
  "identifiedBlockers": "<Liệt kê cụ thể từng điểm nghẽn kèm nguyên nhân, hoặc ghi 'Không có điểm nghẽn nào được ghi nhận' nếu không có task nghẽn>"
}`;

    const aiRes = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const parsed = JSON.parse(aiRes.choices[0].message.content || '{}');
    if (parsed.summaryYesterday && typeof parsed.summaryYesterday === 'string') {
      summaryYesterday = parsed.summaryYesterday;
    }
    if (parsed.planToday && typeof parsed.planToday === 'string') {
      planToday = parsed.planToday;
    }
    if (parsed.identifiedBlockers && typeof parsed.identifiedBlockers === 'string') {
      identifiedBlockers = parsed.identifiedBlockers;
    }
  } catch (err) {
    console.warn('[Standup LLM Warning - Falling back to heuristic summary]:', err);
  }

  // 5. Idempotent UPSERT into daily_standup_reports
  const report = await prisma.dailyStandupReport.upsert({
    where: {
      projectId_reportDate: {
        projectId,
        reportDate: reportDateOnly,
      },
    },
    update: {
      summaryYesterday,
      planToday,
      identifiedBlockers,
      flowMetrics: flowMetrics as any,
    },
    create: {
      projectId,
      reportDate: reportDateOnly,
      summaryYesterday,
      planToday,
      identifiedBlockers,
      flowMetrics: flowMetrics as any,
    },
  });

  return {
    id: report.id,
    projectId: report.projectId,
    reportDate: dateString,
    summaryYesterday: report.summaryYesterday,
    planToday: report.planToday,
    identifiedBlockers: report.identifiedBlockers,
    flowMetrics: report.flowMetrics as unknown as FlowMetricsSnapshot,
    createdAt: report.createdAt.toISOString(),
  };
}

/**
 * Retrieves a Daily Standup report for a project on a given date.
 *
 * @param projectId - Target project UUID
 * @param dateStr - Target date formatted as YYYY-MM-DD (defaults to today)
 * @returns StandupReportDto or null if not found
 */
export async function getDailyStandupForProject(
  projectId: string,
  dateStr?: string
): Promise<StandupReportDto | null> {
  const dateString = dateStr || new Date().toISOString().split('T')[0];
  const reportDateOnly = new Date(`${dateString}T00:00:00.000Z`);

  const report = await prisma.dailyStandupReport.findUnique({
    where: {
      projectId_reportDate: {
        projectId,
        reportDate: reportDateOnly,
      },
    },
  });

  if (!report) {
    return null;
  }

  return {
    id: report.id,
    projectId: report.projectId,
    reportDate: dateString,
    summaryYesterday: report.summaryYesterday,
    planToday: report.planToday,
    identifiedBlockers: report.identifiedBlockers,
    flowMetrics: report.flowMetrics as unknown as FlowMetricsSnapshot,
    createdAt: report.createdAt.toISOString(),
  };
}

