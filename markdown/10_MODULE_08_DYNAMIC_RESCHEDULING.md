# AI SPECIFICATION PROMPT: MOD-08 (DYNAMIC RESCHEDULING & MONTE CARLO SIMULATION)

> **Mã mô-đun:** `MOD-08` (Tầng 4: Vòng lặp Phản hồi & Tái lập lịch Động).
> **Mục tiêu:** Xây dựng hoàn chỉnh tầng Backend API cho Động cơ Tái lập lịch Động (Dynamic Rescheduling) và Mô phỏng Rủi ro Tiến độ (Monte Carlo Schedule Risk Simulation Engine). Tự động phát hiện khi một task bị trễ hạn hoặc bị nghẽn (`is_blocked = true`), lan truyền tác động trễ dọc theo các nhánh phụ thuộc trong đồ thị DAG (dựa trên thuật toán CPM của MOD-02), chạy mô phỏng ngẫu nhiên Monte Carlo $N = 1,000$ lần với phân phối PERT-Beta nhằm dự báo xác suất hoàn thành đúng hạn ($P_{50}, P_{80}, P_{95}$), tự động đề xuất chiến lược giảm thiểu rủi ro (Fast-tracking hoặc Crashing qua AI), và lưu vết vào bảng `rescheduling_events`.
> 
> 
> **Môi trường:** Next.js 14+ (App Router), TypeScript, Prisma ORM, PostgreSQL 16 (14 bảng DDL chuẩn), OpenAI SDK (`gpt-4o-mini`), Zod validation.
> 
> 

---

## 1. NGUYÊN TẮC GIẢI THUẬT & TOÁN HỌC CỐT LÕI (MANDATORY ALGORITHMS)

Module 8 là đỉnh cao về mặt toán học và khoa học dữ liệu trong việc kiểm soát tiến độ. AI Assistant bắt buộc phải cài đặt chính xác các công thức và giải thuật sau bằng TypeScript thuần:

### 1.1. Lan Truyền Độ Trễ Dọc Theo Đồ Thị DAG (Delay Propagation Analysis)

Khi một tác vụ kích hoạt $v_{\text{trigger}}$ phát sinh độ trễ $\Delta t = t_{\text{actual}} - t_{\text{estimated}} > 0$ (hoặc thời gian nghẽn khi `is_blocked = true`):

1. **Kiểm tra độ trôi tự do (Slack Time):**
* Nếu $\Delta t \le \text{slack\_time}(v_{\text{trigger}})$: Độ trễ được hấp thụ hoàn toàn bởi thời gian đệm tự do của nhánh không găng. Tổng thời gian dự án ($T_{\text{makespan}}$) **không bị thay đổi**. Hệ thống không cần kích hoạt tái lập lịch diện rộng.


* Nếu $\Delta t > \text{slack\_time}(v_{\text{trigger}})$: Nhánh này trở thành đường găng mới, làm trễ toàn bộ các task kế nhiệm ($v \in \text{Succ}^*(v_{\text{trigger}})$). Tổng thời gian hoàn thành dự án bị kéo dài thêm một khoảng:

$$\Delta T_{\text{project}} = \Delta t - \text{slack\_time}(v_{\text{trigger}})$$




2. **Tái tính toán CPM Forward/Backward Pass:**
* Cập nhật lại thời lượng thực tế của $v_{\text{trigger}}$.
* Chạy lại thuật toán CPM trên đồ thị con chịu ảnh hưởng để cập nhật lại $ES, EF, LS, LF, \text{slack\_time}$ và cờ `is_critical_path` của các task liên quan.





### 1.2. Mô Phỏng Rủi Ro Monte Carlo Với Phân Phối PERT-Beta ($N = 1,000$)

Không dựa trên ước lượng thời gian tất định duy nhất, hệ thống mô phỏng mỗi task chưa hoàn thành $v$ như một biến ngẫu nhiên tuân theo phân phối PERT-Beta với 3 mốc ước lượng:

* $a_v$ (Lạc quan - Optimistic): $a_v = 0.8 \times \text{estimated\_hours}(v)$.


* $m_v$ (Khả dĩ nhất - Most Likely): $m_v = 1.0 \times \text{estimated\_hours}(v)$.


* $b_v$ (Bi quan - Pessimistic): $b_v = \begin{cases} 2.0 \times \text{estimated\_hours}(v) & \text{nếu task có } \text{is\_blocked} = \text{true} \\ 1.5 \times \text{estimated\_hours}(v) & \text{nếu bình thường} \end{cases}$.



**Xấp xỉ phân phối PERT-Beta bằng phương pháp hộp đen:**


$$\mu_v = \frac{a_v + 4m_v + b_v}{6}, \quad \sigma_v = \frac{b_v - a_v}{6}$$


Trong mỗi lần lặp $i \in [1, 1000]$:

1. Lấy mẫu ngẫu nhiên thời lượng $t_v^{(i)}$ cho từng task từ phân phối chuẩn $\mathcal{N}(\mu_v, \sigma_v^2)$ (cắt cụt ở mốc $[a_v, b_v]$).
2. Chạy duyệt Forward Pass để tính thời gian hoàn thành dự án $T_{\text{makespan}}^{(i)}$.
3. Lưu mảng kết quả $\{T_{\text{makespan}}^{(1)}, T_{\text{makespan}}^{(2)}, \dots, T_{\text{makespan}}^{(1000)}\}$.

**Xuất chỉ số phân vị (Percentiles):**

* Sắp xếp mảng kết quả tăng dần.
* $P_{50}$ (Kỳ vọng trung vị): Giá trị tại vị trí 50%.
* $P_{80}$ (Mốc cam kết an toàn với khách hàng): Giá trị tại vị trí 80%.
* $P_{95}$ (Kịch bản rủi ro nghiêm trọng - Worst Case): Giá trị tại vị trí 95%.

### 1.3. Đề Xuất Chiến Lược Giảm Thiểu Qua AI (AI Mitigation Strategy)

Khi độ trễ vượt ngưỡng nghiêm trọng ($\Delta T_{\text{project}} > 8.0$ giờ hoặc $P_{80}$ vượt quá `target_end_date`):

* Gọi `gpt-4o-mini` phân tích các task nằm trên đường găng mới và đề xuất 2 chiến lược kinh điển của quản lý dự án:
* **Fast-Tracking (Chạy song song hóa):** Bẻ nhỏ hoặc cho phép bắt đầu sớm các cặp task phụ thuộc loại Finish-to-Start (FS) với điều kiện kiểm soát rủi ro.


* **Crashing (Tăng cường nguồn lực):** Gợi ý bổ sung nhân sự có Elo cao (từ MOD-06) vào các task găng để rút ngắn thời gian.


* Lưu thông tin phân tích vào cột `mitigation_strategy` trong bảng `rescheduling_events`.



---

## 2. PHẠM VI TỆP TIN TRIỂN KHAI

AI Assistant triển khai mã nguồn vào đúng các tệp tin theo cấu trúc dự án:

* `src/types/rescheduling.types.ts`: Định nghĩa Zod Schemas và TypeScript interfaces cho Trigger Reschedule, Monte Carlo Simulation Metrics, Mitigation Strategy.
* `src/services/rescheduling-engine.service.ts`: Chứa thuật toán phân tích lan truyền trễ, cập nhật CPM động, vòng lặp mô phỏng Monte Carlo 1,000 lần và gọi OpenAI sinh giải pháp khắc phục.
* `src/app/api/projects/[id]/reschedule/route.ts`: Endpoint `POST` kích hoạt tái lập lịch động (thủ công hoặc tự động từ cảnh báo task trễ), cập nhật DB trong Prisma Transaction và lưu `rescheduling_events`.


* `src/app/api/projects/[id]/risk-simulation/route.ts`: Endpoint `GET` chạy mô phỏng Monte Carlo theo yêu cầu và trả về phân phối xác suất ($P_{50}, P_{80}, P_{95}$) cùng mảng histogram phục vụ vẽ biểu đồ đường cong phân phối (S-Curve).

---

## 3. CHI TIẾT KỸ THUẬT CÁC TỆP TIN CỐT LÕI

### 3.1. `src/types/rescheduling.types.ts`

```typescript
import { z } from "zod";

export const TriggerRescheduleSchema = z.object({
  triggerTaskId: z.string().uuid("ID task không hợp lệ").optional(),
  reason: z.string().min(5).max(100),
  actualDelayHours: z.number().min(0.5).max(100).default(4.0),
});

export interface MonteCarloSimulationResult {
  iterations: number;
  originalMakespanHours: number;
  meanMakespanHours: number;
  standardDeviationHours: number;
  p50Hours: number;
  p80Hours: number;
  p95Hours: number;
  probabilityOnTime: number; // Tỷ lệ % hoàn thành trước deadline danh định
  histogram: Array<{ binHours: number; frequency: number }>;
}

export interface MitigationStrategyDto {
  strategyType: "FAST_TRACKING" | "CRASHING" | "SCOPE_REDUCTION";
  recommendationSummary: string;
  affectedTaskIds: string[];
  estimatedHoursSaved: number;
}

```

### 3.2. `src/services/rescheduling-engine.service.ts`

```typescript
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";
import { MonteCarloSimulationResult, MitigationStrategyDto } from "@/types/rescheduling.types";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "dummy-key-for-build",
  timeout: 8000,
});

// Hàm lấy mẫu phân phối chuẩn ngẫu nhiên (Box-Muller Transform)
function sampleNormal(mean: number, stdDev: number): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * stdDev;
}

export async function runMonteCarloSimulation(
  projectId: string,
  iterations: number = 1000
): Promise<MonteCarloSimulationResult> {
  const tasks = await prisma.task.findMany({
    where: { projectId },
    select: {
      id: true,
      estimatedHours: true,
      status: true,
      isBlocked: true,
      earlyFinish: true,
    },
  });

  const dependencies = await prisma.taskDependency.findMany({
    where: {
      predecessor: { projectId },
    },
  });

  // Xây dựng danh sách kề
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  tasks.forEach((t) => {
    adj.set(t.id, []);
    inDegree.set(t.id, 0);
  });
  dependencies.forEach((d) => {
    adj.get(d.predecessorId)?.push(d.successorId);
    inDegree.set(d.successorId, (inDegree.get(d.successorId) || 0) + 1);
  });

  // Thứ tự topo
  const queue = tasks.filter((t) => inDegree.get(t.id) === 0).map((t) => t.id);
  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    topoOrder.push(u);
    adj.get(u)?.forEach((v) => {
      inDegree.set(v, inDegree.get(v)! - 1);
      if (inDegree.get(v) === 0) queue.push(v);
    });
  }

  const originalMakespan = Math.max(...tasks.map((t) => Number(t.earlyFinish)), 0);
  const makespanRuns: number[] = [];

  // Vòng lặp mô phỏng ngẫu nhiên Monte Carlo
  for (let i = 0; i < iterations; i++) {
    const taskDurations = new Map<string, number>();

    tasks.forEach((t) => {
      if (t.status === "DONE") {
        taskDurations.set(t.id, Number(t.estimatedHours));
      } else {
        const est = Number(t.estimatedHours);
        const a = 0.8 * est;
        const m = 1.0 * est;
        const b = t.isBlocked ? 2.0 * est : 1.5 * est;
        const mean = (a + 4 * m + b) / 6.0;
        const std = (b - a) / 6.0;

        let sampled = sampleNormal(mean, std);
        sampled = Math.max(a, Math.min(b, sampled));
        taskDurations.set(t.id, sampled);
      }
    });

    // Chạy Forward pass tính makespan cho lần lặp này
    const ef = new Map<string, number>();
    topoOrder.forEach((taskId) => {
      let maxPredEf = 0;
      dependencies
        .filter((d) => d.successorId === taskId)
        .forEach((d) => {
          maxPredEf = Math.max(maxPredEf, ef.get(d.predecessorId) || 0);
        });
      ef.set(taskId, maxPredEf + (taskDurations.get(taskId) || 0));
    });

    let iterMakespan = 0;
    ef.forEach((val) => {
      iterMakespan = Math.max(iterMakespan, val);
    });
    makespanRuns.push(iterMakespan);
  }

  makespanRuns.sort((a, b) => a - b);
  const p50 = Number(makespanRuns[Math.floor(iterations * 0.5)].toFixed(1));
  const p80 = Number(makespanRuns[Math.floor(iterations * 0.8)].toFixed(1));
  const p95 = Number(makespanRuns[Math.floor(iterations * 0.95)].toFixed(1));
  const meanMakespan = Number((makespanRuns.reduce((sum, v) => sum + v, 0) / iterations).toFixed(1));

  const variance = makespanRuns.reduce((sum, v) => sum + Math.pow(v - meanMakespan, 2), 0) / iterations;
  const stdDev = Number(Math.sqrt(variance).toFixed(1));

  // Tỷ lệ hoàn thành trước mốc gốc + 10%
  const onTimeCount = makespanRuns.filter((m) => m <= originalMakespan * 1.1).length;
  const probabilityOnTime = Number(((onTimeCount / iterations) * 100).toFixed(1));

  // Gom nhóm Histogram 10 bin
  const minVal = makespanRuns[0];
  const maxVal = makespanRuns[iterations - 1];
  const binStep = (maxVal - minVal) / 10 || 1;
  const histogram: Array<{ binHours: number; frequency: number }> = [];

  for (let b = 0; b < 10; b++) {
    const binStart = minVal + b * binStep;
    const binEnd = binStart + binStep;
    const count = makespanRuns.filter((v) => v >= binStart && (b === 9 ? v <= binEnd : v < binEnd)).length;
    histogram.push({ binHours: Number((binStart + binStep / 2).toFixed(1)), frequency: count });
  }

  return {
    iterations,
    originalMakespanHours: Number(originalMakespan.toFixed(1)),
    meanMakespanHours: meanMakespan,
    standardDeviationHours: stdDev,
    p50Hours: p50,
    p80Hours: p80,
    p95Hours: p95,
    probabilityOnTime,
    histogram,
  };
}

export async function generateMitigationStrategy(
  projectName: string,
  delayedTaskTitle: string,
  delayHours: number,
  criticalTasks: string[]
): Promise<MitigationStrategyDto> {
  const prompt = `Bạn là Chuyên gia Lập kế hoạch Dự án (Project Controls Director).
Dự án "${projectName}" đang gặp sự cố trễ hạn:
- Tác vụ gây trễ: "${delayedTaskTitle}" (trễ ${delayHours} giờ).
- Các tác vụ đang nằm trên đường găng nguy cấp: ${JSON.stringify(criticalTasks)}.

Hãy đưa ra giải pháp khắc phục ngắn gọn bằng kỹ thuật Fast-tracking (chạy song song) hoặc Crashing (tăng nhân lực).
Trả về JSON chuẩn:
{
  "strategyType": "FAST_TRACKING" | "CRASHING",
  "recommendationSummary": "<hướng dẫn cụ thể 2-3 câu>",
  "affectedTaskIds": [],
  "estimatedHoursSaved": <số giờ tiết kiệm dự kiến>
}`;

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
    return JSON.parse(res.choices[0].message.content || "{}");
  } catch (err) {
    console.error("[Mitigation Strategy Error]:", err);
    return {
      strategyType: "CRASHING",
      recommendationSummary: "Cân nhắc điều động thêm Senior Engineer hỗ trợ các task găng.",
      affectedTaskIds: [],
      estimatedHoursSaved: Number((delayHours * 0.5).toFixed(1)),
    };
  }
}

```

### 3.3. `src/app/api/projects/[id]/reschedule/route.ts`

1. Đọc headers xác thực: Yêu cầu quyền `ADMIN`, `PM`, hoặc `LEADER` (Member trả về HTTP 403 Forbidden).
2. Validate body qua `TriggerRescheduleSchema` (`triggerTaskId`, `reason`, `actualDelayHours`).
3. Truy vấn dự án và toàn bộ tasks.
4. Lấy thông tin makespan ban đầu ($T_{\text{original}}$).
5. **Cập nhật Task Gây Trễ:**
* Tăng `estimatedHours` của task gây trễ thêm `actualDelayHours` (hoặc tính lại nếu có `actual_hours`).




6. **Chạy lại Động cơ CPM:**
* Tính lại toàn bộ $ES, EF, LS, LF, \text{slack\_time}$, và xác định lại tập task găng `is_critical_path` mới.


* Tính makespan mới ($T_{\text{new}}$).


7. **Gọi OpenAI đề xuất giải pháp giảm thiểu:**
* Gọi hàm `generateMitigationStrategy`.


8. **Mở Prisma Transaction ($transaction):**
* Cập nhật hàng loạt các mốc CPM mới vào bảng `tasks`.


* Tạo bản ghi mới trong bảng `rescheduling_events`:
* `project_id: projectId`

* `trigger_task_id: triggerTaskId || null`

* `reason: payload.reason`

* `original_makespan_days: T_original / 8.0`

* `new_makespan_days: T_new / 8.0`

* `mitigation_strategy: JSON.stringify(mitigationResult)`





9. Trả về HTTP 200 OK: `{ success: true, data: { originalMakespan, newMakespan, deltaHours, mitigationResult } }`.

### 3.4. `src/app/api/projects/[id]/risk-simulation/route.ts`

1. Đọc headers xác thực.
2. Đọc query param `iterations` (mặc định 1000, tối đa 2000).
3. Gọi hàm `runMonteCarloSimulation(projectId, iterations)`.
4. Trả về HTTP 200 OK kèm phân tích xác suất đầy đủ ($P_{50}, P_{80}, P_{95}$) và mảng histogram.

---

## 4. QUY TRÌNH KIỂM THỬ KHÁCH QUAN & CHỐNG ẢO GIÁC AI (MANDATORY ANTI-HALLUCINATION TEST)

> **CẢNH BÁO CHO AI ASSISTANT:**
> Hệ thống sẽ **từ chối nghiệm thu** nếu script test chỉ mock các giá trị cố định hoặc tự gọi các assertion vô nghĩa dạng `expect(true).toBe(true)`.
> Script kiểm thử bắt buộc phải thực thi qua HTTP Client thực tế và **truy vấn ngược vào PostgreSQL để so sánh giá trị vật lý (Ground Truth Verification)**.

File script kiểm thử phải được đặt tại: **`test/mod-08-reschedule.test.ts`** và phải thỏa mãn 5 bài test nghiêm ngặt sau:

* **TEST-01 (Hấp Thụ Độ Trễ Trên Task Không Găng):**
* Chọn 1 task có $\text{slack\_time} = 30.0$ giờ (như task Docker ở MOD-02).
* Kích hoạt trễ thêm 10 giờ (nhỏ hơn 30h).
* Khẳng định: $T_{\text{new}}$ trả về bắt buộc phải bằng chính xác $T_{\text{original}}$ (độ trễ được triệt tiêu hoàn toàn bởi slack time).


* **TEST-02 (Lan Truyền Trễ Trên Đường Găng & Lưu CSDL):**
* Chọn 1 task trên đường găng (`slack_time = 0.0`), kích hoạt trễ 15 giờ.
* **Kiểm tra CSDL:** Chạy `SELECT original_makespan_days, new_makespan_days, mitigation_strategy FROM rescheduling_events WHERE project_id = ...`.


* Khẳng định: `new_makespan_days > original_makespan_days`, và bản ghi sự kiện được lưu thành công với đầy đủ giải pháp AI.




* **TEST-03 (Tính Tính Hợp Lệ Của Mô Phỏng Monte Carlo 1,000 Lần):**
* Gọi `GET /api/projects/[id]/risk-simulation?iterations=1000`.
* Khẳng định: Dữ liệu trả về tuân thủ thứ tự toán học nghiêm ngặt: $P_{50} \le P_{80} \le P_{95}$, và mảng `histogram` có đúng 10 bin với tổng tần suất bằng 1,000.


* **TEST-04 (Tác Động Của Task Bị Nghẽn - Blocked Task Penalty):**
* Đánh dấu 1 task có `is_blocked = true`. Chạy lại mô phỏng Monte Carlo.


* Khẳng định: Giá trị $P_{95}$ khi có task bị nghẽn phải tăng cao hơn so với khi không có task nghẽn.


* **TEST-05 (Chặn Quyền Member Kích Hoạt Tái Lập Lịch):**
* Dùng token của `MEMBER` để gọi `POST /api/projects/[id]/reschedule`.
* Khẳng định: Nhận đúng HTTP 403 Forbidden. Chỉ Leader/PM/Admin mới có quyền tái lập lịch dự án.



---

## 5. TIÊU CHÍ NGHIỆM THU ĐẦU RA (DEFINITION OF DONE - DOD)

* [ ] Lệnh `npx tsc --noEmit` chạy sạch 100% không có cảnh báo kiểu dữ liệu.
* [ ] Bảng `rescheduling_events` được tự động ghi nhận mỗi khi tiến độ bị kéo dài.


* [ ] Thuật toán CPM cập nhật lại chính xác các giá trị $ES, EF, LS, LF$ của các task sau khi tái lập lịch.


* [ ] Vòng lặp Monte Carlo chạy dưới 50ms cho 1,000 lần lặp (sử dụng mảng số thực tối ưu trong memory).
* [ ] Toàn bộ 5 bài test trong `test/mod-08-reschedule.test.ts` vượt qua với kết quả đối soát DB thật.



---

