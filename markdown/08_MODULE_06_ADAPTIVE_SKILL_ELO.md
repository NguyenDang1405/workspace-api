# AI SPECIFICATION PROMPT: MOD-06 (ADAPTIVE SKILL ELO LOOP)

> **Mã mô-đun:** `MOD-06` (Tầng 4: Vòng lặp Phản hồi & Tái lập lịch Động).
> **Mục tiêu:** Xây dựng hoàn chỉnh tầng Backend API và dịch vụ nền cho Động cơ Hiệu chuẩn Năng lực Thích ứng (Adaptive Skill Elo Calibration Engine). Tự động cập nhật điểm Elo kỹ năng của nhân sự khi một task được duyệt hoàn thành (`DONE`) hoặc bị trả về sửa đổi (`REJECT`), tính toán hệ số biến thiên $K$-factor động dựa trên độ lệch thời gian thực tế so với ước tính, kích hoạt làm mới ngữ nghĩa véc-tơ (`is_embedding_stale = true`) và lưu vết chuỗi thời gian (time-series) vào `user_skill_rating_logs`.
> 
> 
> **Môi trường:** Next.js 14+ (App Router), TypeScript, Prisma ORM, PostgreSQL 16 (14 bảng DDL chuẩn), Zod validation.
> 
> 

---

## 1. NGUYÊN TẮC GIẢI THUẬT & TOÁN HỌC CỐT LÕI (MANDATORY ALGORITHMS)

Module 6 đóng vai trò là "vòng lặp học tập" (Continuous Learning Feedback Loop) giúp hệ thống thông minh dần theo thời gian. AI Assistant bắt buộc phải cài đặt chính xác các công thức toán học sau:

### 1.1. Mô Hình Xếp Hạng Elo Biến Thể Cho Tác Vụ Phần Mềm

Hệ thống coi mỗi lần nhân sự $u$ thực hiện tác vụ $v$ là một "trận đấu" giữa Năng lực Kỹ sư $R_u$ và Độ khó Tác vụ $R_v$:

* **Điểm quy ước độ khó tác vụ ($R_v$):**
* `INTERN`: $1000$ điểm
* `FRESHER`: $1200$ điểm
* `JUNIOR`: $1400$ điểm
* `MIDDLE`: $1600$ điểm
* `SENIOR`: $1800$ điểm


* **Xác suất kỳ vọng hoàn thành xuất sắc ($E_u$):**

$$E_u = \frac{1}{1 + 10^{(R_v - R_u) / 400}}$$


* **Kết quả thực tế ($S_u \in [0, 1]$):**
* Nếu task bị Leader từ chối nghiệm thu (`REVIEW -> IN_PROGRESS`): $S_u = 0.0$ (Thất bại / Reject).


* Nếu task được duyệt `DONE`:
* Tính hệ số thời gian: $\rho = \frac{\text{actual\_hours}}{\text{estimated\_hours}}$.


* Nếu hoàn thành sớm hoặc đúng hạn ($\rho \le 1.0$): $S_u = 1.0$.
* Nếu hoàn thành trễ hạn ($1.0 < \rho \le 1.5$): $S_u = 0.75$.
* Nếu trễ hạn nghiêm trọng ($\rho > 1.5$): $S_u = 0.50$.





### 1.2. Hệ Số Biến Thiên Động ($K$-Factor Modulation)

Hệ số co giãn $K$ xác định biên độ dao động điểm số sau mỗi trận:


$$K = K_{\text{base}} \times \mu_{\text{uncertainty}} \times \mu_{\text{critical}}$$

* $K_{\text{base}} = 32.0$ (hệ số tiêu chuẩn).
* **Độ bất định ($\mu_{\text{uncertainty}}$):** Dựa trên số lượng task nhân sự đã làm với kỹ năng này:

$$\mu_{\text{uncertainty}} = \begin{cases} 1.5 & \text{nếu } \text{tasks\_completed} < 5 \text{ (Giai đoạn hiệu chuẩn nhanh)} \\ 1.0 & \text{nếu } 5 \le \text{tasks\_completed} \le 20 \\ 0.8 & \text{nếu } \text{tasks\_completed} > 20 \text{ (Năng lực đã hội tụ ổn định)} \end{cases}$$


* **Hệ số đường găng ($\mu_{\text{critical}}$):** Nếu task nằm trên đường găng (`is_critical_path = true`), gán $\mu_{\text{critical}} = 1.25$ (thưởng phạt cao hơn cho task trọng yếu); ngược lại $\mu_{\text{critical}} = 1.0$.



### 1.3. Cập Nhật Điểm Và Lưu Vết Chuỗi Thời Gian (Time-Series Audit)

* **Độ lệch điểm Elo:**

$$\Delta R = \text{round}(K \times (S_u - E_u), 2)$$


* **Điểm mới:**

$$R_u^{\text{new}} = \max(800.0, \min(2400.0, R_u + \Delta R))$$


* **Lưu vết:**
1. Cập nhật `user_skill_ratings`: Tăng `tasks_completed` (hoặc `tasks_rejected`), cập nhật `rating_score = new_rating`.


2. Chèn 1 bản ghi vào `user_skill_rating_logs`: `old_rating`, `new_rating`, `delta`, `event_type` (`TASK_DONE` hoặc `REVIEW_REJECT`).


3. Đánh dấu `user_talent_profiles.embedding_revision = embedding_revision - 1` hoặc kích hoạt đồng bộ để cờ `is_embedding_stale` nhận diện cần véc-tơ hóa lại nếu độ lệch lũy kế vượt ngưỡng.





---

## 2. PHẠM VI TỆP TIN TRIỂN KHAI

AI Assistant triển khai mã nguồn vào các tệp tin sau:

* `src/types/elo.types.ts`: Định nghĩa Zod Schemas và TypeScript interfaces cho Elo Calculation, Calibration Events, Time-Series History.
* `src/services/elo-calibration.service.ts`: Chứa thuật toán tính Elo, xác định điểm khó task, hệ số $K$-factor động và ghi nhận nhật ký chuỗi thời gian.


* `src/app/api/tasks/[taskId]/review/route.ts`: Endpoint `POST` cho Leader/PM nghiệm thu task (`action: 'APPROVE'` hoặc `'REJECT'`), tự động kích hoạt tính toán Elo và chuyển trạng thái FSM.


* `src/app/api/users/[userId]/skill-history/route.ts`: Endpoint `GET` trả về chuỗi thời gian biến thiên điểm Elo của kỹ sư theo từng kỹ năng phục vụ vẽ biểu đồ đường (Line Chart).



---

## 3. CHI TIẾT KỸ THUẬT CÁC TỆP TIN CỐT LÕI

### 3.1. `src/types/elo.types.ts`

```typescript
import { z } from "zod";

export const TaskReviewActionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  feedback: z.string().max(1000).optional(),
  primarySkill: z.string().min(1).max(50).default("General"),
});

export interface EloCalculationResult {
  userId: string;
  skillName: string;
  oldRating: number;
  newRating: number;
  delta: number;
  expectedScore: number;
  actualScore: number;
  kFactor: number;
  eventType: "TASK_DONE" | "REVIEW_REJECT";
}

export interface SkillHistoryItemDto {
  id: string;
  skillName: string;
  taskId: string | null;
  taskTitle?: string;
  oldRating: number;
  newRating: number;
  delta: number;
  eventType: string;
  createdAt: string;
}

```

### 3.2. `src/services/elo-calibration.service.ts`

```typescript
import { prisma } from "@/lib/prisma";
import { EloCalculationResult } from "@/types/elo.types";

const LEVEL_DIFFICULTY_MAP: Record<string, number> = {
  INTERN: 1000.0,
  FRESHER: 1200.0,
  JUNIOR: 1400.0,
  MIDDLE: 1600.0,
  SENIOR: 1800.0,
};

export async function processTaskEloCalibration(
  taskId: string,
  action: "APPROVE" | "REJECT",
  primarySkill: string
): Promise<EloCalculationResult> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      assignedTo: true,
      requiredLevel: true,
      estimatedHours: true,
      actualHours: true,
      isCriticalPath: true,
    },
  });

  if (!task) throw new Error("TASK_NOT_FOUND");
  if (!task.assignedTo) throw new Error("TASK_HAS_NO_ASSIGNEE");

  const userId = task.assignedTo;
  const taskDifficulty = LEVEL_DIFFICULTY_MAP[task.requiredLevel] || 1200.0;

  // 1. Lấy hoặc khởi tạo điểm Elo hiện tại của User cho kỹ năng này
  let currentSkill = await prisma.userSkillRating.findUnique({
    where: {
      userId_skillName: { userId, skillName: primarySkill },
    },
  });

  if (!currentSkill) {
    currentSkill = await prisma.userSkillRating.create({
      data: {
        userId,
        skillName: primarySkill,
        ratingScore: 1200.0,
        tasksCompleted: 0,
        tasksRejected: 0,
      },
    });
  }

  const oldRating = Number(currentSkill.ratingScore);

  // 2. Tính điểm kỳ vọng E_u
  const expectedScore = 1.0 / (1.0 + Math.pow(10, (taskDifficulty - oldRating) / 400.0));

  // 3. Tính điểm thực tế S_u
  let actualScore = 0.0;
  let eventType: "TASK_DONE" | "REVIEW_REJECT" = "TASK_DONE";

  if (action === "REJECT") {
    actualScore = 0.0;
    eventType = "REVIEW_REJECT";
  } else {
    eventType = "TASK_DONE";
    const est = Number(task.estimatedHours) || 4.0;
    const act = Number(task.actualHours) || est;
    const ratio = act / est;

    if (ratio <= 1.0) actualScore = 1.0;
    else if (ratio <= 1.5) actualScore = 0.75;
    else actualScore = 0.5;
  }

  // 4. Tính hệ số K động
  let kUncertainty = 1.0;
  if (currentSkill.tasksCompleted < 5) kUncertainty = 1.5;
  else if (currentSkill.tasksCompleted > 20) kUncertainty = 0.8;

  const kCritical = task.isCriticalPath ? 1.25 : 1.0;
  const kFactor = 32.0 * kUncertainty * kCritical;

  // 5. Tính delta và newRating
  const delta = Number((kFactor * (actualScore - expectedScore)).toFixed(2));
  const newRating = Number(Math.max(800.0, Math.min(2400.0, oldRating + delta)).toFixed(2));

  // 6. Thực thi cập nhật cơ sở dữ liệu trong Transaction
  await prisma.$transaction(async (tx) => {
    // Cập nhật bảng xếp hạng hiện tại
    await tx.userSkillRating.update({
      where: { id: currentSkill!.id },
      data: {
        ratingScore: newRating,
        tasksCompleted: action === "APPROVE" ? { increment: 1 } : undefined,
        tasksRejected: action === "REJECT" ? { increment: 1 } : undefined,
      },
    });

    // Thêm bản ghi chuỗi thời gian
    await tx.userSkillRatingLog.create({
      data: {
        userId,
        skillName: primarySkill,
        taskId: task.id,
        oldRating,
        newRating,
        delta,
        eventType,
      },
    });
  });

  return {
    userId,
    skillName: primarySkill,
    oldRating,
    newRating,
    delta,
    expectedScore: Number(expectedScore.toFixed(4)),
    actualScore,
    kFactor: Number(kFactor.toFixed(2)),
    eventType,
  };
}

```

### 3.3. `src/app/api/tasks/[taskId]/review/route.ts`

1. Đọc headers `x-user-id` và `x-user-role`. Yêu cầu quyền: `ADMIN`, `PM`, hoặc `LEADER` (Member trả về HTTP 403 Forbidden).
2. Parse body qua `TaskReviewActionSchema` (`action`, `feedback`, `primarySkill`).
3. Truy vấn task hiện tại. Yêu cầu task phải có trạng thái `REVIEW` (nếu khác $\to$ HTTP 400 Bad Request).
4. **Xử lý theo hành động (Action):**
* **Nếu `action === 'APPROVE'`:**
* Chuyển trạng thái task sang `DONE`, gán `completed_at = NOW()`.


* Tự động tính `actual_hours` nếu chưa có.


* Gọi `processTaskEloCalibration(taskId, 'APPROVE', primarySkill)`.


* Ghi nhận lịch sử `task_status_history`: `REVIEW -> DONE`.




* **Nếu `action === 'REJECT'`:**
* Chuyển trạng thái task lùi về `IN_PROGRESS` để lập trình viên sửa lại.


* Gọi `processTaskEloCalibration(taskId, 'REJECT', primarySkill)` (phạt điểm Elo thích đáng).


* Ghi nhận lịch sử `task_status_history`: `REVIEW -> IN_PROGRESS`.






5. Trả về HTTP 200 OK kèm thông tin trạng thái mới và kết quả biến thiên điểm Elo (`EloCalculationResult`).



### 3.4. `src/app/api/users/[userId]/skill-history/route.ts`

1. Xác thực người dùng qua Headers.
2. Đọc query params: `skillName` (optional), `limit` (mặc định 20).
3. Query bảng `user_skill_rating_logs` kèm quan hệ `task` (`title`) sắp xếp theo `created_at ASC` để dựng trục thời gian biểu đồ.


4. Trả về HTTP 200 OK: `{ success: true, data: { history: [...] } }`.

---

## 4. QUY TRÌNH KIỂM THỬ KHÁCH QUAN & CHỐNG ẢO GIÁC AI (MANDATORY ANTI-HALLUCINATION TEST)

> **CẢNH BÁO CHO AI ASSISTANT:**
> Hệ thống sẽ **từ chối nghiệm thu** nếu script test chỉ mock các giá trị cố định hoặc tự gọi các assertion vô nghĩa dạng `expect(true).toBe(true)`.
> Script kiểm thử bắt buộc phải thực thi qua HTTP Client thực tế và **truy vấn ngược vào PostgreSQL để so sánh giá trị vật lý (Ground Truth Verification)**.

File script kiểm thử phải được đặt tại: **`test/mod-06-elo.test.ts`** và phải thỏa mãn 5 bài test nghiêm ngặt sau:

* **TEST-01 (Hiệu Chuẩn Tăng Điểm Khi Approve Task):**
* Tạo 1 task `JUNIOR` (độ khó 1400) gán cho 1 kỹ sư có Elo khởi điểm 1200.


* Gọi API Review với `action: 'APPROVE'`.
* **Kiểm tra CSDL:** Chạy `SELECT rating_score FROM user_skill_ratings WHERE user_id = ...`.


* Khẳng định: Điểm mới phải lớn hơn điểm cũ ($\Delta R > 0$) vì kỹ sư vượt cấp thành công.




* **TEST-02 (Hiệu Chuẩn Giảm Điểm Khi Reject Task):**
* Gọi API Review từ chối nghiệm thu với `action: 'REJECT'`.
* **Kiểm tra CSDL:** Bảng `user_skill_ratings` phải có `tasks_rejected` tăng thêm 1 và `rating_score` bị trừ điểm ($\Delta R < 0$).




* **TEST-03 (Tính Toàn Vẹn Chuỗi Thời Gian - Time-Series Integrity):**
* Sau khi thực hiện 2 lượt test trên, truy vấn bảng `user_skill_rating_logs`.


* Khẳng định: Có chính xác 2 bản ghi log, giá trị `old_rating` của bản ghi sau phải khớp chính xác với `new_rating` của bản ghi trước.




* **TEST-04 (Hệ Số Phạt Thưởng Đường Găng CPM):**
* Thực hiện test với 2 task cùng độ khó: Task A nằm trên đường găng (`is_critical_path = true`), Task B không găng.


* Khẳng định: Giá trị $\vert{}\Delta R\vert{}$ của Task A phải lớn hơn Task B chính xác $1.25$ lần do hệ số $\mu_{\text{critical}} = 1.25$.


* **TEST-05 (Chặn Quyền Member Duyệt Nghiệm Thu):**
* Dùng token của `MEMBER` để gọi `POST /api/tasks/[taskId]/review`.
* Khẳng định: Nhận đúng HTTP 403 Forbidden. Chỉ Leader/PM/Admin mới có quyền nghiệm thu hoặc trả task.



---

## 5. TIÊU CHÍ NGHIỆM THU ĐẦU RA (DEFINITION OF DONE - DOD)

* [ ] Lệnh `npx tsc --noEmit` chạy sạch 100% không có cảnh báo kiểu dữ liệu.
* [ ] Bảng `user_skill_ratings` và `user_skill_rating_logs` lưu trữ chính xác điểm Elo và biến động chuỗi thời gian.


* [ ] Endpoint `GET /api/users/[userId]/skill-history` trả về đầy đủ mốc dữ liệu để dựng biểu đồ tăng trưởng.


* [ ] Toàn bộ 5 bài test trong `test/mod-06-elo.test.ts` vượt qua với kết quả đối soát DB thật.



---
