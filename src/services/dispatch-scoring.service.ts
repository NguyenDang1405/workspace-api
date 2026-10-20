import { prisma } from '@/lib/prisma';
import { openai } from '@/lib/openai';
import { searchCandidatesForTask } from './hybrid-search.service';
import {
  DispatchScoredCandidate,
  AdaptiveChecklistItem,
  ChecklistCategory,
} from '@/types/dispatch.types';

export interface ScoredTaskMeta {
  id: string;
  title: string;
  description: string;
  targetDepartment: string;
  requiredLevel: string;
  estimatedHours: number;
  isCriticalPath: boolean;
  status: string;
}

/**
 * Deterministic fallback checklist generator ensuring accurate level-based items (DoD Layer 5).
 * - INTERN / FRESHER: 6 items (between 5 and 7)
 * - JUNIOR / MIDDLE: 4 items (between 3 and 5)
 * - SENIOR: 3 items (between 2 and 3)
 */
export function getFallbackChecklist(userLevel: string): AdaptiveChecklistItem[] {
  const upper = userLevel.toUpperCase();
  if (upper === 'INTERN' || upper === 'FRESHER') {
    return [
      {
        id: 'chk-1',
        taskText: 'Nghiên cứu yêu cầu nghiệp vụ và tài liệu kỹ thuật liên quan',
        isCompleted: false,
        category: 'PREREQUISITE',
      },
      {
        id: 'chk-2',
        taskText: 'Thiết lập môi trường phát triển local và kiểm tra thư viện phụ thuộc',
        isCompleted: false,
        category: 'PREREQUISITE',
      },
      {
        id: 'chk-3',
        taskText: 'Cài đặt mã nguồn giải pháp theo đúng coding convention và clean code',
        isCompleted: false,
        category: 'IMPLEMENTATION',
      },
      {
        id: 'chk-4',
        taskText: 'Xử lý các ngoại lệ cú pháp và validate dữ liệu đầu vào cơ bản',
        isCompleted: false,
        category: 'IMPLEMENTATION',
      },
      {
        id: 'chk-5',
        taskText: 'Viết Unit Test cơ bản kiểm thử các hàm và luồng nghiệp vụ chính',
        isCompleted: false,
        category: 'TESTING',
      },
      {
        id: 'chk-6',
        taskText: 'Tạo Pull Request, tự rà soát mã nguồn (self-review) và giải quyết linting',
        isCompleted: false,
        category: 'TESTING',
      },
    ];
  }

  if (upper === 'SENIOR') {
    return [
      {
        id: 'chk-1',
        taskText: 'Rà soát thiết kế kiến trúc, hợp đồng API và giao thức zero-downtime',
        isCompleted: false,
        category: 'PREREQUISITE',
      },
      {
        id: 'chk-2',
        taskText: 'Triển khai giải pháp cốt lõi, benchmark độ trễ và tối ưu truy vấn CSDL',
        isCompleted: false,
        category: 'IMPLEMENTATION',
      },
      {
        id: 'chk-3',
        taskText: 'Kiểm toán an toàn bảo mật và rà soát nguy cơ rò rỉ dữ liệu hệ thống',
        isCompleted: false,
        category: 'SECURITY',
      },
    ];
  }

  // Default: JUNIOR / MIDDLE
  return [
    {
      id: 'chk-1',
      taskText: 'Phân tích kỹ lưỡng các edge-cases và ràng buộc nghiệp vụ của tác vụ',
      isCompleted: false,
      category: 'PREREQUISITE',
    },
    {
      id: 'chk-2',
      taskText: 'Cài đặt mã nguồn hoàn chỉnh với đầy đủ lớp validation và xử lý ngoại lệ',
      isCompleted: false,
      category: 'IMPLEMENTATION',
    },
    {
      id: 'chk-3',
      taskText: 'Tối ưu hóa các truy vấn CSDL và cấu trúc dữ liệu phát sinh',
      isCompleted: false,
      category: 'IMPLEMENTATION',
    },
    {
      id: 'chk-4',
      taskText: 'Viết Integration Test kiểm thử liên thành phần và tạo Pull Request',
      isCompleted: false,
      category: 'TESTING',
    },
  ];
}

/**
 * MOD-04: Multi-Objective Candidate Scoring
 * S(u, v) = 0.40 * normRrf + 0.25 * normElo + 0.15 * criticalBonus - 0.20 * normWorkload
 */
export async function scoreCandidatesForTask(taskId: string): Promise<{
  task: ScoredTaskMeta;
  rankedCandidates: DispatchScoredCandidate[];
}> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      description: true,
      targetDepartment: true,
      requiredLevel: true,
      estimatedHours: true,
      isCriticalPath: true,
      status: true,
    },
  });

  if (!task) {
    throw new Error('TASK_NOT_FOUND');
  }

  if (task.status !== 'SCHEDULED') {
    throw new Error('TASK_NOT_IN_SCHEDULED_STATE');
  }

  const taskMeta: ScoredTaskMeta = {
    id: task.id,
    title: task.title,
    description: task.description,
    targetDepartment: task.targetDepartment,
    requiredLevel: task.requiredLevel,
    estimatedHours: Number(task.estimatedHours),
    isCriticalPath: task.isCriticalPath,
    status: task.status,
  };

  // 1. Get Top Candidates from MOD-03 (Hybrid Retrieval Engine)
  const baseCandidates = await searchCandidatesForTask(taskId, 10, false);
  if (baseCandidates.length === 0) {
    return { task: taskMeta, rankedCandidates: [] };
  }

  // 2. Query Skill Ratings (Elo) for candidates
  const userIds = baseCandidates.map((c) => c.userId);
  const skillRatings = await prisma.userSkillRating.findMany({
    where: {
      userId: { in: userIds },
    },
  });

  // 3. Min-Max normalization for RRF score
  const rrfScores = baseCandidates.map((c) => c.rrfScore);
  const maxRrf = Math.max(...rrfScores);
  const minRrf = Math.min(...rrfScores);
  const rrfRange = maxRrf - minRrf;

  const scored: DispatchScoredCandidate[] = baseCandidates.map((cand) => {
    const normRrf = rrfRange > 0 ? (cand.rrfScore - minRrf) / rrfRange : 1.0;

    // Calculate Elo score: average of user skill ratings, default 1200
    const userSkills = skillRatings.filter((s) => s.userId === cand.userId);
    const avgElo =
      userSkills.length > 0
        ? userSkills.reduce((sum, s) => sum + Number(s.ratingScore), 0) / userSkills.length
        : 1200.0;

    // Normalized Elo: (Elo - 800) / 1200 clamped in [0, 1]
    const normElo = Math.min(1.0, Math.max(0.0, (avgElo - 800) / 1200));

    // Workload penalty: activeWorkload / 3.0 clamped in [0, 1] (MAX_WIP = 3)
    const normWorkload = Math.min(1.0, cand.activeWorkload / 3.0);
    const criticalBonus = task.isCriticalPath ? 1.0 : 0.0;

    // Multi-objective composite score S(u, v)
    const compositeScore = Number(
      (0.4 * normRrf + 0.25 * normElo + 0.15 * criticalBonus - 0.2 * normWorkload).toFixed(4)
    );

    return {
      userId: cand.userId,
      fullName: cand.fullName,
      email: cand.email,
      department: cand.department,
      level: cand.level,
      rawRrfScore: cand.rrfScore,
      normalizedRrf: Number(normRrf.toFixed(4)),
      eloScore: Number(avgElo.toFixed(2)),
      normalizedElo: Number(normElo.toFixed(4)),
      activeWorkload: cand.activeWorkload,
      workloadPenalty: Number(normWorkload.toFixed(4)),
      criticalBonus,
      compositeScore,
    };
  });

  // Sort descending by compositeScore
  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  return { task: taskMeta, rankedCandidates: scored };
}

/**
 * Generate Adaptive Checklist tailored to Developer's seniority level via OpenAI
 * - INTERN / FRESHER: 5-7 items
 * - JUNIOR / MIDDLE: 3-5 items
 * - SENIOR: 2-3 items
 */
export async function generateAdaptiveChecklist(
  taskTitle: string,
  taskDescription: string,
  userLevel: string
): Promise<AdaptiveChecklistItem[]> {
  const upperLevel = userLevel.toUpperCase();
  const prompt = `Bạn là Technical Leader. Hãy tạo danh sách công việc kiểm tra (checklist) định dạng JSON cho một lập trình viên cấp bậc ${upperLevel} thực hiện task:
Tiêu đề: ${taskTitle}
Mô tả: ${taskDescription}

Yêu cầu cấu trúc số lượng items bắt buộc:
- Nếu cấp bậc là INTERN hoặc FRESHER: Tạo từ 5 đến 7 mục chi tiết, kèm lưu ý về clean code, convention và viết test.
- Nếu cấp bậc là JUNIOR hoặc MIDDLE: Tạo từ 3 đến 5 mục tập trung vào edge cases, validation, xử lý ngoại lệ.
- Nếu cấp bậc là SENIOR: Tạo từ 2 đến 3 mục kiến trúc cấp cao, benchmark hiệu năng, bảo mật.

Chỉ trả về JSON thuần túy có cấu trúc: {"items": [{"id": "chk-1", "taskText": "...", "category": "PREREQUISITE" | "IMPLEMENTATION" | "TESTING" | "SECURITY"}]}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await openai.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      },
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);

    const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
    const items = parsed.items;

    if (Array.isArray(items) && items.length > 0) {
      // Validate item count according to level constraints
      const count = items.length;
      let validCount = false;
      if ((upperLevel === 'INTERN' || upperLevel === 'FRESHER') && count >= 5 && count <= 7) {
        validCount = true;
      } else if ((upperLevel === 'JUNIOR' || upperLevel === 'MIDDLE') && count >= 3 && count <= 5) {
        validCount = true;
      } else if (upperLevel === 'SENIOR' && count >= 2 && count <= 3) {
        validCount = true;
      }

      if (validCount) {
        return items.map((it: { id?: string; taskText: string; category?: ChecklistCategory }, idx: number) => ({
          id: it.id || `chk-${idx + 1}`,
          taskText: String(it.taskText || `Công việc #${idx + 1}`),
          isCompleted: false,
          category: (['PREREQUISITE', 'IMPLEMENTATION', 'TESTING', 'SECURITY'].includes(it.category || '')
            ? it.category
            : 'IMPLEMENTATION') as ChecklistCategory,
        }));
      }
    }

    return getFallbackChecklist(userLevel);
  } catch (err) {
    console.warn('[Adaptive Checklist Warning - using deterministic fallback]:', err);
    return getFallbackChecklist(userLevel);
  }
}

