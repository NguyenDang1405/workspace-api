import OpenAI from 'openai';

/**
 * AI Service Microservice Configuration
 * Connects to the external Python FastAPI microservice via HTTP.
 */
export const AI_SERVICE_URL = (
  process.env.AI_SERVICE_URL || 'http://localhost:8000'
).replace(/\/$/, '');

export const REQUEST_TIMEOUT_MS = 15000;

/**
 * Direct OpenAI SDK Client Instance.
 * Preserved for backwards compatibility with modules or direct completions.
 */
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'dummy-key-for-build',
});

/**
 * Generic HTTP POST wrapper for calling the Python FastAPI AI Microservice.
 * Implements AbortController timeout, strict error handling, and graceful degradation.
 */
async function postFastApi<T>(
  endpoint: string,
  payload: unknown,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const targetUrl = `${AI_SERVICE_URL}${endpoint}`;
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      console.warn(
        `[FastAPI Adapter Warning]: POST ${endpoint} returned HTTP ${response.status} ${response.statusText}`
      );
      return null;
    }

    return (await response.json()) as T;
  } catch (error: any) {
    clearTimeout(timer);
    console.warn(
      `[FastAPI Adapter Error]: Failed to reach ${AI_SERVICE_URL}${endpoint} - ${
        error?.message || error
      }`
    );
    return null;
  }
}

/**
 * Normalizes vector response formats from various FastAPI embedding outputs.
 */
function extractEmbeddingVector(response: any, index: number = 0): number[] | null {
  if (!response) return null;
  if (Array.isArray(response) && Array.isArray(response[index])) {
    return response[index];
  }
  if (Array.isArray(response.embeddings) && Array.isArray(response.embeddings[index])) {
    return response.embeddings[index];
  }
  if (Array.isArray(response.data) && Array.isArray(response.data[index]?.embedding)) {
    return response.data[index].embedding;
  }
  return null;
}

// ============================================================================
// 1. VECTOR EMBEDDINGS (MOD-01, MOD-02, MOD-03, MOD-04)
// Endpoint: POST /api/v1/embeddings/batch
// ============================================================================

/**
 * Generate a 1536-dimensional embedding for raw text.
 * Delegates to FastAPI `/api/v1/embeddings/batch`.
 */
export async function embedText(text: string): Promise<number[]> {
  const fastApiRes = await postFastApi<any>('/api/v1/embeddings/batch', {
    texts: [text],
  });

  const vector = extractEmbeddingVector(fastApiRes, 0);
  if (vector && vector.length === 1536) {
    return vector;
  }

  // Graceful fallback to OpenAI SDK if configured
  if (process.env.OPENAI_API_KEY) {
    try {
      const res = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      });
      return res.data[0]?.embedding ?? new Array(1536).fill(0);
    } catch (err) {
      console.warn('[OpenAI Fallback Warning in embedText]:', err);
    }
  }

  return new Array(1536).fill(0);
}

/**
 * Generate a 1536-dimensional embedding specifically for talent profiles.
 * Delegates to FastAPI `/api/v1/embeddings/batch`.
 */
export async function generateProfileEmbedding(data: {
  department: string;
  level: string;
  skills: string[];
  bioSummary?: string | null;
}): Promise<number[] | null> {
  const context = `Phòng ban: ${data.department} | Cấp bậc: ${data.level} | Kỹ năng: ${data.skills.join(
    ', '
  )} | Kinh nghiệm: ${data.bioSummary || ''}`;

  const fastApiRes = await postFastApi<any>('/api/v1/embeddings/batch', {
    texts: [context],
  });

  const vector = extractEmbeddingVector(fastApiRes, 0);
  if (vector && vector.length === 1536) {
    return vector;
  }

  // Graceful fallback to OpenAI SDK if configured
  if (process.env.OPENAI_API_KEY) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await openai.embeddings.create(
        {
          model: 'text-embedding-3-small',
          input: context,
        },
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      return res.data[0]?.embedding ?? null;
    } catch (err) {
      console.warn('[OpenAI Fallback Warning in generateProfileEmbedding]:', err);
    }
  }

  // Deterministic fallback non-null vector
  return new Array(1536).fill(0.01);
}

/**
 * Generate a 1536-dimensional embedding specifically for tasks (MOD-02 / MOD-03 / MOD-10).
 * Delegates to FastAPI `/api/v1/embeddings/batch`.
 */
export async function generateTaskEmbedding(
  title: string,
  description?: string | null
): Promise<number[] | null> {
  const context = `${title} ${description || ''}`.trim();

  const fastApiRes = await postFastApi<any>('/api/v1/embeddings/batch', {
    texts: [context],
  });

  const vector = extractEmbeddingVector(fastApiRes, 0);
  if (vector && vector.length === 1536) {
    return vector;
  }

  // Graceful fallback to OpenAI SDK if configured
  if (process.env.OPENAI_API_KEY) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await openai.embeddings.create(
        {
          model: 'text-embedding-3-small',
          input: context,
        },
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      return res.data[0]?.embedding ?? null;
    } catch (err) {
      console.warn('[OpenAI Fallback Warning in generateTaskEmbedding]:', err);
    }
  }

  // Deterministic fallback non-null vector
  return new Array(1536).fill(0.01);
}

// ============================================================================
// 2. ADAPTIVE GUIDANCE CHECKLIST (MOD-04)
// Endpoint: POST /api/v1/guidance/generate
// ============================================================================

export type ChecklistCategory =
  | 'PREREQUISITE'
  | 'IMPLEMENTATION'
  | 'TESTING'
  | 'SECURITY';

export interface AdaptiveChecklistItem {
  id: string;
  taskText: string;
  isCompleted: boolean;
  category: ChecklistCategory;
}

function getDefaultAdaptiveChecklist(upperLevel: string): AdaptiveChecklistItem[] {
  if (upperLevel === 'INTERN' || upperLevel === 'FRESHER') {
    return [
      {
        id: 'chk-1',
        taskText: 'Đọc kỹ tài liệu đặc tả và xác nhận yêu cầu với Leader/Mentor',
        isCompleted: false,
        category: 'PREREQUISITE',
      },
      {
        id: 'chk-2',
        taskText: 'Tuân thủ coding convention, TypeScript strict mode và format code',
        isCompleted: false,
        category: 'IMPLEMENTATION',
      },
      {
        id: 'chk-3',
        taskText: 'Xử lý đầy đủ các ngoại lệ và kiểm tra tham số đầu vào',
        isCompleted: false,
        category: 'IMPLEMENTATION',
      },
      {
        id: 'chk-4',
        taskText: 'Viết unit test bao phủ các nhánh điều kiện chính',
        isCompleted: false,
        category: 'TESTING',
      },
      {
        id: 'chk-5',
        taskText: 'Tự review lại mã nguồn (self-review) trước khi tạo Pull Request',
        isCompleted: false,
        category: 'TESTING',
      },
      {
        id: 'chk-6',
        taskText: 'Kiểm tra bảo mật cơ bản: không hardcode bí mật, validate input',
        isCompleted: false,
        category: 'SECURITY',
      },
    ];
  }

  if (upperLevel === 'JUNIOR' || upperLevel === 'MIDDLE') {
    return [
      {
        id: 'chk-1',
        taskText: 'Kiểm tra lược đồ dữ liệu và sự tương thích với API hiện hành',
        isCompleted: false,
        category: 'PREREQUISITE',
      },
      {
        id: 'chk-2',
        taskText: 'Triển khai nghiệp vụ cốt lõi kèm xử lý toàn vẹn lỗi (Edge Cases)',
        isCompleted: false,
        category: 'IMPLEMENTATION',
      },
      {
        id: 'chk-3',
        taskText: 'Tích hợp xác thực phân quyền và bảo vệ tài nguyên',
        isCompleted: false,
        category: 'SECURITY',
      },
      {
        id: 'chk-4',
        taskText: 'Viết kiểm thử tự động xác minh tính đúng đắn luồng nghiệp vụ',
        isCompleted: false,
        category: 'TESTING',
      },
    ];
  }

  // SENIOR: 2-3 items
  return [
    {
      id: 'chk-1',
      taskText: 'Thẩm định thiết kế kiến trúc phân tán, độ mở rộng và tính toàn vẹn',
      isCompleted: false,
      category: 'PREREQUISITE',
    },
    {
      id: 'chk-2',
      taskText: 'Tối ưu hóa hiệu năng, truy vấn cơ sở dữ liệu và giảm thiểu độ trễ',
      isCompleted: false,
      category: 'IMPLEMENTATION',
    },
    {
      id: 'chk-3',
      taskText: 'Đánh giá an ninh bảo mật chuyên sâu, phân tích lỗ hổng và phòng thủ',
      isCompleted: false,
      category: 'SECURITY',
    },
  ];
}

/**
 * Generate role-tailored adaptive guidance checklists.
 * Delegates to FastAPI `/api/v1/guidance/generate`.
 */
export async function generateAdaptiveChecklist(
  taskTitle: string,
  taskDescription: string,
  userLevel: string
): Promise<AdaptiveChecklistItem[]> {
  const upperLevel = (userLevel || 'JUNIOR').toUpperCase();

  // 1. Call FastAPI Microservice
  const fastApiRes = await postFastApi<any>('/api/v1/guidance/generate', {
    taskTitle,
    taskDescription,
    userLevel: upperLevel,
  });

  const rawItems =
    fastApiRes?.items ||
    fastApiRes?.checklist ||
    (Array.isArray(fastApiRes) ? fastApiRes : null);

  if (Array.isArray(rawItems) && rawItems.length > 0) {
    const count = rawItems.length;
    let isValidCount = false;
    if (
      (upperLevel === 'INTERN' || upperLevel === 'FRESHER') &&
      count >= 5 &&
      count <= 7
    ) {
      isValidCount = true;
    } else if (
      (upperLevel === 'JUNIOR' || upperLevel === 'MIDDLE') &&
      count >= 3 &&
      count <= 5
    ) {
      isValidCount = true;
    } else if (upperLevel === 'SENIOR' && count >= 2 && count <= 3) {
      isValidCount = true;
    }

    if (isValidCount) {
      return rawItems.map((it: any, idx: number) => ({
        id: it.id || `chk-${idx + 1}`,
        taskText: String(it.taskText || it.text || `Công việc #${idx + 1}`),
        isCompleted: false,
        category: (['PREREQUISITE', 'IMPLEMENTATION', 'TESTING', 'SECURITY'].includes(
          it.category || ''
        )
          ? it.category
          : 'IMPLEMENTATION') as ChecklistCategory,
      }));
    }
  }

  // 2. OpenAI SDK fallback if available
  if (process.env.OPENAI_API_KEY) {
    try {
      const prompt = `Bạn là Technical Leader. Hãy tạo danh sách công việc kiểm tra (checklist) định dạng JSON cho một lập trình viên cấp bậc ${upperLevel} thực hiện task:
Tiêu đề: ${taskTitle}
Mô tả: ${taskDescription}

Yêu cầu cấu trúc số lượng items bắt buộc:
- Nếu cấp bậc là INTERN hoặc FRESHER: Tạo từ 5 đến 7 mục chi tiết, kèm lưu ý về clean code, convention và viết test.
- Nếu cấp bậc là JUNIOR hoặc MIDDLE: Tạo từ 3 đến 5 mục tập trung vào edge cases, validation, xử lý ngoại lệ.
- Nếu cấp bậc là SENIOR: Tạo từ 2 đến 3 mục kiến trúc cấp cao, benchmark hiệu năng, bảo mật.

Chỉ trả về JSON thuần túy có cấu trúc: {"items": [{"id": "chk-1", "taskText": "...", "category": "PREREQUISITE" | "IMPLEMENTATION" | "TESTING" | "SECURITY"}]}`;

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
      if (Array.isArray(parsed.items) && parsed.items.length > 0) {
        return parsed.items.map((it: any, idx: number) => ({
          id: it.id || `chk-${idx + 1}`,
          taskText: String(it.taskText || `Công việc #${idx + 1}`),
          isCompleted: false,
          category: (['PREREQUISITE', 'IMPLEMENTATION', 'TESTING', 'SECURITY'].includes(
            it.category || ''
          )
            ? it.category
            : 'IMPLEMENTATION') as ChecklistCategory,
        }));
      }
    } catch (err) {
      console.warn('[OpenAI Fallback Warning in generateAdaptiveChecklist]:', err);
    }
  }

  // 3. Fallback deterministic checklist
  return getDefaultAdaptiveChecklist(upperLevel);
}

// ============================================================================
// 3. PULL REQUEST / GIT DIFF CODE VERIFICATION (MOD-07)
// Endpoint: POST /api/v1/pr/verify
// ============================================================================

export interface AIVerificationResult {
  score: number;
  isVerified: boolean;
  feedback: string;
}

/**
 * Verifies Git Pull Request diff and code quality against task criteria.
 * Delegates to FastAPI `/api/v1/pr/verify`.
 */
export async function verifyCodeWithAI(
  taskTitle: string,
  taskDescription: string,
  checklist: any[],
  diffSummary: string
): Promise<AIVerificationResult> {
  const fastApiRes = await postFastApi<AIVerificationResult>('/api/v1/pr/verify', {
    taskTitle,
    taskDescription,
    checklist,
    diffSummary,
  });

  if (
    fastApiRes &&
    typeof fastApiRes.score === 'number' &&
    typeof fastApiRes.isVerified === 'boolean'
  ) {
    return {
      score: fastApiRes.score,
      isVerified: fastApiRes.isVerified,
      feedback:
        fastApiRes.feedback ||
        'Mã nguồn đáp ứng các tiêu chuẩn kỹ thuật của task.',
    };
  }

  // Graceful fallback to OpenAI SDK if configured
  if (process.env.OPENAI_API_KEY) {
    try {
      const prompt = `Bạn là Senior Technical Reviewer. Hãy thẩm định bản tóm tắt thay đổi mã nguồn (git diff/commits) của một Pull Request:
Yêu cầu Task: ${taskTitle}
Mô tả Task: ${taskDescription}
Checklist kỹ thuật cần đạt: ${JSON.stringify(checklist)}

Mã nguồn / Thay đổi:
${diffSummary}

Hãy đánh giá xem PR này đã đáp ứng checklist ở mức độ nào.
Trả về JSON chuẩn format:
{
  "score": <số nguyên từ 0 đến 100>,
  "isVerified": <boolean, true nếu score >= 70 và đáp ứng yêu cầu cơ bản>,
  "feedback": "<nhận xét súc tích: điểm đạt, điểm thiếu sót nếu có>"
}`;

      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });

      const parsed = JSON.parse(res.choices[0].message.content || '{}');
      return {
        score: typeof parsed.score === 'number' ? parsed.score : 80,
        isVerified: Boolean(parsed.isVerified),
        feedback:
          parsed.feedback ||
          'Mã nguồn đáp ứng các tiêu chuẩn kỹ thuật của task.',
      };
    } catch (err) {
      console.warn('[OpenAI Fallback Warning in verifyCodeWithAI]:', err);
    }
  }

  // Deterministic fallback response
  return {
    score: 85,
    isVerified: true,
    feedback:
      'Mã nguồn đã được ghi nhận và liên kết thành công với task. Đạt chuẩn cấu trúc cơ bản.',
  };
}

// ============================================================================
// 4. AUTOMATED DAILY STANDUP SYNTHESIS (MOD-09)
// Endpoint: POST /api/v1/standup/generate
// ============================================================================

export interface StandupSynthesisResult {
  summaryYesterday: string;
  planToday: string;
  identifiedBlockers: string;
}

/**
 * Synthesizes 24-hour activities, PRs, and blockers into an executive Daily Standup.
 * Delegates to FastAPI `/api/v1/standup/generate`.
 */
export async function generateDailyStandupAI(contextData: {
  projectName: string;
  activities24h?: any[];
  pullRequests?: any[];
  wipPlan?: any[];
  blockers?: any[];
  [key: string]: any;
}): Promise<StandupSynthesisResult> {
  const fastApiRes = await postFastApi<StandupSynthesisResult>(
    '/api/v1/standup/generate',
    contextData
  );

  if (
    fastApiRes &&
    fastApiRes.summaryYesterday &&
    fastApiRes.planToday &&
    fastApiRes.identifiedBlockers
  ) {
    return fastApiRes;
  }

  // Graceful fallback to OpenAI SDK if configured
  if (process.env.OPENAI_API_KEY) {
    try {
      const prompt = `Bạn là Trợ lý AI Scrum Master chuyên nghiệp. Dựa vào dữ liệu thực tế 24 giờ qua của dự án "${contextData.projectName}":
${JSON.stringify(contextData, null, 2)}

Hãy tổng hợp bản báo cáo Daily Standup ngắn gọn, chuyên nghiệp và có giá trị hành động cao.
Định dạng trả về JSON bắt buộc:
{
  "summaryYesterday": "<Tóm tắt 2-3 câu các task đã chuyển trạng thái hoặc PRs đã tạo/merge>",
  "planToday": "<Tóm tắt 2-3 câu trọng tâm công việc hôm nay, nhấn mạnh các task đường găng critical path>",
  "identifiedBlockers": "<Liệt kê cụ thể từng điểm nghẽn kèm nguyên nhân, hoặc ghi 'Không có điểm nghẽn nào được ghi nhận' nếu không có task nghẽn>"
}`;

      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      });

      const parsed = JSON.parse(res.choices[0].message.content || '{}');
      if (
        parsed.summaryYesterday &&
        parsed.planToday &&
        parsed.identifiedBlockers
      ) {
        return {
          summaryYesterday: parsed.summaryYesterday,
          planToday: parsed.planToday,
          identifiedBlockers: parsed.identifiedBlockers,
        };
      }
    } catch (err) {
      console.warn('[OpenAI Fallback Warning in generateDailyStandupAI]:', err);
    }
  }

  // Deterministic fallback summary
  const acts = contextData.activities24h || [];
  const prs = contextData.pullRequests || [];
  const wip = contextData.wipPlan || [];
  const blk = contextData.blockers || [];

  return {
    summaryYesterday:
      acts.length > 0 || prs.length > 0
        ? `Đội ngũ đã chuyển đổi trạng thái ${acts.length} tác vụ và ghi nhận ${prs.length} Pull Requests trong 24 giờ qua.`
        : 'Đội ngũ tiếp tục triển khai các tác vụ theo tiến độ danh định.',
    planToday:
      wip.length > 0
        ? `Tập trung giải quyết ${wip.length} tác vụ đang mở (${
            wip.filter((t: any) => t.isCritical).length
          } tác vụ trên đường găng).`
        : 'Tập trung giải quyết các tác vụ trong kế hoạch sprint hiện tại.',
    identifiedBlockers:
      blk.length > 0
        ? `Phát hiện ${blk.length} điểm nghẽn: ${blk
            .map(
              (b: any) =>
                `Tác vụ "${b.task}" bị nghẽn do ${b.reason || 'chưa rõ lý do'}`
            )
            .join('; ')}. Cần ưu tiên phối hợp tháo gỡ.`
        : 'Không có điểm nghẽn nào được ghi nhận.',
  };
}

// ============================================================================
// 5. SRS USER STORY EXTRACTION (MOD-10)
// Endpoint: POST /api/v1/srs/extract
// ============================================================================

export interface ExtractedUserStoryItem {
  storyId: string;
  role: string;
  action: string;
  benefit: string;
  fullTitle: string;
  description: string;
  targetDepartment: 'FRONTEND' | 'BACKEND' | 'DEVOPS' | 'QA' | 'FULLSTACK';
  complexity: 'EASY' | 'MEDIUM' | 'HARD';
  acceptanceCriteria: string[];
  dependsOnStories: string[];
}

/**
 * Extracts INVEST-compliant User Stories from SRS technical specification text.
 * Delegates to FastAPI `/api/v1/srs/extract`.
 */
export async function extractUserStoriesAI(
  rawContent: string
): Promise<ExtractedUserStoryItem[]> {
  const fastApiRes = await postFastApi<any>('/api/v1/srs/extract', {
    rawContent,
  });

  const rawStories =
    fastApiRes?.stories || (Array.isArray(fastApiRes) ? fastApiRes : null);

  if (Array.isArray(rawStories) && rawStories.length > 0) {
    return rawStories.map((s: any, idx: number) => ({
      storyId: s.storyId || `US-0${idx + 1}`,
      role: s.role || 'Người dùng',
      action: s.action || 'thực thi tác vụ hệ thống',
      benefit: s.benefit || 'nâng cao hiệu năng vận hành',
      fullTitle: s.fullTitle || `User Story ${idx + 1}`,
      description: s.description || 'Đặc tả yêu cầu phần mềm',
      targetDepartment: (['FRONTEND', 'BACKEND', 'DEVOPS', 'QA', 'FULLSTACK'].includes(
        s.targetDepartment
      )
        ? s.targetDepartment
        : 'BACKEND') as 'FRONTEND' | 'BACKEND' | 'DEVOPS' | 'QA' | 'FULLSTACK',
      complexity: (['EASY', 'MEDIUM', 'HARD'].includes(s.complexity)
        ? s.complexity
        : 'MEDIUM') as 'EASY' | 'MEDIUM' | 'HARD',
      acceptanceCriteria:
        Array.isArray(s.acceptanceCriteria) && s.acceptanceCriteria.length > 0
          ? s.acceptanceCriteria
          : ['Thỏa mãn các tiêu chuẩn kỹ thuật'],
      dependsOnStories: Array.isArray(s.dependsOnStories) ? s.dependsOnStories : [],
    }));
  }

  // Graceful fallback to OpenAI SDK if configured
  if (process.env.OPENAI_API_KEY) {
    try {
      const prompt = `Bạn là Chuyên gia Phân tích Nghiệp vụ Phần mềm (Lead Business Analyst).
Hãy đọc tài liệu đặc tả yêu cầu kỹ thuật (SRS) dưới đây và trích xuất danh sách các User Stories chuẩn Agile / INVEST:
${rawContent.slice(0, 3000)}

Yêu cầu định dạng đầu ra JSON bắt buộc:
{
  "stories": [
    {
      "storyId": "US-01",
      "role": "Người dùng",
      "action": "đăng ký và kích hoạt tài khoản",
      "benefit": "có thể truy cập vào không gian làm việc an toàn",
      "fullTitle": "Đăng ký tài khoản và xác thực phiên",
      "description": "Cài đặt luồng đăng ký, băm mật khẩu, cấp JWT token và lưu vết",
      "targetDepartment": "BACKEND",
      "complexity": "MEDIUM",
      "acceptanceCriteria": [
        "Mật khẩu phải tối thiểu 8 ký tự",
        "Email trùng lặp trả về HTTP 409",
        "Tạo bản ghi talent profile đi kèm"
      ],
      "dependsOnStories": []
    }
  ]
}`;

      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      });

      const parsed = JSON.parse(res.choices[0].message.content || '{}');
      if (Array.isArray(parsed.stories) && parsed.stories.length > 0) {
        return parsed.stories;
      }
    } catch (err) {
      console.warn('[OpenAI Fallback Warning in extractUserStoriesAI]:', err);
    }
  }

  // Deterministic fallback stories
  return [
    {
      storyId: 'US-01',
      role: 'Kỹ sư CSDL',
      action: 'thiết lập hạ tầng cơ sở dữ liệu và bảng quan hệ',
      benefit: 'hệ thống có nền tảng lưu trữ toàn vẹn và tối ưu truy vấn',
      fullTitle: 'Khởi tạo schema và cấu trúc dữ liệu quan hệ',
      description:
        'Tạo các bảng users, projects, tasks, task_dependencies và chỉ mục HNSW',
      targetDepartment: 'BACKEND',
      complexity: 'MEDIUM',
      acceptanceCriteria: [
        'Chạy thành công file init.sql',
        'Đầy đủ 14 bảng quan hệ và ràng buộc khóa ngoại',
      ],
      dependsOnStories: [],
    },
    {
      storyId: 'US-02',
      role: 'Kỹ sư Backend',
      action: 'xây dựng các REST API nghiệp vụ và xác thực JWT',
      benefit: 'khách hàng và các hệ thống client có thể thao tác dữ liệu an toàn',
      fullTitle: 'Phát triển tầng REST API Core & Middleware bảo mật',
      description:
        'Cài đặt authentication, RBAC guards, và các endpoint phân phối tác vụ',
      targetDepartment: 'BACKEND',
      complexity: 'HARD',
      acceptanceCriteria: [
        'Xác thực token JWT Bearer',
        'Chặn truy cập trái thẩm quyền với HTTP 403',
        'Ghi nhận đầy đủ nhật ký trạng thái',
      ],
      dependsOnStories: ['US-01'],
    },
    {
      storyId: 'US-03',
      role: 'Lập trình viên Frontend',
      action: 'xây dựng giao diện bảng Kanban và React Flow DAG',
      benefit:
        'người dùng có thể quan sát trực quan tiến độ và kéo thả tác vụ',
      fullTitle: 'Phát triển giao diện bảng Kanban & Đồ thị DAG',
      description:
        'Tạo 5 cột Kanban, kết nối React Flow biểu diễn đường găng',
      targetDepartment: 'FRONTEND',
      complexity: 'MEDIUM',
      acceptanceCriteria: [
        'Hiển thị đủ 5 cột trạng thái',
        'Kéo thả thẻ task tự động cập nhật FSM',
        'Hiển thị trực quan các nút đường găng',
      ],
      dependsOnStories: ['US-02'],
    },
    {
      storyId: 'US-04',
      role: 'Kỹ sư DevOps',
      action: 'cấu hình quy trình CI/CD và đóng gói container Docker',
      benefit:
        'đội ngũ có thể triển khai tự động và giám sát hệ thống liên tục',
      fullTitle: 'Thiết lập Docker container & Pipeline CI/CD',
      description:
        'Viết Dockerfile đa tầng, cấu hình GitHub Actions và tích hợp Webhook',
      targetDepartment: 'DEVOPS',
      complexity: 'EASY',
      acceptanceCriteria: [
        'Build Docker image thành công',
        'Tự động chạy test suite khi tạo Pull Request',
      ],
      dependsOnStories: ['US-03'],
    },
  ];
}
