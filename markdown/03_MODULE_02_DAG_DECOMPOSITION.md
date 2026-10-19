Dưới đây là toàn bộ nội dung file Markdown đặc tả và chỉ dẫn thực thi (Prompt Specification) cho **MOD-02: Động cơ Phân rã Đồ thị DAG (DAG Decomposition Engine)** chuẩn theo kiến trúc 10 mô-đun phân tầng chuyên biệt.

Bản đặc tả này được thiết kế khớp $100\%$ với schema cơ sở dữ liệu vật lý 11 bảng, tích hợp trực tiếp **Thuật toán Kahn ($O(\vert{}V\vert{} + \vert{}E\vert{})$)** kiểm tra chu trình và **Phương pháp Đường găng (Critical Path Method - CPM)**.

Bạn hãy tạo file **`markdown/03_MODULE_02_DAG_DECOMPOSITION.md`** trong thư mục dự án và dán toàn bộ nội dung từ tiêu đề lớn `# AI SPECIFICATION PROMPT...` đến hết bài:

---

# AI SPECIFICATION PROMPT: MOD-02 (DAG DECOMPOSITION ENGINE)

> **Mã mô-đun:** `MOD-02` (Tầng 1: Tiếp nhận & Khởi tạo Dự án).
> **Mục tiêu:** Xây dựng hoàn chỉnh tầng Backend API cho Động cơ Phân rã Đồ thị Tác vụ (DAG Decomposition Engine) từ yêu cầu dự án, sử dụng OpenAI Structured Outputs sinh tập đỉnh $V$ (tác vụ) và tập cạnh $E$ (phụ thuộc), cài đặt Thuật toán Kahn kiểm tra chu trình và Phương pháp Đường găng (CPM) tính toán mốc thời gian.
> **Môi trường:** Next.js 14+ (App Router), TypeScript, Prisma ORM, PostgreSQL 16 (11 bảng DDL chuẩn), OpenAI SDK (`gpt-4o-mini`), Zod validation.
> 
> 

---

## 1. NGUYÊN TẮC GIẢI THUẬT & TOÁN HỌC CỐT LÕI (MANDATORY ALGORITHMS)

Module 2 đóng vai trò là "bộ não" lập kế hoạch của đồ án tốt nghiệp. AI Assistant bắt buộc phải cài đặt 2 giải thuật thuần túy bằng TypeScript trong tầng Service, không sử dụng thư viện bên ngoài:

### 1.1. Thuật toán Kahn Kiểm tra Chu trình & Sắp xếp Tô-pô ($O(\vert{}V\vert{} + \vert{}E\vert{})$)

* **Đầu vào:** Tập đỉnh $V$ (danh sách tasks) và tập cạnh có hướng $E$ (quan hệ phụ thuộc: $v_{\text{pred}} \to v_{\text{succ}}$).


* **Quy trình thực thi:**
1. Tính bán bậc vào (In-degree) cho tất cả các đỉnh trong $V$.
2. Đưa toàn bộ đỉnh có $\text{In-degree} = 0$ vào hàng đợi (Queue).
3. Lặp: Lấy đỉnh $u$ ra khỏi Queue, thêm $u$ vào mảng kết quả $\text{topologicalOrder}$. Duyệt qua các đỉnh kề $v$ mà $u \to v$, giảm $\text{In-degree}(v)$ đi 1. Nếu $\text{In-degree}(v) == 0$, đưa $v$ vào Queue.
4. **Kiểm tra Chu trình:** Nếu độ dài mảng $\text{topologicalOrder} < \vert{}V\vert{}$, đồ thị chứa chu trình khép kín (Deadlock / Circular Dependency). Ném lỗi nghiệp vụ `CYCLIC_DEPENDENCY_DETECTED` và từ chối lưu vào CSDL.





### 1.2. Phương pháp Đường găng (Critical Path Method - CPM)

Duyệt đồ thị xuôi và ngược dựa trên thứ tự tô-pô đã có:

* **Duyệt xuôi (Forward Pass):** Tính $ES$ (Thời điểm bắt đầu sớm nhất) và $EF$ (Thời điểm kết thúc sớm nhất):



$$ES(v) = \max_{u \in \text{Pred}(v)} (EF(u)), \quad EF(v) = ES(v) + \text{estimated\_hours}(v)$$




*(Với các task gốc không có tiền nhiệm: $ES = 0$)*.
* **Duyệt ngược (Backward Pass):** Tổng thời gian hoàn thành dự án $T_{\text{max}} = \max_{v \in V} (EF(v))$. Tính $LF$ (Kết thúc muộn nhất) và $LS$ (Bắt đầu muộn nhất):



$$LF(u) = \min_{v \in \text{Succ}(u)} (LS(v)), \quad LS(u) = LF(u) - \text{estimated\_hours}(u)$$




*(Với các task lá không có kế nhiệm: $LF = T_{\text{max}}$)*.
* **Độ trôi tự do (Slack Time):**

$$\text{Slack}(v) = LS(v) - ES(v)$$



* **Đánh dấu Đường găng:** Nếu $\text{Slack}(v) == 0$, gán cờ `is_critical_path = true`.



---

## 2. PHẠM VI TỆP TIN TRIỂN KHAI

AI Assistant cần triển khai mã nguồn vào đúng các tệp tin theo cấu trúc dự án:

* `src/types/dag.types.ts`: Định nghĩa Zod Schemas và TypeScript interfaces cho DAG Nodes, Edges, OpenAI Response và CPM metrics.
* `src/services/cpm.service.ts`: Chứa 2 hàm giải thuật thuần túy: `runKahnTopologicalSort` và `calculateCPM`.
* `src/app/api/projects/[id]/decompose/route.ts`: Endpoint `POST` tiếp nhận yêu cầu phân rã dự án, gọi OpenAI Structured Outputs sinh danh sách tasks/dependencies, chạy Kahn + CPM và lưu hàng loạt vào PostgreSQL trong Prisma Transaction.
* `src/app/api/projects/[id]/dag/route.ts`: Endpoint `GET` trả về cấu trúc nodes và edges chuẩn định dạng để Frontend render trực tiếp bằng **React Flow** (có bôi đỏ các node/cạnh thuộc đường găng).



---

## 3. CHI TIẾT KỸ THUẬT CÁC TỆP TIN CỐT LÕI

### 3.1. `src/types/dag.types.ts`

```typescript
import { z } from "zod";

// Schema ép kiểu OpenAI Structured Outputs
export const TaskItemGeneratedSchema = z.object({
  tempId: z.string().describe("Định danh tạm thời dạng T1, T2, T3..."),
  title: z.string().min(5),
  description: z.string().min(10),
  targetDepartment: z.enum(["FRONTEND", "BACKEND", "DEVOPS", "QA", "FULLSTACK"]),
  requiredLevel: z.enum(["INTERN", "FRESHER", "JUNIOR", "MIDDLE", "SENIOR"]),
  estimatedHours: z.number().min(1).max(40),
  predecessorTempIds: z.array(z.string()).describe("Mảng các tempId của các task phải hoàn thành trước task này"),
});

export const DecomposeProjectResponseSchema = z.object({
  tasks: z.array(TaskItemGeneratedSchema).min(5).max(30),
});

export interface CPMCalculatedTask {
  tempId: string;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  slackTime: number;
  isCriticalPath: boolean;
}

```

### 3.2. `src/services/cpm.service.ts`

```typescript
import { CPMCalculatedTask } from "@/types/dag.types";

export interface TaskNodeInput {
  tempId: string;
  estimatedHours: number;
  predecessors: string[]; // Danh sách tempId của task cha
}

export function runKahnAndCPM(tasks: TaskNodeInput[]): {
  topologicalOrder: string[];
  cpmResults: Map<string, CPMCalculatedTask>;
  projectMakespan: number;
} {
  // 1. Xây dựng đồ thị và tính bán bậc vào (In-degree)
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>(); // u -> list các v phụ thuộc u
  const taskMap = new Map<string, TaskNodeInput>();

  tasks.forEach((t) => {
    taskMap.set(t.tempId, t);
    inDegree.set(t.tempId, 0);
    adjList.set(t.tempId, []);
  });

  tasks.forEach((t) => {
    t.predecessors.forEach((predId) => {
      if (adjList.has(predId)) {
        adjList.get(predId)!.push(t.tempId);
        inDegree.set(t.tempId, (inDegree.get(t.tempId) || 0) + 1);
      }
    });
  });

  // 2. Thuật toán Kahn: Sắp xếp tô-pô & kiểm tra chu trình
  const queue: string[] = [];
  inDegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });

  const topologicalOrder: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    topologicalOrder.push(u);

    adjList.get(u)?.forEach((v) => {
      inDegree.set(v, inDegree.get(v)! - 1);
      if (inDegree.get(v) === 0) queue.push(v);
    });
  }

  // Nếu duyệt không đủ số đỉnh -> Đồ thị có chu trình khép kín
  if (topologicalOrder.length !== tasks.length) {
    throw new Error("CYCLIC_DEPENDENCY_DETECTED: Phát hiện chu trình phụ thuộc vòng tròn trong kế hoạch dự án.");
  }

  // 3. Phương pháp CPM: Duyệt xuôi (Forward Pass)
  const es = new Map<string, number>();
  const ef = new Map<string, number>();

  topologicalOrder.forEach((id) => {
    const task = taskMap.get(id)!;
    let maxPredEf = 0;
    task.predecessors.forEach((predId) => {
      maxPredEf = Math.max(maxPredEf, ef.get(predId) || 0);
    });
    es.set(id, maxPredEf);
    ef.set(id, maxPredEf + task.estimatedHours);
  });

  // Tính tổng thời gian hoàn thành dự án (Project Makespan)
  let projectMakespan = 0;
  ef.forEach((val) => {
    projectMakespan = Math.max(projectMakespan, val);
  });

  // 4. Phương pháp CPM: Duyệt ngược (Backward Pass)
  const lf = new Map<string, number>();
  const ls = new Map<string, number>();

  topologicalOrder.forEach((id) => {
    lf.set(id, projectMakespan);
  });

  for (let i = topologicalOrder.length - 1; i >= 0; i--) {
    const id = topologicalOrder[i];
    const task = taskMap.get(id)!;
    const successors = adjList.get(id) || [];

    if (successors.length > 0) {
      let minSuccLs = Infinity;
      successors.forEach((succId) => {
        minSuccLs = Math.min(minSuccLs, ls.get(succId)!);
      });
      lf.set(id, minSuccLs);
    }
    ls.set(id, lf.get(id)! - task.estimatedHours);
  }

  // 5. Tính Slack và xác định Đường găng
  const cpmResults = new Map<string, CPMCalculatedTask>();
  topologicalOrder.forEach((id) => {
    const earlyStart = es.get(id)!;
    const earlyFinish = ef.get(id)!;
    const lateStart = ls.get(id)!;
    const lateFinish = lf.get(id)!;
    const slackTime = Math.round((lateStart - earlyStart) * 10) / 10;
    const isCriticalPath = Math.abs(slackTime) < 0.001;

    cpmResults.set(id, {
      tempId: id,
      earlyStart,
      earlyFinish,
      lateStart,
      lateFinish,
      slackTime,
      isCriticalPath,
    });
  });

  return { topologicalOrder, cpmResults, projectMakespan };
}

```

---

## 4. CHI TIẾT CÁC ENDPOINT ROUTE HANDLERS

### 4.1. `POST /api/projects/[id]/decompose` (`src/app/api/projects/[id]/decompose/route.ts`)

1. Đọc headers `x-user-id` và `x-user-role`. Yêu cầu quyền: `ADMIN`, `PM`, hoặc `LEADER` (Member trả về HTTP 403 Forbidden).


2. Lấy thông tin dự án từ bảng `projects` (name, description, techStack). Nếu không tìm thấy $\to$ trả về HTTP 404.


3. Gọi OpenAI SDK với tính năng Structured Outputs (`response_format` sử dụng `zodResponseFormat(DecomposeProjectResponseSchema, "project_decomposition")`):
* **System Prompt:** *"Bạn là Giám đốc Kỹ thuật (Technical Architect). Hãy phân rã dự án phần mềm thành 10-25 tác vụ kỹ thuật chuẩn Đồ thị có hướng không chu trình (DAG). Mỗi tác vụ phải có tempId (T1, T2...), title, description, targetDepartment, requiredLevel, estimatedHours (1-20), và predecessorTempIds thể hiện quan hệ phụ thuộc tiên quyết logic (cơ sở dữ liệu trước API, backend trước frontend)."*


4. Parse và validate phản hồi từ OpenAI.


5. **Chạy hàm `runKahnAndCPM`:**
* Nếu phát hiện lỗi chu trình $\to$ Trả về HTTP 422 Unprocessable Entity kèm mã lỗi `CYCLIC_DEPENDENCY_DETECTED`.




6. **Mở Prisma Transaction lưu hàng loạt vào PostgreSQL:**
* Xóa các tasks cũ của dự án (nếu làm lại kế hoạch).
* Tạo Map lưu `tempId -> new_task_uuid`.
* Chèn toàn bộ tasks vào bảng `tasks` với trạng thái `SCHEDULED`, lưu các tham số CPM: `early_start`, `early_finish`, `late_start`, `late_finish`, `slack_time`, `is_critical_path`.


* Chèn các liên kết phụ thuộc vào bảng `task_dependencies` (`predecessor_id`, `successor_id`).




7. Trả về HTTP 200 OK kèm danh sách tasks đã lưu thành công và chỉ số `projectMakespan`.



### 4.2. `GET /api/projects/[id]/dag` (`src/app/api/projects/[id]/dag/route.ts`)

Chuẩn bị sẵn sàng cấu trúc dữ liệu cho thư viện **React Flow** của Frontend:

1. Query toàn bộ tasks của dự án và toàn bộ records trong `task_dependencies`.
2. Map dữ liệu thành:
* **`nodes`:** Mảng các đối tượng:
```typescript
{
  id: task.id,
  type: "taskNode",
  data: {
    title: task.title,
    department: task.targetDepartment,
    level: task.requiredLevel,
    estimatedHours: Number(task.estimatedHours),
    slackTime: Number(task.slackTime),
    isCriticalPath: task.isCriticalPath,
    status: task.status
  },
  position: { x: 0, y: 0 } // Frontend sẽ dùng thư viện dagre tự động tính tọa độ
}

```


* **`edges`:** Mảng các liên kết:
```typescript
{
  id: `e-${dep.predecessorId}-${dep.successorId}`,
  source: dep.predecessorId,
  target: dep.successorId,
  animated: isCriticalEdge,
  style: { stroke: isCriticalEdge ? "#ef4444" : "#94a3b8", strokeWidth: isCriticalEdge ? 3 : 1 }
}

```




3. Trả về HTTP 200 OK: `{ success: true, data: { nodes, edges, projectMakespan } }`.

---

## 5. TIÊU CHÍ NGHIỆM THU ĐẦU RA (DEFINITION OF DONE - DOD)

* [ ] Lệnh `npx tsc --noEmit` chạy thành công không có lỗi type.
* [ ] Hàm `runKahnAndCPM` chạy đúng và phát hiện được chu trình lặp giả lập (Unit Test pass).
* [ ] Gọi endpoint `/api/projects/[id]/decompose` sinh ra danh sách task và lưu thành công vào PostgreSQL.


* [ ] Bảng `task_dependencies` lưu đúng các cặp `predecessor_id` và `successor_id`.
* [ ] Endpoint `/api/projects/[id]/dag` trả về đầy đủ mảng `nodes` và `edges`, các task có `slackTime == 0` được đánh dấu `isCriticalPath = true`.


* [ ] Ràng buộc kiểm tra chu trình ở CSDL (`chk_no_self_dep`) không bị vi phạm.

---