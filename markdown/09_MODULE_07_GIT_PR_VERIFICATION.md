# AI SPECIFICATION PROMPT: MOD-07 (GIT WEBHOOK & AI PR VERIFICATION ENGINE)

> **Mã mô-đun:** `MOD-07` (Tầng 3: Vận hành Tác vụ & Giám sát Dòng chảy).
> **Mục tiêu:** Xây dựng hoàn chỉnh tầng Backend API tiếp nhận Git Webhook (GitHub/GitLab Pull Request events) và Động cơ Thẩm định Mã nguồn Tự động bằng AI (AI PR Verification Engine). Tự động trích xuất thông tin PR, kiểm tra chữ ký xác thực bảo mật HMAC SHA-256 (`x-hub-signature-256`), trích xuất `taskId` từ tên nhánh (branch convention) hoặc nội dung PR, gọi OpenAI (`gpt-4o-mini`) phân tích mã nguồn (`git diff`) đối chiếu với checklist kỹ thuật của task, tự động chuyển trạng thái task sang `REVIEW` trong FSM và lưu vết vào bảng `git_pull_requests`.
> 
> 
> **Môi trường:** Next.js 14+ (App Router), TypeScript, Prisma ORM, PostgreSQL 16 (14 bảng DDL chuẩn), OpenAI SDK (`gpt-4o-mini`), Crypto native, Zod validation.
> 
> 

---

## 1. NGUYÊN TẮC GIẢI THUẬT & TOÁN HỌC CỐT LÕI (MANDATORY ALGORITHMS)

Module 7 kết nối luồng công việc kỹ thuật thực tế với hệ thống quản trị thông minh. AI Assistant bắt buộc phải cài đặt chính xác các quy chuẩn sau:

### 1.1. Xác Thực Chữ Ký Webhook HMAC SHA-256 (Security Signature Verification)

Để ngăn chặn tấn công giả mạo payload (Spoofing Attack), mọi request gửi đến webhook endpoint bắt buộc phải được xác thực chữ ký số:


$$\text{Signature}_{\text{expected}} = \text{"sha256="} + \text{HMAC-SHA256}(\text{rawBody}, \text{WEBHOOK\_SECRET})$$

* So sánh chuỗi nhị phân an toàn bằng `crypto.timingSafeEqual` để chống tấn công phân tích thời gian (Timing Attacks).
* Nếu chữ ký không khớp $\to$ lập tức trả về HTTP 401 Unauthorized và từ chối xử lý.

### 1.2. Quy Ước Bóc Tách Định Danh Tác Vụ (Task Identifier Extraction)

Hệ thống tự động liên kết PR với `taskId` thông qua biểu thức chính quy (Regex Pattern Matching):

* **Ưu tiên 1 (Tên nhánh - Branch Name):** Nhánh theo quy chuẩn:
* `feat/task-<UUID>` hoặc `feature/<UUID>` hoặc `fix/<UUID>`


* **Ưu tiên 2 (Tiêu đề PR - PR Title/Body):** Cú pháp:
* `[TASK-<UUID>]` hoặc `Closes #<UUID>` hoặc `Refs <UUID>`


* Nếu không tìm thấy UUID hợp lệ trong CSDL $\to$ ghi log cảnh báo và trả về HTTP 200 (bỏ qua không lỗi để Git Webhook không thử lại liên tục).

### 1.3. Thẩm Định Mã Nguồn Bằng AI (AI Code & Checklist Verification)

Khi PR ở trạng thái `opened` hoặc `synchronize` (push code mới):

1. Hệ thống đọc `checklist` hiện tại của task từ CSDL (mảng các mục tiêu kỹ thuật sinh từ MOD-04).
2. Đọc bản tóm tắt thay đổi mã nguồn (`diff_summary` hoặc danh sách commit).
3. Gửi prompt có cấu trúc sang `gpt-4o-mini` để đánh giá:
* **Score $\in [0, 100]$:** Điểm số tuân thủ yêu cầu và chất lượng mã nguồn.
* **Verified (`true`/`false`):** Đạt tiêu chuẩn nếu $\text{Score} \ge 70/100$ và không vi phạm quy chuẩn an toàn.
* **Feedback:** Nhận xét kỹ thuật ngắn gọn, chỉ ra những tiêu chí checklist nào đã đạt và chưa đạt.


4. **Tự Động Kích Hoạt FSM Transition (MOD-05):**
* Nếu task đang ở trạng thái `IN_PROGRESS` $\to$ chuyển tự động sang `REVIEW`, gán `in_review_at = NOW()` và ghi vết vào `task_status_history`.





---

## 2. PHẠM VI TỆP TIN TRIỂN KHAI

AI Assistant triển khai mã nguồn vào đúng các tệp tin sau:

* `src/types/git.types.ts`: Định nghĩa TypeScript interfaces và Zod Schemas cho GitHub/GitLab Webhook Payload, PR Verification DTO.
* `src/lib/webhook-signature.ts`: Hàm kiểm tra chữ ký HMAC SHA-256 an toàn bằng `crypto`.
* `src/services/git-verification.service.ts`: Xử lý phân tích PR, bóc tách UUID task, gọi OpenAI thẩm định và chạy Prisma Transaction cập nhật CSDL.


* `src/app/api/webhooks/github/route.ts`: Endpoint `POST` công khai tiếp nhận webhook từ GitHub (nằm trong whitelist middleware không chặn token).
* `src/app/api/tasks/[taskId]/pull-requests/route.ts`: Endpoint `GET` lấy danh sách các PR liên kết với task kèm đánh giá và phản hồi của AI.

---

## 3. CHI TIẾT KỸ THUẬT CÁC TỆP TIN CỐT LÕI

### 3.1. `src/lib/webhook-signature.ts`

```typescript
import crypto from "crypto";

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const expectedSignature = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex")}`;

  const headerBuffer = Buffer.from(signatureHeader, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (headerBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(headerBuffer, expectedBuffer);
}

```

### 3.2. `src/types/git.types.ts`

```typescript
import { z } from "zod";

export const GithubWebhookPayloadSchema = z.object({
  action: z.enum(["opened", "reopened", "closed", "synchronize"]).optional(),
  pull_request: z.object({
    number: z.number(),
    html_url: z.string().url(),
    title: z.string(),
    body: z.string().nullable().optional(),
    head: z.object({
      ref: z.string(), // Branch name
    }),
    user: z.object({
      login: z.string(),
    }),
    merged: z.boolean().optional().default(false),
    merged_at: z.string().nullable().optional(),
  }),
});

export interface AIVerificationResult {
  score: number;
  isVerified: boolean;
  feedback: string;
}

export interface GitPRDto {
  id: string;
  taskId: string;
  prNumber: number;
  prUrl: string;
  branchName: string;
  authorGithubUsername: string;
  diffSummary: string | null;
  aiVerificationFeedback: string | null;
  isVerifiedByAi: boolean;
  status: string;
  mergedAt: string | null;
  createdAt: string;
}

```

### 3.3. `src/services/git-verification.service.ts`

```typescript
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";
import { AIVerificationResult } from "@/types/git.types";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "dummy-key-for-build",
  timeout: 8000,
});

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function extractTaskId(branchName: string, title: string, body?: string | null): string | null {
  const matchBranch = branchName.match(UUID_REGEX);
  if (matchBranch) return matchBranch[0].toLowerCase();

  const matchTitle = title.match(UUID_REGEX);
  if (matchTitle) return matchTitle[0].toLowerCase();

  if (body) {
    const matchBody = body.match(UUID_REGEX);
    if (matchBody) return matchBody[0].toLowerCase();
  }

  return null;
}

export async function verifyCodeWithAI(
  taskTitle: string,
  taskDescription: string,
  checklist: any[],
  diffSummary: string
): Promise<AIVerificationResult> {
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

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const parsed = JSON.parse(res.choices[0].message.content || "{}");
    return {
      score: parsed.score || 0,
      isVerified: Boolean(parsed.isVerified),
      feedback: parsed.feedback || "Không có phản hồi chi tiết từ AI.",
    };
  } catch (err) {
    console.error("[AI PR Verification Error]:", err);
    return {
      score: 50,
      isVerified: false,
      feedback: "Lỗi kết nối AI Thẩm định. Vui lòng Leader kiểm tra thủ công.",
    };
  }
}

export async function handlePullRequestEvent(payload: any, diffSummary: string) {
  const pr = payload.pull_request;
  const taskId = extractTaskId(pr.head.ref, pr.title, pr.body);

  if (!taskId) {
    console.warn(`[GitWebhook] Không tìm thấy Task ID hợp lệ trong PR #${pr.number} (branch: ${pr.head.ref})`);
    return { skipped: true, reason: "NO_TASK_ID_FOUND" };
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, title: true, description: true, status: true, checklist: true, projectId: true },
  });

  if (!task) {
    console.warn(`[GitWebhook] Task ID ${taskId} không tồn tại trong CSDL[cite: 2]`);
    return { skipped: true, reason: "TASK_NOT_FOUND" };
  }

  // 1. Phân tích mã nguồn bằng AI
  const aiResult = await verifyCodeWithAI(
    task.title,
    task.description,
    Array.isArray(task.checklist) ? task.checklist : [],
    diffSummary || pr.title
  );

  // 2. Mở Transaction cập nhật CSDL
  await prisma.$transaction(async (tx) => {
    // Lưu hoặc cập nhật thông tin PR
    const existingPR = await tx.gitPullRequest.findFirst({
      where: { taskId: task.id, prNumber: pr.number },
    });

    const prStatus = pr.merged ? "MERGED" : payload.action === "closed" ? "CLOSED" : "OPEN";

    if (existingPR) {
      await tx.gitPullRequest.update({
        where: { id: existingPR.id },
        data: {
          diffSummary: diffSummary || existingPR.diffSummary,
          aiVerificationFeedback: aiResult.feedback,
          isVerifiedByAi: aiResult.isVerified,
          status: prStatus,
          mergedAt: pr.merged_at ? new Date(pr.merged_at) : existingPR.mergedAt,
        },
      });
    } else {
      await tx.gitPullRequest.create({
        data: {
          taskId: task.id,
          prNumber: pr.number,
          prUrl: pr.html_url,
          branchName: pr.head.ref,
          authorGithubUsername: pr.user.login,
          diffSummary: diffSummary || "Initial commit diff",
          aiVerificationFeedback: aiResult.feedback,
          isVerifiedByAi: aiResult.isVerified,
          status: prStatus,
          mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
        },
      });
    }

    // 3. Tự động chuyển trạng thái Task sang REVIEW nếu đang IN_PROGRESS
    if (task.status === "IN_PROGRESS" && prStatus === "OPEN") {
      await tx.task.update({
        where: { id: task.id },
        data: {
          status: "REVIEW",
          inReviewAt: new Date(),
        },
      });

      await tx.taskStatusHistory.create({
        data: {
          taskId: task.id,
          fromStatus: "IN_PROGRESS",
          toStatus: "REVIEW",
          durationInPreviousStatusHours: 0,
        },
      });
    }
  });

  return { success: true, taskId: task.id, aiResult };
}

```

### 3.4. `src/app/api/webhooks/github/route.ts`

1. Đọc header `x-hub-signature-256`.
2. Đọc raw body của request dạng `text()`.
3. Kiểm tra chữ ký HMAC SHA-256 qua hàm `verifyWebhookSignature`. Nếu sai hoặc thiếu secret $\to$ trả HTTP 401 Unauthorized.
4. Parse JSON payload qua `GithubWebhookPayloadSchema`.
5. Bỏ qua các sự kiện không phải Pull Request hoặc các action không quan tâm (chỉ xử lý `opened`, `synchronize`, `closed`, `reopened`).
6. Trích xuất `diff_summary` (từ payload hoặc giả lập commit messages).
7. Gọi `handlePullRequestEvent(payload, diffSummary)`.
8. Trả về HTTP 200 OK: `{ success: true, message: "Webhook processed successfully" }`.

### 3.5. `src/app/api/tasks/[taskId]/pull-requests/route.ts`

1. Đọc headers xác thực danh tính người dùng.
2. Query toàn bộ records trong bảng `git_pull_requests` có `taskId = taskId` sắp xếp theo `createdAt DESC`.


3. Trả về HTTP 200 OK: `{ success: true, data: { pullRequests: [...] } }`.

---

## 4. QUY TRÌNH KIỂM THỬ KHÁCH QUAN & CHỐNG ẢO GIÁC AI (MANDATORY ANTI-HALLUCINATION TEST)

> **CẢNH BÁO CHO AI ASSISTANT:**
> Hệ thống sẽ **từ chối nghiệm thu** nếu script test chỉ mock các giá trị cố định hoặc tự gọi các assertion vô nghĩa dạng `expect(true).toBe(true)`.
> Script kiểm thử bắt buộc phải thực thi qua HTTP Client thực tế và **truy vấn ngược vào PostgreSQL để so sánh giá trị vật lý (Ground Truth Verification)**.

File script kiểm thử phải được đặt tại: **`test/mod-07-git.test.ts`** và phải thỏa mãn 5 bài test nghiêm ngặt sau:

* **TEST-01 (Chặn Webhook Sai Chữ Ký HMAC SHA-256):**
* Gửi request POST đến `/api/webhooks/github` với chữ ký giả mạo hoặc sai secret.
* Khẳng định: API trả về đúng mã HTTP 401 Unauthorized.


* **TEST-02 (Xác Thực Chữ Ký Đúng & Bóc Tách Task UUID Từ Branch):**
* Sinh chữ ký HMAC hợp lệ bằng `crypto.createHmac`. Gửi payload có nhánh `feat/task-<UUID-thật-trong-DB>`.
* Khẳng định: API trả về HTTP 200 OK và tìm đúng task.


* **TEST-03 (Tự Động Lưu Dữ Liệu Bảng `git_pull_requests`):**
* **Kiểm tra CSDL:** Chạy `SELECT pr_number, is_verified_by_ai, ai_verification_feedback FROM git_pull_requests WHERE task_id = ...`.


* Khẳng định: Bản ghi PR được tạo thành công, `pr_number` khớp với payload, và `ai_verification_feedback` không bị rỗng.




* **TEST-04 (Tự Động Kích Hoạt FSM Chuyển Trạng Thái IN_PROGRESS -> REVIEW):**
* Khởi tạo task ở trạng thái `IN_PROGRESS` trước khi gửi Webhook PR.


* Sau khi Webhook xử lý xong: Kiểm tra bảng `tasks`.


* Khẳng định: `tasks.status` tự động chuyển sang `REVIEW`, `in_review_at` khác NULL và bảng `task_status_history` ghi nhận bản ghi mới.




* **TEST-05 (Bỏ Qua An Toàn Khi PR Không Chứa Task ID):**
* Gửi PR có branch `fix/random-bug` không chứa UUID.
* Khẳng định: API vẫn trả về HTTP 200 OK nhưng không sinh bản ghi rác nào trong DB.



---

## 5. TIÊU CHÍ NGHIỆM THU ĐẦU RA (DEFINITION OF DONE - DOD)

* [ ] Lệnh `npx tsc --noEmit` chạy sạch 100% không có cảnh báo kiểu dữ liệu.
* [ ] Endpoint `/api/webhooks/github` được thêm vào whitelist trong `src/middleware.ts` (không bị chặn Bearer token).
* [ ] Bảng `git_pull_requests` ghi nhận đầy đủ liên kết giữa PR và Task.


* [ ] Task tự động chuyển sang `REVIEW` khi có PR mở tương ứng.


* [ ] Toàn bộ 5 bài test trong `test/mod-07-git.test.ts` vượt qua với kết quả đối soát DB thật.



---

