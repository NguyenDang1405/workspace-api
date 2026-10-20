# AI SPECIFICATION PROMPT: MOD-03 (HYBRID RETRIEVAL ENGINE)

> **Mã mô-đun:** `MOD-03` (Tầng 2: Truy hồi & Điều phối Thích ứng).
> **Mục tiêu:** Xây dựng hoàn chỉnh tầng Backend API và đường ống truy vấn Tìm kiếm lai (Hybrid Search Pipeline) trong PostgreSQL 16, kết hợp đồng thời Full-Text Search BM25 (chỉ mục GIN) và Vector Cosine (chỉ mục HNSW trên `pgvector`) thông qua thuật toán Hợp nhất Hạng nghịch đảo (Reciprocal Rank Fusion - RRF, $k = 60$) để xếp hạng ứng viên chuẩn xác mà không bị trôi dạt ngữ nghĩa.
> **Môi trường:** Next.js 14+ (App Router), TypeScript, Prisma ORM (`$queryRaw`), PostgreSQL 16 (`pgvector`, `citext`), OpenAI SDK (`text-embedding-3-small`), Zod validation.
> 
> 

---

## 1. NGUYÊN TẮC GIẢI THUẬT & TOÁN HỌC CỐT LÕI (MANDATORY ALGORITHMS)

Module 3 giải quyết bài toán chống trôi dạt ngữ nghĩa khi tìm kiếm kỹ sư theo yêu cầu kỹ thuật đặc thù:

### 1.1. Công thức Hợp nhất Hạng nghịch đảo (Reciprocal Rank Fusion - RRF)

Không chuẩn hóa điểm khoảng cách Cosine và điểm số BM25, hệ thống xếp hạng ứng viên dựa trên vị trí thứ tự trả về từ hai kênh:


$$RRF(u) = \sum_{m \in \{\text{Dense}, \text{Sparse}\}} \frac{1}{k + r_m(u)}$$

* $r_{\text{Sparse}}(u)$: Thứ hạng của ứng viên $u$ theo độ khớp từ khóa công nghệ qua thuật toán BM25 (`ts_rank_cd` trên `search_vector`).


* $r_{\text{Dense}}(u)$: Thứ hạng của ứng viên $u$ theo độ tương đồng ngữ nghĩa véc-tơ qua toán tử Cosine (`<=>` trên `skill_embedding`).


* $k = 60$: Hằng số làm mượt thực nghiệm chuẩn mực.



### 1.2. Logic Lọc Ứng viên Tiên quyết (Prerequisites Filter)

Một nhân sự $u$ chỉ được đưa vào danh sách ứng viên xét tuyển cho task $v$ khi thỏa mãn đồng thời:

1. `is_active = true`.


2. `department == v.target_department` (hoặc mở rộng liên phòng ban nếu có cờ `allow_cross_dept`).


3. `level >= v.required_level` (Intern: 1, Fresher: 2, Junior: 3, Middle: 4, Senior: 5).


4. Hồ sơ véc-tơ hợp lệ: `skill_embedding IS NOT NULL` và `embedding_revision == profile_revision`.



---

## 2. PHẠM VI TỆP TIN TRIỂN KHAI

AI Assistant cần triển khai mã nguồn vào đúng các tệp tin theo cấu trúc dự án:

* `src/types/retrieval.types.ts`: Định nghĩa Zod Schemas và TypeScript interfaces cho yêu cầu tìm kiếm ứng viên, tham số RRF và kết quả xếp hạng.
* `src/services/hybrid-search.service.ts`: Chứa logic tạo véc-tơ câu truy vấn và thực thi câu lệnh SQL CTE phức tạp qua `prisma.$queryRaw`.
* `src/app/api/tasks/[taskId]/candidates/route.ts`: Endpoint `GET` nhận `taskId`, tự động lấy thông tin task, thực thi Tìm kiếm lai RRF và trả về danh sách ứng viên được xếp hạng kèm điểm $RRF$, thứ hạng Sparse, thứ hạng Dense và số lượng task `IN_PROGRESS` hiện tại.



---

## 3. CHI TIẾT KỸ THUẬT CÁC TỆP TIN CỐT LÕI

### 3.1. `src/types/retrieval.types.ts`

```typescript
import { z } from "zod";

export const CandidatesQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(20).default(10),
  allowCrossDept: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

export interface RankedCandidateDto {
  userId: string;
  fullName: string;
  email: string;
  department: string;
  level: string;
  skills: string[];
  sparseRank: number | null;
  denseRank: number | null;
  rrfScore: number;
  activeWorkload: number;
}

```

### 3.2. `src/services/hybrid-search.service.ts`

Hàm tìm kiếm sử dụng trực tiếp câu lệnh SQL CTE tối ưu hóa với thời gian phản hồi mục tiêu dưới 30ms:

```typescript
import { prisma } from "@/lib/prisma";
import { generateProfileEmbedding } from "@/lib/openai";
import { RankedCandidateDto } from "@/types/retrieval.types";

export async function searchCandidatesForTask(
  taskId: string,
  limit: number = 10,
  allowCrossDept: boolean = false
): Promise<RankedCandidateDto[]> {
  // 1. Lấy thông tin task hiện tại
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      description: true,
      targetDepartment: true,
      requiredLevel: true,
    },
  });

  if (!task) {
    throw new Error("TASK_NOT_FOUND");
  }

  // 2. Tạo context query và sinh véc-tơ nhúng 1536 chiều
  const queryText = `${task.title} ${task.description}`;
  const queryEmbedding = await generateProfileEmbedding({
    department: task.targetDepartment,
    level: task.requiredLevel,
    skills: [],
    bioSummary: queryText,
  });

  if (!queryEmbedding) {
    throw new Error("EMBEDDING_GENERATION_FAILED");
  }

  const vectorString = `[${queryEmbedding.join(",")}]`;

  // 3. Thực thi SQL CTE kết hợp BM25 + Vector Cosine qua RRF (k = 60)
  const results = await prisma.$queryRaw<any[]>`
    WITH task_meta AS (
      SELECT 
        ${task.targetDepartment}::varchar AS target_dept,
        ${task.requiredLevel}::varchar AS req_level,
        websearch_to_tsquery('simple', ${queryText}) AS ts_query
    ),
    level_weights AS (
      SELECT * FROM (VALUES 
        ('INTERN', 1), ('FRESHER', 2), ('JUNIOR', 3), ('MIDDLE', 4), ('SENIOR', 5)
      ) AS t(lvl, weight)
    ),
    eligible_users AS (
      SELECT 
        u.id AS user_id,
        u.full_name,
        u.email,
        p.department,
        p.level,
        p.skills,
        p.skill_embedding,
        p.search_vector
      FROM users u
      JOIN user_talent_profiles p ON u.id = p.user_id
      JOIN task_meta tm ON true
      JOIN level_weights lw_user ON lw_user.lvl = p.level::text
      JOIN level_weights lw_req ON lw_req.lvl = tm.req_level
      WHERE u.is_active = true
        AND (${allowCrossDept} = true OR p.department::text = tm.target_dept)
        AND lw_user.weight >= lw_req.weight
        AND p.skill_embedding IS NOT NULL
        AND p.embedding_revision = p.profile_revision
    ),
    sparse_search AS (
      SELECT 
        eu.user_id,
        ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(eu.search_vector, tm.ts_query) DESC, eu.user_id
        ) AS rank_sparse
      FROM eligible_users eu
      CROSS JOIN task_meta tm
      WHERE eu.search_vector @@ tm.ts_query
      LIMIT 50
    ),
    dense_search AS (
      SELECT 
        eu.user_id,
        ROW_NUMBER() OVER (
          ORDER BY (eu.skill_embedding <=> ${vectorString}::vector) ASC, eu.user_id
        ) AS rank_dense
      FROM eligible_users eu
      LIMIT 50
    ),
    rrf_merge AS (
      SELECT 
        COALESCE(s.user_id, d.user_id) AS user_id,
        COALESCE(1.0 / (60.0 + s.rank_sparse), 0.0) +
        COALESCE(1.0 / (60.0 + d.rank_dense), 0.0) AS rrf_score,
        s.rank_sparse,
        d.rank_dense
      FROM sparse_search s
      FULL OUTER JOIN dense_search d ON s.user_id = d.user_id
    ),
    active_workloads AS (
      SELECT 
        t.assigned_to AS user_id,
        COUNT(t.id)::int AS workload_count
      FROM tasks t
      WHERE t.status = 'IN_PROGRESS'
      GROUP BY t.assigned_to
    )
    SELECT 
      u.id AS "userId",
      u.full_name AS "fullName",
      u.email,
      p.department,
      p.level,
      p.skills,
      rm.rank_sparse AS "sparseRank",
      rm.rank_dense AS "denseRank",
      ROUND(rm.rrf_score::numeric, 6)::float AS "rrfScore",
      COALESCE(aw.workload_count, 0)::int AS "activeWorkload"
    FROM rrf_merge rm
    JOIN users u ON u.id = rm.user_id
    JOIN user_talent_profiles p ON p.user_id = rm.user_id
    LEFT JOIN active_workloads aw ON aw.user_id = rm.user_id
    ORDER BY rm.rrf_score DESC, "activeWorkload" ASC
    LIMIT ${limit};
  `;

  return results.map((r) => ({
    userId: r.userId,
    fullName: r.fullName,
    email: r.email,
    department: r.department,
    level: r.level,
    skills: r.skills || [],
    sparseRank: r.sparseRank ? Number(r.sparseRank) : null,
    denseRank: r.denseRank ? Number(r.denseRank) : null,
    rrfScore: Number(r.rrfScore),
    activeWorkload: Number(r.activeWorkload),
  }));
}

```

---

## 4. CHI TIẾT ROUTE HANDLER

### `GET /api/tasks/[taskId]/candidates` (`src/app/api/tasks/[taskId]/candidates/route.ts`)

1. Xác thực người dùng qua Headers middleware: Yêu cầu quyền `ADMIN`, `PM`, hoặc `LEADER` (Member trả về HTTP 403 Forbidden).


2. Lấy `taskId` từ params.


3. Validate query params qua `CandidatesQuerySchema` (`limit`, `allowCrossDept`).


4. Gọi hàm `searchCandidatesForTask(taskId, limit, allowCrossDept)`.


5. Phản hồi HTTP 200 OK theo định dạng chuẩn:
```json
{
  "success": true,
  "data": {
    "taskId": "9b40bbc2-30a4-4e7e-81f5-453c37fd3d07",
    "candidates": [
      {
        "userId": "uuid-...",
        "fullName": "Nguyễn Văn A",
        "email": "a@workspace.com",
        "department": "BACKEND",
        "level": "MIDDLE",
        "skills": ["PostgreSQL", "Docker", "Redis"],
        "sparseRank": 1,
        "denseRank": 2,
        "rrfScore": 0.03252,
        "activeWorkload": 1
      }
    ]
  }
}

```


6. Xử lý lỗi ngoại lệ:
* Nếu `TASK_NOT_FOUND` $\to$ HTTP 404 Not Found.
* Nếu lỗi tạo embedding hoặc truy vấn $\to$ HTTP 500 Internal Server Error.



---

## 5. TIÊU CHÍ NGHIỆM THU ĐẦU RA (DEFINITION OF DONE - DOD)

* [ ] Lệnh `npx tsc --noEmit` chạy thành công không có lỗi type.
* [ ] Câu truy vấn SQL CTE thực thi hợp lệ trên PostgreSQL 16 không bị lỗi cú pháp `::vector` hay `tsvector`.


* [ ] Ứng viên có cả điểm Sparse (BM25) và Dense (Vector) được xếp hạng cao hơn ứng viên chỉ xuất hiện ở 1 kênh.


* [ ] Nhân sự có `level < task.required_level` hoặc `is_active = false` không bao giờ xuất hiện trong kết quả.


* [ ] Trường `activeWorkload` phản ánh đúng số task `IN_PROGRESS` của ứng viên đó trong CSDL.


* [ ] Member gọi API này bị chặn với đúng mã HTTP 403 Forbidden.



---
