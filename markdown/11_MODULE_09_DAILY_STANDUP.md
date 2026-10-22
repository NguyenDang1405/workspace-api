# AI SPECIFICATION PROMPT: MOD-09 (AUTOMATED DAILY STANDUP ENGINE)

> **Mã mô-đun:** `MOD-09` (Tầng 3: Vận hành Tác vụ & Giám sát Dòng chảy).
> **Mục tiêu:** Xây dựng hoàn chỉnh tầng Backend API cho Động cơ Báo cáo Daily Standup Tự động (Automated Daily Standup & Team Intelligence Engine). Tự động thu thập các thay đổi trạng thái tác vụ từ `task_status_history`, mã nguồn và PR từ `git_pull_requests`, cùng các task bị nghẽn (`is_blocked = true`) trong 24 giờ qua; gọi OpenAI (`gpt-4o-mini`) tổng hợp thành bản tóm tắt điều hành súc tích theo 3 câu hỏi Agile kinh điển; tự động trích xuất các chỉ số dòng chảy thời gian thực (WIP, Throughput, Lead Time) đưa vào trường `flow_metrics` và lưu vào bảng `daily_standup_reports` với ràng buộc duy nhất `(project_id, report_date)`.
> 
> 
> **Môi trường:** Next.js 14+ (App Router), TypeScript, Prisma ORM, PostgreSQL 16 (14 bảng DDL chuẩn), OpenAI SDK (`gpt-4o-mini`), Zod validation.
> 
> 

---

## 1. NGUYÊN TẮC GIẢI THUẬT & TRÍ TUỆ NHÂN TẠO CỐT LÕI (MANDATORY ALGORITHMS)

Module 9 hoạt động như một Trợ lý Scrum Master thông minh. AI Assistant bắt buộc phải cài đặt chính xác các quy trình và logic nghiệp vụ sau:

### 1.1. Thu Thập Dữ Liệu Thực Nghiệm 24 Giờ (Evidence-Based Activity Mining)

Bản tóm tắt standup không được sinh ngẫu nhiên mà phải dựa trên bằng chứng dữ liệu có thật trong CSDL trong khoảng thời gian từ $(T_{\text{now}} - 24\text{h})$ đến $T_{\text{now}}$:

1. **Hoạt động hôm qua (Yesterday Evidence):**
* Các task chuyển sang `DONE` hoặc `REVIEW` trong 24h qua từ bảng `task_status_history`.


* Các PR được tạo hoặc gộp (`MERGED`) từ bảng `git_pull_requests`.




2. **Kế hoạch hôm nay (Today Evidence):**
* Các task đang ở trạng thái `IN_PROGRESS` hoặc `TODO` đã được gán người.


* Ưu tiên các task nằm trên đường găng (`is_critical_path = true`) cần hoàn thành gấp.




3. **Các điểm nghẽn & rủi ro (Blockers & Impediments):**
* Các task có `is_blocked = true` kèm theo lý do `block_reason`.


* Các task vượt ngưỡng thời gian IQR (nhận diện từ MOD-05).
* Các sự kiện tái lập lịch phát sinh trong ngày từ `rescheduling_events`.





### 1.2. Tổng Hợp Đa Góc Nhìn Bằng LLM (Structured Standup Synthesis)

Dữ liệu thô thu thập được sẽ được chuẩn hóa thành JSON ngữ cảnh và chuyển tới `gpt-4o-mini` với nhiệt độ thấp ($T = 0.2$) để sinh văn bản điều hành chuẩn mực:

* `summaryYesterday`: Tóm tắt các đầu việc đã đạt được, đóng góp của các thành viên, các PR đã merge.


* `planToday`: Danh sách trọng tâm cần làm hôm nay, đặc biệt nhấn mạnh các task đường găng.


* `identifiedBlockers`: Nhận diện rõ ai đang bị nghẽn ở đâu, nguyên nhân là gì và đề xuất hành động tháo gỡ cụ thể.



### 1.3. Tính Toàn Vẹn Snapshot Số Liệu Dòng Chảy (`flow_metrics`)

Cùng với văn bản tóm tắt, hệ thống chụp lại (snapshot) toàn bộ trạng thái dòng chảy của dự án tại thời điểm tạo báo cáo đưa vào trường `flow_metrics` (`JSONB`):

```json
{
  "activeWip": 4,
  "completedLast24h": 2,
  "blockedTasksCount": 1,
  "criticalPathRemainingHours": 45.0,
  "burnRateAlert": false
}

```

### 1.4. Đảm Bảo Tính Bất Biến Theo Ngày (Idempotent Daily Reporting)

* Bảng `daily_standup_reports` có ràng buộc duy nhất: `CONSTRAINT uq_project_standup_date UNIQUE (project_id, report_date)`.


* Nếu trong ngày hôm đó đã có báo cáo: Hệ thống cho phép cập nhật lại (`UPSERT`) nội dung mới nhất mà không tạo thêm dòng rác trong cơ sở dữ liệu.

---

## 2. PHẠM VI TỆP TIN TRIỂN KHAI

AI Assistant triển khai mã nguồn vào đúng các tệp tin sau:

* `src/types/standup.types.ts`: Định nghĩa Zod Schemas và TypeScript interfaces cho Standup Generation Request, Report Response DTO, Flow Snapshot.
* `src/services/standup-generator.service.ts`: Thu thập dữ liệu hoạt động 24h từ các bảng CSDL, gọi OpenAI sinh báo cáo và tính toán `flow_metrics`.


* `src/app/api/projects/[id]/standup/route.ts`: Endpoint `GET` lấy báo cáo của ngày chỉ định hoặc ngày hôm nay; endpoint `POST` kích hoạt tự động sinh báo cáo Standup cho dự án (có xử lý UPSERT).



---

## 3. CHI TIẾT KỸ THUẬT CÁC TỆP TIN CỐT LÕI

### 3.1. `src/types/standup.types.ts`

```typescript
import { z } from "zod";

export const GenerateStandupSchema = z.object({
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Định dạng ngày phải là YYYY-MM-DD").optional(),
  forceRegenerate: z.boolean().default(false),
});

export interface FlowMetricsSnapshot {
  activeWip: number;
  completedLast24h: number;
  blockedTasksCount: number;
  criticalPathRemainingHours: number;
  openPRsCount: number;
}

export interface StandupReportDto {
  id: string;
  projectId: string;
  reportDate: string;
  summaryYesterday: string;
  planToday: string;
  identifiedBlockers: string;
  flowMetrics: FlowMetricsSnapshot;
  createdAt: string;
}

```

### 3.2. `src/services/standup-generator.service.ts`

```typescript
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";
import { FlowMetricsSnapshot, StandupReportDto } from "@/types/standup.types";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "dummy-key-for-build",
  timeout: 8000,
});

export async function generateDailyStandupForProject(
  projectId: string,
  targetDateStr?: string
): Promise<StandupReportDto> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });

  if (!project) throw new Error("PROJECT_NOT_FOUND");

  const now = targetDateStr ? new Date(targetDateStr) : new Date();
  const reportDateOnly = new Date(now.toISOString().split("T")[0]);
  const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // 1. Thu thập dữ liệu hoạt động 24h qua
  const [recentStatusHistory, recentPRs, activeTasks, blockedTasks] = await Promise.all([
    // Lịch sử đổi trạng thái
    prisma.taskStatusHistory.findMany({
      where: {
        task: { projectId },
        createdAt: { gte: past24h },
      },
      include: {
        task: { select: { title: true, isCriticalPath: true } },
        actor: { select: { fullName: true } },
      },
    }),
    // PRs
    prisma.gitPullRequest.findMany({
      where: {
        task: { projectId },
        createdAt: { gte: past24h },
      },
      select: { prNumber: true, branchName: true, status: true, authorGithubUsername: true },
    }),
    // Tasks đang chạy
    prisma.task.findMany({
      where: {
        projectId,
        status: { in: ["TODO", "IN_PROGRESS", "REVIEW"] },
      },
      select: {
        title: true,
        status: true,
        isCriticalPath: true,
        estimatedHours: true,
        assignee: { select: { fullName: true } },
      },
    }),
    // Tasks bị nghẽn
    prisma.task.findMany({
      where: {
        projectId,
        isBlocked: true,
      },
      select: { title: true, blockReason: true, assignee: { select: { fullName: true } } },
    }),
  ]);

  // 2. Tính toán Flow Metrics Snapshot
  const completedIn24h = recentStatusHistory.filter((h) => h.toStatus === "DONE").length;
  const criticalHoursRemaining = activeTasks
    .filter((t) => t.isCriticalPath)
    .reduce((sum, t) => sum + Number(t.estimatedHours), 0);

  const flowMetrics: FlowMetricsSnapshot = {
    activeWip: activeTasks.length,
    completedLast24h: completedIn24h,
    blockedTasksCount: blockedTasks.length,
    criticalPathRemainingHours: Number(criticalHoursRemaining.toFixed(1)),
    openPRsCount: recentPRs.filter((p) => p.status === "OPEN").length,
  };

  // 3. Chuẩn bị ngữ cảnh cho LLM
  const contextData = {
    projectName: project.name,
    activities24h: recentStatusHistory.map((h) => ({
      task: h.task.title,
      from: h.fromStatus,
      to: h.toStatus,
      by: h.actor?.fullName || "Hệ thống",
      isCritical: h.task.isCriticalPath,
    })),
    pullRequests: recentPRs,
    wipPlan: activeTasks.map((t) => ({
      task: t.title,
      status: t.status,
      assignee: t.assignee?.fullName || "Chưa gán",
      isCritical: t.isCriticalPath,
    })),
    blockers: blockedTasks.map((b) => ({
      task: b.title,
      reason: b.blockReason || "Không nêu lý do",
      assignee: b.assignee?.fullName || "Chưa gán",
    })),
  };

  const prompt = `Bạn là Trợ lý AI Scrum Master chuyên nghiệp. Dựa vào dữ liệu thực tế 24 giờ qua của dự án "${project.name}":
${JSON.stringify(contextData, null, 2)}

Hãy tổng hợp bản báo cáo Daily Standup ngắn gọn, chuyên nghiệp và có giá trị hành động cao.
Định dạng trả về JSON bắt buộc:
{
  "summaryYesterday": "<Tóm tắt 2-3 câu các task đã chuyển trạng thái hoặc PRs đã tạo/merge>",
  "planToday": "<Tóm tắt 2-3 câu trọng tâm công việc hôm nay, nhấn mạnh các task đường găng critical path>",
  "identifiedBlockers": "<Liệt kê các điểm nghẽn hoặc ghi 'Không có điểm nghẽn nào được ghi nhận' nếu blockers rỗng>"
}`;

  let summaryYesterday = "Đội ngũ tiếp tục triển khai các tác vụ theo kế hoạch.";
  let planToday = "Tập trung giải quyết các tác vụ trong trạng thái IN_PROGRESS.";
  let identifiedBlockers = "Không có điểm nghẽn nào được ghi nhận.";

  try {
    const aiRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
    const parsed = JSON.parse(aiRes.choices[0].message.content || "{}");
    summaryYesterday = parsed.summaryYesterday || summaryYesterday;
    planToday = parsed.planToday || planToday;
    identifiedBlockers = parsed.identifiedBlockers || identifiedBlockers;
  } catch (err) {
    console.error("[Standup LLM Error]:", err);
  }

  // 4. Lưu hoặc Cập nhật vào CSDL (UPSERT theo project_id + report_date)
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
    reportDate: reportDateOnly.toISOString().split("T")[0],
    summaryYesterday: report.summaryYesterday,
    planToday: report.planToday,
    identifiedBlockers: report.identifiedBlockers,
    flowMetrics: report.flowMetrics as unknown as FlowMetricsSnapshot,
    createdAt: report.createdAt.toISOString(),
  };
}

```

### 3.3. `src/app/api/projects/[id]/standup/route.ts`

1. Đọc headers xác thực: Yêu cầu quyền `ADMIN`, `PM`, `LEADER`, hoặc `MEMBER` (tất cả thành viên trong nhóm đều có quyền xem báo cáo).
2. **Xử lý `GET`:**
* Đọc query param `date` (định dạng `YYYY-MM-DD`, mặc định là ngày hôm nay).
* Truy vấn bảng `daily_standup_reports` theo `projectId` và `reportDate`.


* Nếu chưa có báo cáo $\to$ trả về HTTP 404 (`code: "STANDUP_REPORT_NOT_FOUND"`).
* Nếu tìm thấy $\to$ trả về HTTP 200 OK kèm thông tin báo cáo.


3. **Xử lý `POST`:**
* Kiểm tra quyền: Chỉ `ADMIN`, `PM`, hoặc `LEADER` mới được bấm tạo/sinh lại báo cáo (Member bị chặn HTTP 403 Forbidden).
* Parse body qua `GenerateStandupSchema` (`reportDate`, `forceRegenerate`).
* Gọi hàm `generateDailyStandupForProject(projectId, payload.reportDate)`.
* Trả về HTTP 201 Created (hoặc 200 OK nếu cập nhật) kèm nội dung báo cáo hoàn chỉnh.





---

## 4. QUY TRÌNH KIỂM THỬ KHÁCH QUAN & CHỐNG ẢO GIÁC AI (MANDATORY ANTI-HALLUCINATION TEST)

> **CẢNH BÁO CHO AI ASSISTANT:**
> Hệ thống sẽ **từ chối nghiệm thu** nếu script test chỉ mock các giá trị cố định hoặc tự gọi các assertion vô nghĩa dạng `expect(true).toBe(true)`.
> Script kiểm thử bắt buộc phải thực thi qua HTTP Client thực tế và **truy vấn ngược vào PostgreSQL để so sánh giá trị vật lý (Ground Truth Verification)**.

File script kiểm thử phải được đặt tại: **`test/mod-09-standup.test.ts`** và phải thỏa mãn 5 bài test nghiêm ngặt sau:

* **TEST-01 (Tự Động Sinh Báo Cáo & Lưu Bảng `daily_standup_reports`):**
* Gọi `POST /api/projects/[id]/standup` để tạo báo cáo cho ngày hiện tại.


* **Kiểm tra CSDL:** Chạy `SELECT summary_yesterday, plan_today, identified_blockers, flow_metrics FROM daily_standup_reports WHERE project_id = ...`.


* Khẳng định: Các trường văn bản không bị rỗng, và trường `flow_metrics` lưu trữ đúng cấu trúc JSON.




* **TEST-02 (Kiểm Tra Tính Bất Biến Idempotent UPSERT):**
* Gọi `POST /api/projects/[id]/standup` lần thứ hai cho cùng một ngày.
* **Kiểm tra CSDL:** Chạy `SELECT COUNT(*) FROM daily_standup_reports WHERE project_id = ... AND report_date = CURRENT_DATE`.


* Khẳng định: Số lượng bản ghi trong DB bắt buộc vẫn bằng chính xác 1 (không bị sinh bản ghi trùng lặp).




* **TEST-03 (Phản Ánh Đúng Task Bị Nghẽn Trong Báo Cáo):**
* Tạo 1 task với `is_blocked = true` và `block_reason = "Thiếu API key bên thứ 3"`.


* Kích hoạt sinh lại Standup.
* Khẳng định: `flowMetrics.blockedTasksCount >= 1` và chuỗi `identifiedBlockers` trong phản hồi phải đề cập đến lý do nghẽn.




* **TEST-04 (Thành Viên Được Quyền Xem Báo Cáo GET):**
* Dùng token của `MEMBER` gọi `GET /api/projects/[id]/standup`.
* Khẳng định: Trả về HTTP 200 OK với đầy đủ nội dung báo cáo của dự án.


* **TEST-05 (Chặn Quyền Member Tự Ý Kích Hoạt Sinh Báo Cáo POST):**
* Dùng token của `MEMBER` gọi `POST /api/projects/[id]/standup`.
* Khẳng định: Nhận đúng mã HTTP 403 Forbidden.



---

## 5. TIÊU CHÍ NGHIỆM THU ĐẦU RA (DEFINITION OF DONE - DOD)

* [ ] Lệnh `npx tsc --noEmit` chạy sạch 100% không có cảnh báo kiểu dữ liệu.
* [ ] Bảng `daily_standup_reports` ghi nhận đúng dữ liệu văn bản và `flow_metrics` snapshot.


* [ ] Ràng buộc duy nhất `uq_project_standup_date` hoạt động chính xác qua cơ chế Prisma Upsert.


* [ ] Toàn bộ 5 bài test trong `test/mod-09-standup.test.ts` vượt qua với kết quả đối soát DB thật.

---


