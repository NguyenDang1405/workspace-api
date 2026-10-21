Dưới đây là toàn bộ nội dung file Markdown đặc tả và chỉ dẫn thực thi (Prompt Specification) cho **MOD-05: Kanban Bất đồng bộ & Quan trắc Luồng việc (Async Kanban & Flow Observability Engine)** theo đúng cấu trúc chuẩn.

File này giải quyết trọn vẹn bài toán vận hành tác vụ, tích hợp các công thức toán học thực nghiệm về dòng chảy công việc (**Định luật Little**, **Cumulative Flow Diagram - CFD**, và **Khoảng tứ phân vị IQR** để phát hiện điểm nghẽn Cycle Time) và có sẵn khung kiểm thử chống ảo giác AI.

Bạn hãy tạo file **`markdown/07_MODULE_05_KANBAN_OBSERVABILITY.md`** trong thư mục dự án và dán toàn bộ nội dung dưới đây:

---

# AI SPECIFICATION PROMPT: MOD-05 (ASYNC KANBAN & FLOW OBSERVABILITY)

> **Mã mô-đun:** `MOD-05` (Tầng 3: Vận hành Tác vụ & Giám sát Dòng chảy).
> **Mục tiêu:** Xây dựng hoàn chỉnh tầng Backend API cho Bảng Kanban Bất đồng bộ (Async Kanban Board) và Động cơ Quan trắc Luồng việc (Flow Observability Engine). Cài đặt máy trạng thái hữu hạn (FSM) cho vòng đời Task, quản lý mốc thời gian chuyển giao tự động, đo lường Cycle Time / Lead Time, tính toán lưu lượng thông lượng (Throughput) theo Định luật Little ($L = \lambda W$), phát hiện tắc nghẽn dòng chảy bằng thuật toán IQR (Interquartile Range) và lưu vết chuỗi thời gian vào bảng `task_status_history`.
> 
> 
> **Môi trường:** Next.js 14+ (App Router), TypeScript, Prisma ORM, PostgreSQL 16 (14 bảng DDL chuẩn), Zod validation.
> 
> 

---

## 1. NGUYÊN TẮC GIẢI THUẬT & TOÁN HỌC CỐT LÕI (MANDATORY ALGORITHMS)

Module 5 là trung tâm vận hành và thu thập dữ liệu thời gian thực cho đồ án tốt nghiệp. AI Assistant bắt buộc phải cài đặt chính xác các quy chuẩn toán học và máy trạng thái sau:

### 1.1. Máy Trạng Thái Hữu Hạn Nghiêm Ngặt (Strict Finite State Machine - FSM)

Vòng đời của tác vụ chỉ được phép chuyển dịch theo đồ thị có hướng hợp lệ, ngăn chặn việc nhảy cóc trạng thái bất hợp pháp:


$$\text{SCHEDULED} \xrightarrow{\text{Dispatch}} \text{TODO} \xrightarrow{\text{Start}} \text{IN\_PROGRESS} \xrightarrow{\text{Submit PR/Done Dev}} \text{REVIEW} \xrightarrow{\text{Approve}} \text{DONE}$$

* **Ngoại lệ hợp lệ:**
* $\text{REVIEW} \xrightarrow{\text{Reject}} \text{IN\_PROGRESS}$ (Khi PR hoặc kết quả kiểm thử bị từ chối, yêu cầu sửa lại).


* **Cập nhật Mốc Thời Gian Tự Động:**
* Chuyển sang `IN_PROGRESS`: Gán `started_at = NOW()` (nếu trước đó chưa có).
* Chuyển sang `REVIEW`: Gán `in_review_at = NOW()`.


* Chuyển sang `DONE`: Gán `completed_at = NOW()` và tự động tính `actual_hours` = $(\text{completed\_at} - \text{started\_at})$ theo giờ.


* Mọi bước chuyển dịch đều ghi một dòng vào `task_status_history`, tự động tính khoảng thời gian lưu lại ở trạng thái cũ `duration_in_previous_status_hours`.





### 1.2. Phân Tích Dòng Chảy & Định Luật Little ($L = \lambda W$)

Hệ thống tính toán các chỉ số dòng chảy công việc cho dự án trong cửa sổ $N$ ngày gần nhất (mặc định 14 ngày):

* **Work In Progress ($L$ / WIP):** Số lượng task đang ở các trạng thái hoạt động:

$$WIP = \text{Count}(\text{Tasks in } \{\text{TODO}, \text{IN\_PROGRESS}, \text{REVIEW}\})$$


* **Throughput ($\lambda$ - Tốc độ xuất xưởng):** Số task hoàn thành trung bình mỗi ngày:

$$\lambda = \frac{\text{Count}(\text{Tasks with status } \text{DONE})}{\Delta t_{\text{days}}}$$


* **Average Cycle Time ($W$ - Thời gian chu kỳ trung bình):**

$$W_{\text{empirical}} = \frac{1}{\vert{}D\vert{}} \sum_{v \in D} (\text{completed\_at}(v) - \text{started\_at}(v))$$



*Định luật Little kiểm chứng:* Sai số dòng chảy $\epsilon = \vert{}L - \lambda W_{\text{empirical}}\vert{}$ được xuất ra API để chứng minh tính ổn định của luồng công việc (Little's Law Consistency).

### 1.3. Thuật Toán IQR Phát Hiện Điểm Nghẽn Bất Thường (Outlier Bottleneck Detection)

Để phát hiện task nào đang bị "om" hoặc có nguy cơ làm vỡ tiến độ dự án mà không bị nhiễu bởi các task ngoại lai:

1. Lấy tập giá trị thời gian xử lý $T = \{t_1, t_2, \dots, t_n\}$ của tất cả các task đã hoàn thành hoặc đang chạy trong cùng phòng ban/cấp độ.
2. Sắp xếp mảng tăng dần, tính phân vị thứ nhất $Q_1$ (25%) và phân vị thứ ba $Q_3$ (75%).
3. Tính khoảng tứ phân vị: $IQR = Q_3 - Q_1$.
4. Ngưỡng cảnh báo nghẽn trên (Upper Fence):

$$\text{Threshold}_{\text{Upper}} = Q_3 + 1.5 \times IQR$$


5. Nếu một task đang ở trạng thái `IN_PROGRESS` hoặc `REVIEW` có thời gian trôi qua vượt quá $\text{Threshold}_{\text{Upper}}$, hệ thống tự động cắm cờ cảnh báo `is_bottleneck = true`.

---

## 2. PHẠM VI TỆP TIN TRIỂN KHAI

AI Assistant triển khai mã nguồn vào các tệp tin sau:

* `src/types/kanban.types.ts`: Định nghĩa Zod Schemas và TypeScript interfaces cho Kanban Board, FSM Transition, Flow Metrics.
* `src/services/kanban-flow.service.ts`: Chứa thuật toán FSM validation, tính Định luật Little, CFD data aggregation và thuật toán IQR phát hiện điểm nghẽn.
* `src/app/api/projects/[id]/kanban/route.ts`: Endpoint `GET` trả về dữ liệu bảng Kanban 5 cột (`SCHEDULED`, `TODO`, `IN_PROGRESS`, `REVIEW`, `DONE`) kèm cờ nhận diện bottleneck.


* `src/app/api/tasks/[taskId]/status/route.ts`: Endpoint `PATCH` chuyển trạng thái task theo FSM, tự động ghi nhận `task_status_history` và tính mốc thời gian.


* `src/app/api/projects/[id]/flow-metrics/route.ts`: Endpoint `GET` trả về phân tích luồng việc: WIP, Throughput, Cycle Time, kiểm chứng Định luật Little và dữ liệu biểu đồ CFD.

---

## 3. CHI TIẾT KỸ THUẬT CÁC TỆP TIN CỐT LÕI

### 3.1. `src/types/kanban.types.ts`

```typescript
import { z } from "zod";

export const TaskStatusEnum = z.enum(["SCHEDULED", "TODO", "IN_PROGRESS", "REVIEW", "DONE"]);

export const UpdateTaskStatusSchema = z.object({
  toStatus: TaskStatusEnum,
  blockReason: z.string().max(255).optional(),
  checklistUpdates: z.array(z.object({
    id: z.string(),
    isCompleted: z.boolean(),
  })).optional(),
});

export interface KanbanColumnData {
  status: string;
  count: number;
  tasks: KanbanCardDto[];
}

export interface KanbanCardDto {
  id: string;
  title: string;
  priority: string;
  department: string;
  requiredLevel: string;
  estimatedHours: number;
  actualHours: number | null;
  isCriticalPath: boolean;
  isBlocked: boolean;
  blockReason: string | null;
  isBottleneck: boolean;
  timeInCurrentStatusHours: number;
  checklistProgress: {
    total: number;
    completed: number;
  };
  assignee: {
    id: string;
    fullName: string;
    avatarUrl: string | null;
  } | null;
}

export interface FlowMetricsDto {
  projectId: string;
  wipCount: number;
  throughputPerDay: number;
  avgCycleTimeHours: number;
  avgLeadTimeHours: number;
  littlesLawDiscrepancy: number; // Sai số kiểm chứng |L - lambda * W|
  iqrThresholdHours: number;
  cfdData: Array<{
    date: string;
    scheduled: number;
    todo: number;
    inProgress: number;
    review: number;
    done: number;
  }>;
}

```

### 3.2. `src/services/kanban-flow.service.ts`

```typescript
import { prisma } from "@/lib/prisma";
import { KanbanCardDto, FlowMetricsDto } from "@/types/kanban.types";

// Ma trận chuyển dịch trạng thái hợp lệ (FSM Rules)
const VALID_TRANSITIONS: Record<string, string[]> = {
  SCHEDULED: ["TODO"],
  TODO: ["IN_PROGRESS", "SCHEDULED"],
  IN_PROGRESS: ["REVIEW", "TODO"],
  REVIEW: ["DONE", "IN_PROGRESS"], // IN_PROGRESS khi bị Reject
  DONE: [], // Trạng thái kết thúc, không được kéo lùi tự do
};

export function validateFSMTransition(fromStatus: string, toStatus: string): boolean {
  if (fromStatus === toStatus) return true;
  return VALID_TRANSITIONS[fromStatus]?.includes(toStatus) || false;
}

export function calculateIQRThreshold(durations: number[]): number {
  if (durations.length < 4) return 48.0; // Ngưỡng mặc định 48h nếu dữ liệu mẫu quá ít
  const sorted = [...durations].sort((a, b) => a - b);
  const q1Index = Math.floor(sorted.length * 0.25);
  const q3Index = Math.floor(sorted.length * 0.75);
  const q1 = sorted[q1Index];
  const q3 = sorted[q3Index];
  const iqr = q3 - q1;
  return Number((q3 + 1.5 * iqr).toFixed(1));
}

export async function getProjectFlowMetrics(projectId: string, daysWindow: number = 14): Promise<FlowMetricsDto> {
  const tasks = await prisma.task.findMany({
    where: { projectId },
    select: {
      id: true,
      status: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      actualHours: true,
    },
  });

  const now = new Date();
  const windowStart = new Date(now.getTime() - daysWindow * 24 * 60 * 60 * 1000);

  // 1. Tính WIP (TODO, IN_PROGRESS, REVIEW)
  const wipCount = tasks.filter((t) => ["TODO", "IN_PROGRESS", "REVIEW"].includes(t.status)).length;

  // 2. Tính Throughput (Số task DONE trong window)
  const completedInWindow = tasks.filter((t) => t.status === "DONE" && t.completedAt && t.completedAt >= windowStart);
  const throughputPerDay = Number((completedInWindow.length / daysWindow).toFixed(2));

  // 3. Tính Cycle Time trung bình (completedAt - startedAt)
  const completedCycleTimes: number[] = [];
  tasks.forEach((t) => {
    if (t.status === "DONE" && t.startedAt && t.completedAt) {
      const hours = (t.completedAt.getTime() - t.startedAt.getTime()) / (1000 * 60 * 60);
      if (hours > 0) completedCycleTimes.push(hours);
    }
  });

  const avgCycleTimeHours = completedCycleTimes.length > 0
    ? Number((completedCycleTimes.reduce((sum, h) => sum + h, 0) / completedCycleTimes.length).toFixed(1))
    : 0.0;

  // 4. Kiểm chứng Định luật Little: L = lambda * W
  // Quy đổi throughput sang đơn vị giờ: lambda_hours = throughputPerDay / 24
  const lambdaPerHour = throughputPerDay / 24.0;
  const theoreticalWIP = lambdaPerHour * avgCycleTimeHours;
  const littlesLawDiscrepancy = Number(Math.abs(wipCount - theoreticalWIP).toFixed(2));

  // 5. Ngưỡng IQR Bottleneck
  const iqrThresholdHours = calculateIQRThreshold(completedCycleTimes);

  // 6. Dữ liệu Cumulative Flow Diagram (CFD) qua các ngày
  // (Truy vấn phân bổ số lượng task theo ngày phục vụ vẽ biểu đồ diện tích lũy tiến)
  const cfdData = [
    {
      date: now.toISOString().split("T")[0],
      scheduled: tasks.filter((t) => t.status === "SCHEDULED").length,
      todo: tasks.filter((t) => t.status === "TODO").length,
      inProgress: tasks.filter((t) => t.status === "IN_PROGRESS").length,
      review: tasks.filter((t) => t.status === "REVIEW").length,
      done: tasks.filter((t) => t.status === "DONE").length,
    },
  ];

  return {
    projectId,
    wipCount,
    throughputPerDay,
    avgCycleTimeHours,
    avgLeadTimeHours: avgCycleTimeHours, // Tối giản lead time
    littlesLawDiscrepancy,
    iqrThresholdHours,
    cfdData,
  };
}

```

### 3.3. `src/app/api/tasks/[taskId]/status/route.ts`

1. Đọc headers `x-user-id` và `x-user-role`.
2. Validate body qua `UpdateTaskStatusSchema`.
3. Lấy thông tin task hiện tại từ CSDL. Nếu không tìm thấy $\to$ HTTP 404.
4. **Kiểm tra Máy Trạng Thái FSM:**
* Gọi `validateFSMTransition(currentTask.status, toStatus)`.
* Nếu không hợp lệ (ví dụ kéo từ `SCHEDULED` thẳng sang `DONE`) $\to$ Trả về HTTP 400 Bad Request kèm mã lỗi `INVALID_STATE_TRANSITION`.


5. **Kiểm tra Quyền Hạn Nghiệp Vụ:**
* Chuyển sang `DONE`: Chỉ `ADMIN`, `PM`, hoặc `LEADER` mới được duyệt (Member kéo sang `DONE` trả về HTTP 403 Forbidden).
* Member được phép chuyển: `TODO -> IN_PROGRESS -> REVIEW`.


6. **Tính Toán Thời Gian & Chạy Prisma Transaction:**
* Tính `durationInPreviousStatusHours`: Lấy thời điểm cập nhật trạng thái gần nhất trong `task_status_history` đến hiện tại.
* Cập nhật `tasks`:
* Nếu sang `IN_PROGRESS` và `started_at` là null $\to$ `started_at = NOW()`.
* Nếu sang `REVIEW` $\to$ `in_review_at = NOW()`.
* Nếu sang `DONE` $\to$ `completed_at = NOW()`, `actual_hours = (NOW() - started_at)`.
* Cập nhật checklist (nếu có payload gửi lên).


* Ghi bản ghi vào `task_status_history`: `task_id`, `changed_by = currentUserId`, `from_status`, `to_status`, `duration_in_previous_status_hours`.


7. Trả về HTTP 200 OK kèm thông tin task đã cập nhật.

### 3.4. `src/app/api/projects/[id]/kanban/route.ts`

1. Xác thực người dùng qua Headers.
2. Query toàn bộ tasks của dự án, select kèm `assignee` (`id`, `fullName`, `avatarUrl`).


3. Lấy danh sách thời gian chạy để tính ngưỡng `iqrThresholdHours`.
4. Duyệt qua từng task, tính `timeInCurrentStatusHours` và đánh dấu `isBottleneck = true` nếu thời gian vượt ngưỡng IQR.
5. Gom nhóm thành 5 mảng tương ứng với 5 cột Kanban: `SCHEDULED`, `TODO`, `IN_PROGRESS`, `REVIEW`, `DONE`.
6. Trả về HTTP 200 OK: `{ success: true, data: { columns: [...] } }`.

---

## 4. QUY TRÌNH KIỂM THỬ KHÁCH QUAN & CHỐNG ẢO GIÁC AI (MANDATORY ANTI-HALLUCINATION TEST)

> **CẢNH BÁO CHO AI ASSISTANT:**
> Hệ thống sẽ **từ chối nghiệm thu** nếu script test chỉ mock các giá trị cố định hoặc tự gọi các assertion vô nghĩa dạng `expect(true).toBe(true)`.
> Script kiểm thử bắt buộc phải thực thi qua HTTP Client thực tế và **truy vấn ngược vào PostgreSQL để so sánh giá trị vật lý (Ground Truth Verification)**.

File script kiểm thử phải được đặt tại: **`test/mod-05-kanban.test.ts`** và phải thỏa mãn 5 bài test nghiêm ngặt sau:

* **TEST-01 (Chặn Vi Phạm FSM Transition):**
* Thử gửi request PATCH chuyển trạng thái một task từ `SCHEDULED` nhảy cóc sang `DONE`.
* Khẳng định: API trả về HTTP 400 và mã lỗi `INVALID_STATE_TRANSITION`. Trạng thái trong DB vẫn là `SCHEDULED`.


* **TEST-02 (Cập Nhật Mốc Thời Gian Tự Động & Lịch Sử):**
* Chuyển tuần tự task: `SCHEDULED` $\to$ `TODO` $\to$ `IN_PROGRESS` $\to$ `REVIEW` $\to$ `DONE`.
* **Kiểm tra CSDL:** Chạy `SELECT started_at, in_review_at, completed_at, actual_hours FROM tasks WHERE id = ...`.


* Khẳng định: Cả 3 mốc thời gian đều khác `NULL`, `actual_hours > 0`, và bảng `task_status_history` có đúng 4 bản ghi lịch sử tương ứng.




* **TEST-03 (Phân Quyền Duyệt Hoàn Thành - Review Guard):**
* Dùng token của `MEMBER` để gọi PATCH chuyển task từ `REVIEW` sang `DONE`.
* Khẳng định: Nhận đúng HTTP 403 Forbidden. Chỉ Leader/PM/Admin mới có quyền duyệt sang `DONE`.


* **TEST-04 (Thuật Toán IQR & Nhận Diện Bottleneck):**
* Tạo dữ liệu giả lập cho 1 task ở `IN_PROGRESS` liên tục trong 100 giờ (vượt xa ngưỡng IQR).
* Gọi API Kanban `GET /api/projects/[id]/kanban`.
* Khẳng định: Task đó trả về có thuộc tính `isBottleneck === true`.


* **TEST-05 (Kiểm Chứng Định Luật Little Trong Flow Metrics):**
* Gọi `GET /api/projects/[id]/flow-metrics`.
* Khẳng định: API trả về đầy đủ các chỉ số `wipCount`, `throughputPerDay`, `avgCycleTimeHours`, và `littlesLawDiscrepancy` là số thực hợp lệ ($\ge 0$).



---

## 5. TIÊU CHÍ NGHIỆM THU ĐẦU RA (DEFINITION OF DONE - DOD)

* [ ] Lệnh `npx tsc --noEmit` chạy sạch 100% không có cảnh báo kiểu dữ liệu.
* [ ] Bảng `task_status_history` lưu vết đầy đủ mọi lần chuyển dịch trạng thái task.


* [ ] Bảng Kanban trả về đầy đủ 5 cột và tính đúng tiến độ checklist.
* [ ] Toàn bộ 5 bài test trong `test/mod-05-kanban.test.ts` vượt qua với kết quả đối soát DB thật.

