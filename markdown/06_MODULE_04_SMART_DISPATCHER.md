# AI SPECIFICATION PROMPT: MOD-04 (SMART DISPATCHER & ADAPTIVE GUIDANCE)

> **Mã mô-đun:** `MOD-04` (Tầng 2: Truy hồi & Điều phối Thích ứng).
> **Mục tiêu:** Xây dựng hoàn chỉnh tầng Backend API cho Động cơ Phân công Tác vụ Thông minh (Smart Dispatcher). Kết hợp điểm tương đồng từ MOD-03 (RRF Search), tải công việc hiện tại (Workload penalty), chỉ số kỹ năng thích ứng (Elo rating từ MOD-06) và độ khẩn cấp đường găng (CPM priority từ MOD-02) để chấm điểm phù hợp $S(u, v)$. Đồng thời tự động sinh Hướng dẫn Kỹ thuật Thích ứng (Adaptive Guidance Checklist) theo cấp bậc nhân sự và lưu vết thực nghiệm vào bảng `dispatch_history` phục vụ luận văn.
> 
> 
> **Môi trường:** Next.js 14+ (App Router), TypeScript, Prisma ORM, PostgreSQL 16 (14 bảng DDL chuẩn), OpenAI SDK (`gpt-4o-mini`), Zod validation.
> 
> 

---

## 1. NGUYÊN TẮC GIẢI THUẬT & TOÁN HỌC CỐT LÕI (MANDATORY ALGORITHMS)

Module 4 là trung tâm ra quyết định điều phối tài nguyên của hệ thống. AI Assistant bắt buộc phải cài đặt chính xác các công thức toán học và heuristic sau:

### 1.1. Hàm Chấm Điểm Phù Hợp Đa Mục Tiêu (Composite Dispatch Score)

Điểm số tổng hợp $S(u, v) \in [0, 1]$ giữa nhân sự $u$ và tác vụ $v$ được xác định theo mô hình Heuristic đa mục tiêu:


$$S(u, v) = w_1 \cdot \widehat{RRF}(u, v) + w_2 \cdot E(u, v) + w_3 \cdot C(v) - w_4 \cdot W(u)$$


Trong đó:

* **$\widehat{RRF}(u, v)$ (Điểm ngữ nghĩa chuẩn hóa):** Lấy từ MOD-03. Chuẩn hóa Min-Max về đoạn $[0, 1]$ trên tập ứng viên tiềm năng. Trọng số mặc định: $w_1 = 0.40$.
* **$E(u, v)$ (Điểm năng lực Elo chuẩn hóa):** Lấy từ bảng `user_skill_ratings` của kỹ năng khớp nhất.



$$E(u, v) = \min\left(1.0, \max\left(0.0, \frac{\text{Elo}(u) - 800}{1200}\right)\right)$$



(với Elo cơ bản 1200 tương đương 0.33, tối đa 2000 là 1.0). Trọng số mặc định: $w_2 = 0.25$.


* **$C(v)$ (Hệ số Đường găng CPM):** Nếu task nằm trên đường găng (`is_critical_path = true`), $C(v) = 1.0$; ngược lại $C(v) = 0.0$. Giúp ưu tiên ghép người giỏi nhất cho task găng. Trọng số mặc định: $w_3 = 0.15$.


* **$W(u)$ (Hình phạt Tải công việc - Workload Penalty):** Phạt tuyến tính theo số task `IN_PROGRESS` của nhân sự $u$:

$$W(u) = \min\left(1.0, \frac{\text{ActiveTasks}(u)}{\text{MAX\_WIP}}\right)$$



(với $\text{MAX\_WIP} = 3$). Trọng số mặc định: $w_4 = 0.20$.

### 1.2. Sinh Hướng Dẫn Thích Ứng Theo Cấp Bậc (Adaptive Guidance Generation)

Khi task được phân công, hệ thống gọi OpenAI (`gpt-4o-mini`) sinh mảng checklist kỹ thuật chuyên biệt tùy biến theo cấp bậc của nhân sự nhận việc:

* **INTERN / FRESHER:** Sinh checklist chi tiết 5–7 bước (kèm tài liệu tham khảo, cảnh báo lỗi cú pháp thường gặp, yêu cầu viết Unit Test cơ bản).
* **JUNIOR / MIDDLE:** Sinh checklist 3–5 bước tập trung vào xử lý edge-cases, validation, và tối ưu hóa câu truy vấn.
* **SENIOR:** Sinh checklist 2–3 mục tiêu kiến trúc cấp cao (thiết kế interface, benchmark độ trễ, quy ước bảo mật, zero-downtime).
Checklist được cập nhật trực tiếp vào cột `tasks.checklist` dưới dạng `JSONB`.



### 1.3. Lưu Vết Thực Nghiệm Điều Phối (Dispatch Audit Logging)

Mọi lượt phân công bắt buộc ghi vào bảng `dispatch_history`:

* Lưu danh sách Top 3 ứng viên AI đề xuất lúc đó kèm điểm số thành phần vào `recommended_candidates`.


* Lưu `chosen_user_id`.


* Nếu `chosen_user_id !== recommended_candidates[0].userId` $\to$ Đánh dấu `is_human_override = true` kèm `override_reason`.



---

## 2. PHẠM VI TỆP TIN TRIỂN KHAI

AI Assistant triển khai mã nguồn vào các tệp tin sau:

* `src/types/dispatch.types.ts`: Định nghĩa Zod Schemas và TypeScript interfaces cho Dispatch Request, Candidate Scoring, Adaptive Guidance.
* `src/services/dispatch-scoring.service.ts`: Thuật toán tính toán điểm tổng hợp $S(u, v)$ và gọi OpenAI sinh adaptive checklist.
* `src/app/api/tasks/[taskId]/dispatch/route.ts`: Endpoint `POST` thực thi gán task cho nhân sự, sinh checklist, lưu lịch sử `dispatch_history` và cập nhật trạng thái task sang `TODO` trong Prisma Transaction.



---

## 3. CHI TIẾT KỸ THUẬT CÁC TỆP TIN CỐT LÕI

### 3.1. `src/types/dispatch.types.ts`

```typescript
import { z } from "zod";

export const DispatchTaskSchema = z.object({
  assignedUserId: z.string().uuid("ID nhân sự không hợp lệ"),
  overrideReason: z.string().max(500).optional(),
});

export interface DispatchScoredCandidate {
  userId: string;
  fullName: string;
  email: string;
  department: string;
  level: string;
  rawRrfScore: number;
  normalizedRrf: number;
  eloScore: number;
  normalizedElo: number;
  activeWorkload: number;
  workloadPenalty: number;
  criticalBonus: number;
  compositeScore: number;
}

export interface AdaptiveChecklistItem {
  id: string;
  taskText: string;
  isCompleted: boolean;
  category: "PREREQUISITE" | "IMPLEMENTATION" | "TESTING" | "SECURITY";
}

```

### 3.2. `src/services/dispatch-scoring.service.ts`

```typescript
import { prisma } from "@/lib/prisma";
import { searchCandidatesForTask } from "./hybrid-search.service";
import { DispatchScoredCandidate, AdaptiveChecklistItem } from "@/types/dispatch.types";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "dummy-key-for-build",
  timeout: 7000,
});

export async function scoreCandidatesForTask(taskId: string): Promise<{
  task: any;
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

  if (!task) throw new Error("TASK_NOT_FOUND");
  if (task.status !== "SCHEDULED") throw new Error("TASK_NOT_IN_SCHEDULED_STATE");

  // 1. Lấy danh sách Top ứng viên từ MOD-03 (RRF Search)
  const baseCandidates = await searchCandidatesForTask(taskId, 10, false);
  if (baseCandidates.length === 0) {
    return { task, rankedCandidates: [] };
  }

  // 2. Lấy dữ liệu điểm Elo kỹ năng tương ứng từ DB
  const userIds = baseCandidates.map((c) => c.userId);
  const skillRatings = await prisma.userSkillRating.findMany({
    where: {
      userId: { in: userIds },
    },
  });

  // Chuẩn hóa Min-Max điểm RRF
  const maxRrf = Math.max(...baseCandidates.map((c) => c.rrfScore), 0.0001);
  const minRrf = Math.min(...baseCandidates.map((c) => c.rrfScore), 0.0);

  const scored: DispatchScoredCandidate[] = baseCandidates.map((cand) => {
    const normRrf = (cand.rrfScore - minRrf) / (maxRrf - minRrf || 1);

    // Tính điểm Elo trung bình hoặc kỹ năng khớp
    const userSkills = skillRatings.filter((s) => s.userId === cand.userId);
    const avgElo = userSkills.length > 0
      ? userSkills.reduce((sum, s) => sum + Number(s.ratingScore), 0) / userSkills.length
      : 1200.0;
    const normElo = Math.min(1.0, Math.max(0.0, (avgElo - 800) / 1200));

    // Tính hình phạt Workload (Max WIP = 3)
    const normWorkload = Math.min(1.0, cand.activeWorkload / 3.0);
    const criticalBonus = task.isCriticalPath ? 1.0 : 0.0;

    // Công thức tổng hợp S(u, v) = 0.4*RRF + 0.25*Elo + 0.15*Critical - 0.2*Workload
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

  // Sắp xếp giảm dần theo điểm composite
  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  return { task, rankedCandidates: scored };
}

export async function generateAdaptiveChecklist(
  taskTitle: string,
  taskDescription: string,
  userLevel: string
): Promise<AdaptiveChecklistItem[]> {
  const prompt = `Bạn là Technical Leader. Hãy tạo danh sách công việc kiểm tra (checklist) định dạng JSON cho một lập trình viên cấp bậc ${userLevel} thực hiện task:
Tiêu đề: ${taskTitle}
Mô tả: ${taskDescription}

Yêu cầu:
- Nếu cấp bậc là INTERN hoặc FRESHER: Tạo 5-7 mục cực kỳ chi tiết, kèm lưu ý về clean code, convention và viết test.
- Nếu cấp bậc là JUNIOR hoặc MIDDLE: Tạo 3-5 mục tập trung vào edge cases, validation, xử lý ngoại lệ.
- Nếu cấp bậc là SENIOR: Tạo 2-3 mục kiến trúc cấp cao, benchmark hiệu năng, bảo mật.
Chỉ trả về JSON thuần túy có cấu trúc: {"items": [{"id": "chk-1", "taskText": "...", "category": "PREREQUISITE" | "IMPLEMENTATION" | "TESTING" | "SECURITY"}]}`;

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const parsed = JSON.parse(res.choices[0].message.content || "{}");
    return (parsed.items || []).map((it: any, idx: number) => ({
      id: it.id || `chk-${idx + 1}`,
      taskText: it.taskText,
      isCompleted: false,
      category: it.category || "IMPLEMENTATION",
    }));
  } catch (err) {
    console.error("[Adaptive Checklist Error]:", err);
    // Fallback an toàn nếu LLM gặp sự cố
    return [
      { id: "chk-1", taskText: "Nghiên cứu yêu cầu và đọc tài liệu kỹ thuật", isCompleted: false, category: "PREREQUISITE" },
      { id: "chk-2", taskText: "Cài đặt giải pháp và tự kiểm thử (Unit Test)", isCompleted: false, category: "IMPLEMENTATION" },
      { id: "chk-3", taskText: "Tạo Pull Request và đối chiếu tiêu chí nghiệm thu", isCompleted: false, category: "TESTING" },
    ];
  }
}

```

### 3.3. `src/app/api/tasks/[taskId]/dispatch/route.ts`

1. Đọc headers `x-user-id` và `x-user-role`. Chặn `MEMBER` (HTTP 403 Forbidden).
2. Parse body qua `DispatchTaskSchema`.
3. Gọi hàm `scoreCandidatesForTask(taskId)`.
4. Tìm thông tin của `assignedUserId` trong danh sách ứng viên (nếu không nằm trong top được lọc $\to$ truy vấn DB kiểm tra xem có hợp lệ không).
5. Xác định `isHumanOverride`:
* Top 1 AI đề xuất là `rankedCandidates[0]?.userId`.
* Nếu `assignedUserId !== rankedCandidates[0]?.userId`, gán `isHumanOverride = true`.




6. Gọi `generateAdaptiveChecklist(task.title, task.description, candidate.level)` để sinh checklist phù hợp.
7. **Thực thi Prisma Transaction ($transaction):**
* Cập nhật `tasks`: Gán `assigned_to = assignedUserId`, `status = 'TODO'`, `checklist = adaptiveChecklist`.


* Tạo bản ghi `task_status_history`: `from_status = 'SCHEDULED'`, `to_status = 'TODO'`, `changed_by = currentUserId`.


* Tạo bản ghi `dispatch_history`: Lưu `task_id`, `recommended_candidates` (Top 3), `chosen_user_id`, `is_human_override`, `override_reason`.




8. Trả về HTTP 200 OK kèm kết quả phân công và checklist đã sinh.

---

## 4. QUY TRÌNH KIỂM THỬ KHÁCH QUAN & CHỐNG ẢO GIÁC AI (MANDATORY ANTI-HALLUCINATION TEST)

> **CẢNH BÁO CHO AI ASSISTANT:**
> Hệ thống sẽ **từ chối nghiệm thu** nếu script test chỉ mock các giá trị cố định hoặc tự gọi các assertion vô nghĩa dạng `expect(true).toBe(true)`.
> Script kiểm thử bắt buộc phải thực thi qua HTTP Client thực tế và **truy vấn ngược vào PostgreSQL để so sánh giá trị vật lý (Ground Truth Verification)**.

File script kiểm thử phải được đặt tại: **`test/mod-04-dispatch.test.ts`** và phải thỏa mãn 5 bài test nghiêm ngặt sau:

* **TEST-01 (Công thức Chấm điểm Đa Mục Tiêu):**
* Tạo 2 ứng viên giả định: Ứng viên A có RRF cao nhưng đang gánh 3 task (`activeWorkload = 3` $\to$ penalty tối đa). Ứng viên B có RRF thấp hơn một chút nhưng rảnh rỗi (`activeWorkload = 0`).
* Khẳng định: Điểm $S(B, v)$ phải cao hơn $S(A, v)$. AI không được tự ý gán người đang quá tải lên Top 1.


* **TEST-02 (Adaptive Guidance Checklist theo Level):**
* Chạy test dispatch cho một `INTERN` và một `SENIOR`.
* Khẳng định: Checklist của `INTERN` phải có độ dài từ 5 đến 7 items, trong khi của `SENIOR` chỉ có từ 2 đến 3 items.


* **TEST-03 (Ghi nhận Human Override trong CSDL):**
* Gửi request điều phối chọn ứng viên Top 2 thay vì Top 1, kèm `overrideReason = "Top 1 đang bận task khẩn cấp ngoài đời"`.


* **Kiểm tra CSDL:** Chạy `SELECT is_human_override, override_reason FROM dispatch_history WHERE task_id = ...`.


* Khẳng định: `is_human_override` trong DB bắt buộc phải là `true`, và `override_reason` phải khớp từng ký tự.




* **TEST-04 (Tính Toàn vẹn Transaction):**
* Thử dispatch một `taskId` không tồn tại hoặc đã có trạng thái `DONE`.


* Khẳng định: API trả về HTTP 400/404, bảng `tasks` và `dispatch_history` tuyệt đối không sinh thêm bản ghi rác nào.




* **TEST-05 (Kiểm tra Phân quyền RBAC):**
* Dùng token của `MEMBER` để gọi `POST /api/tasks/[id]/dispatch`.
* Khẳng định: Nhận đúng HTTP 403 Forbidden.



---

## 5. TIÊU CHÍ NGHIỆM THU ĐẦU RA (DEFINITION OF DONE - DOD)

* [ ] Lệnh `npx tsc --noEmit` chạy sạch 100% không có cảnh báo kiểu dữ liệu.
* [ ] Bảng `dispatch_history` được ghi nhận đầy đủ sau mỗi lượt điều phối.


* [ ] Cột `tasks.checklist` lưu trữ JSON array chuẩn `AdaptiveChecklistItem`.


* [ ] Toàn bộ 5 bài test trong `test/mod-04-dispatch.test.ts` vượt qua với kết quả đối soát DB thật.



---
