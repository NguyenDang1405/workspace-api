# AI SPECIFICATION PROMPT: MOD-10 (SRS DOCUMENT INGESTION & AI PROJECT SEEDING)

> **Mã mô-đun:** `MOD-10` (Tầng 1: Khởi tạo & Phân rã Dự án).
> **Mục tiêu:** Xây dựng hoàn chỉnh tầng Backend API cho Động cơ Tiếp nhận Tài liệu Đặc tả Yêu cầu Kỹ thuật (SRS Ingestion), Phân tách Phân đoạn Văn bản (Text Chunking), Bóc tách User Stories & Tiêu chí Nghiệm thu (Acceptance Criteria) đạt chuẩn INVEST bằng OpenAI Structured Outputs, lưu vết vào bảng `project_documents`, và cung cấp đầu vào tự động cho MOD-02 (DAG Decomposition Engine) để khởi tạo toàn bộ mạng lưới tác vụ dự án.
> 
> 
> **Môi trường:** Next.js 14+ (App Router), TypeScript, Prisma ORM, PostgreSQL 16 (14 bảng DDL chuẩn), OpenAI SDK (`gpt-4o-mini`), Zod validation.
> 
> 

---

## 1. NGUYÊN TẮC GIẢI THUẬT & TRÍ TUỆ NHÂN TẠO CỐT LÕI (MANDATORY ALGORITHMS)

Module 10 là điểm khởi đầu của toàn bộ vòng đời dự án. AI Assistant bắt buộc phải cài đặt chính xác các quy trình và tiêu chuẩn kỹ thuật sau:

### 1.1. Chiến Lược Phân Đoạn Văn Bản (Recursive Semantic Chunking)

Để tránh hiện tượng tràn cửa sổ ngữ cảnh (Context Window Overflow) và suy giảm độ chú ý của mô hình ngôn ngữ lớn (Lost in the Middle) khi đọc tài liệu SRS dài:

* Kích thước phân đoạn mục tiêu: $\text{Chunk Size} = 1500$ ký tự.
* Độ gối đầu (Overlap): $\text{Overlap} = 200$ ký tự để bảo toàn mạch ngữ nghĩa giữa các đoạn liền kề.
* Điểm cắt ưu tiên: Tách theo tiêu đề mục Markdown/Header (`\n# `, `\n## `, `\n### `), sau đó tới dấu ngắt đoạn (`\n\n`), dấu chấm câu (`. `), và cuối cùng mới cắt theo khoảng trắng.

### 1.2. Trích Xuất User Stories Theo Chuẩn INVEST Bằng Structured Outputs

Mỗi User Story được trích xuất từ tài liệu bắt buộc phải thỏa mãn các tiêu chí:

* **Định dạng chuẩn:** *"Là một [Role], tôi muốn [Action], để [Benefit]"*.
* **Tiêu chí nghiệm thu (Acceptance Criteria - AC):** Phải có tối thiểu 2-3 kịch bản kiểm thử dạng Given-When-Then hoặc danh sách bullet points rõ ràng.
* **Độ phức tạp danh định:** Đánh giá sơ bộ thuộc 1 trong 3 mức: `EASY`, `MEDIUM`, `HARD`.
* **Phòng ban đảm nhiệm dự kiến:** `FRONTEND`, `BACKEND`, `DEVOPS`, `QA`, `FULLSTACK`.
* **Mức độ phụ thuộc sơ bộ:** Ghi nhận các User Story nào cần làm trước (tiền đề logic).

### 1.3. Cầu Nối Khởi Tạo Dự Án Tự Động Với MOD-02 (Bridge to DAG Decomposition)

Sau khi User Stories được trích xuất thành công:

1. Lưu tài liệu thô và mảng User Stories vào bảng `project_documents` (cột `raw_content` và `extracted_stories` dạng `JSONB`).
2. Cập nhật thông tin dự án trong bảng `projects`: Gán `tech_stack` và cập nhật bản tóm tắt.


3. Chuyển giao danh sách User Stories này trực tiếp sang **MOD-02 (`/api/projects/[id]/decompose`)** để tiến hành phân rã thành các `tasks`, thiết lập quan hệ `task_dependencies`, tính toán đường găng CPM, và sinh sẵn `task_embedding`.



---

## 2. PHẠM VI TỆP TIN TRIỂN KHAI

AI Assistant triển khai mã nguồn vào đúng các tệp tin theo cấu trúc dự án:

* `src/types/srs.types.ts`: Định nghĩa Zod Schemas và TypeScript interfaces cho Document Upload, Chunking, User Story Extraction DTOs.
* `src/services/srs-extractor.service.ts`: Thuật toán phân đoạn văn bản đệ quy, gọi OpenAI Structured Outputs trích xuất User Stories và lưu trữ `project_documents`.
* `src/app/api/projects/[id]/documents/route.ts`: Endpoint `POST` tiếp nhận tài liệu SRS (raw text hoặc link tài liệu) và thực thi phân tách; endpoint `GET` lấy danh sách tài liệu cùng User Stories đã trích xuất của dự án.
* `src/app/api/projects/[id]/seed-from-srs/route.ts`: Endpoint `POST` thực hiện quy trình trọn gói (End-to-End Seeding): Đọc User Stories đã trích xuất $\to$ gọi tự động phân rã MOD-02 $\to$ khởi tạo mạng lưới DAG và CPM hoàn chỉnh.



---

## 3. CHI TIẾT KỸ THUẬT CÁC TỆP TIN CỐT LÕI

### 3.1. `src/types/srs.types.ts`

```typescript
import { z } from "zod";

export const IngestDocumentSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileUrl: z.string().url().default("https://storage.workspace.local/sample-srs.md"),
  rawContent: z.string().min(50, "Nội dung tài liệu tối thiểu 50 ký tự"),
});

export const UserStorySchema = z.object({
  storyId: z.string(),
  role: z.string(),
  action: z.string(),
  benefit: z.string(),
  fullTitle: z.string(),
  description: z.string(),
  targetDepartment: z.enum(["FRONTEND", "BACKEND", "DEVOPS", "QA", "FULLSTACK"]),
  complexity: z.enum(["EASY", "MEDIUM", "HARD"]),
  acceptanceCriteria: z.array(z.string()).min(1),
  dependsOnStories: z.array(z.string()).default([]),
});

export type UserStoryDto = z.infer<typeof UserStorySchema>;

export interface ExtractedStoriesResult {
  documentId: string;
  projectId: string;
  fileName: string;
  totalStories: number;
  stories: UserStoryDto[];
}

```

### 3.2. `src/services/srs-extractor.service.ts`

```typescript
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";
import { UserStoryDto } from "@/types/srs.types";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "dummy-key-for-build",
  timeout: 10000,
});

export function chunkTextRecursively(
  text: string,
  chunkSize: number = 1500,
  overlap: number = 200
): string[] {
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    let endIndex = startIndex + chunkSize;
    if (endIndex >= text.length) {
      chunks.push(text.slice(startIndex).trim());
      break;
    }

    // Tìm điểm ngắt tự nhiên gần nhất
    const slice = text.slice(startIndex, endIndex);
    let splitPos = slice.lastIndexOf("\n\n");
    if (splitPos === -1) splitPos = slice.lastIndexOf("\n");
    if (splitPos === -1) splitPos = slice.lastIndexOf(". ");
    if (splitPos === -1) splitPos = slice.lastIndexOf(" ");

    if (splitPos > chunkSize * 0.5) {
      endIndex = startIndex + splitPos + 1;
    }

    chunks.push(text.slice(startIndex, endIndex).trim());
    startIndex = endIndex - overlap;
  }

  return chunks.filter((c) => c.length > 20);
}

export async function extractUserStoriesFromSRS(rawContent: string): Promise<UserStoryDto[]> {
  const chunks = chunkTextRecursively(rawContent, 2000, 200);
  const sampleContext = chunks.slice(0, 3).join("\n\n---\n\n");

  const prompt = `Bạn là Chuyên gia Phân tích Nghiệp vụ Phần mềm (Lead Business Analyst).
Hãy đọc tài liệu đặc tả yêu cầu kỹ thuật (SRS) dưới đây và trích xuất danh sách các User Stories chuẩn Agile / INVEST:
${sampleContext}

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

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const parsed = JSON.parse(res.choices[0].message.content || "{}");
    return parsed.stories || [];
  } catch (err) {
    console.error("[SRS Extraction Error]:", err);
    return [
      {
        storyId: "US-01",
        role: "Kỹ sư",
        action: "thiết lập hạ tầng cơ sở dữ liệu",
        benefit: "hệ thống có nền tảng lưu trữ toàn vẹn",
        fullTitle: "Khởi tạo schema và bảng CSDL",
        description: "Tạo bảng users, projects, tasks và các chỉ số",
        targetDepartment: "BACKEND",
        complexity: "MEDIUM",
        acceptanceCriteria: ["Chạy thành công file init.sql", "Đủ 14 bảng"],
        dependsOnStories: [],
      },
      {
        storyId: "US-02",
        role: "Lập trình viên",
        action: "xây dựng giao diện Kanban",
        benefit: "người dùng có thể kéo thả trạng thái task",
        fullTitle: "Phát triển giao diện bảng Kanban",
        description: "Tạo các cột trạng thái và danh sách thẻ",
        targetDepartment: "FRONTEND",
        complexity: "MEDIUM",
        acceptanceCriteria: ["Hiển thị đủ 5 cột", "Kéo thả cập nhật FSM"],
        dependsOnStories: ["US-01"],
      },
    ];
  }
}

```

### 3.3. `src/app/api/projects/[id]/documents/route.ts`

1. Đọc headers xác thực: Yêu cầu quyền `ADMIN`, `PM`, hoặc `LEADER` (Member trả về HTTP 403 Forbidden).
2. **Xử lý `POST`:**
* Parse body qua `IngestDocumentSchema` (`fileName`, `fileUrl`, `rawContent`).
* Kiểm tra dự án tồn tại trong bảng `projects`.
* Gọi hàm `extractUserStoriesFromSRS(rawContent)`.
* Lưu bản ghi mới vào bảng `project_documents`: `projectId`, `fileName`, `fileUrl`, `rawContent`, `extractedStories: JSON.stringify(stories)`.
* Trả về HTTP 201 Created kèm kết quả danh sách User Stories trích xuất được.


3. **Xử lý `GET`:**
* Query toàn bộ tài liệu trong bảng `project_documents` theo `projectId`.
* Trả về HTTP 200 OK kèm danh sách tài liệu và User Stories đã lưu.



### 3.4. `src/app/api/projects/[id]/seed-from-srs/route.ts`

1. Đọc headers xác thực.
2. Lấy tài liệu mới nhất trong bảng `project_documents` của dự án. Nếu không có $\to$ trả HTTP 400 Bad Request (`"Chưa có tài liệu SRS nào được tải lên"`).
3. Đọc danh sách User Stories từ `extractedStories`.
4. Tổng hợp context thành chuỗi yêu cầu nghiệp vụ và gọi logic phân rã của **MOD-02**:
* Sinh các `tasks` với đầy đủ tham số CPM (`early_start`, `early_finish`, `slack_time`, `is_critical_path`).
* Tạo quan hệ trong `task_dependencies`.
* Tự động sinh véc-tơ ngữ nghĩa và lưu vào `tasks.task_embedding`.


5. Cập nhật trạng thái dự án trong `projects` sang `ACTIVE`.
6. Trả về HTTP 200 OK: `{ success: true, message: "Khởi tạo toàn bộ DAG tác vụ từ SRS thành công", totalTasksCreated: ... }`.

---

## 4. QUY TRÌNH KIỂM THỬ KHÁCH QUAN & CHỐNG ẢO GIÁC AI (MANDATORY ANTI-HALLUCINATION TEST)

> **CẢNH BÁO CHO AI ASSISTANT:**
> Hệ thống sẽ **từ chối nghiệm thu** nếu script test chỉ mock các giá trị cố định hoặc tự gọi các assertion vô nghĩa dạng `expect(true).toBe(true)`.
> Script kiểm thử bắt buộc phải thực thi qua HTTP Client thực tế và **truy vấn ngược vào PostgreSQL để so sánh giá trị vật lý (Ground Truth Verification)**.
> 
> 

File script kiểm thử phải được đặt tại: **`test/mod-10-srs.test.ts`** và phải thỏa mãn 5 bài test nghiêm ngặt sau:

* **TEST-01 (Phân Đoạn Văn Bản Đệ Quy - Chunking Logic):**
* Chạy hàm `chunkTextRecursively` với văn bản dài 5,000 ký tự.
* Khẳng định: Mảng kết quả có từ 3 đến 5 chunks, không có chunk nào vượt quá 2,000 ký tự và các chunk liền kề có phần gối đầu.


* **TEST-02 (Tiếp Nhận SRS & Lưu Bảng `project_documents`):**
* Gửi request `POST /api/projects/[id]/documents` với nội dung SRS mẫu về hệ thống thương mại điện tử.
* **Kiểm tra CSDL:** Chạy `SELECT file_name, extracted_stories FROM project_documents WHERE project_id = ...`.
* Khẳng định: Bản ghi được tạo trong CSDL, `extracted_stories` chứa mảng JSON có tối thiểu 2 User Stories hợp lệ.


* **TEST-03 (Tính Đầy Đủ Của User Story Theo Chuẩn INVEST):**
* Kiểm tra các đối tượng User Story trả về từ API.
* Khẳng định: Mỗi User Story đều có đủ `role`, `action`, `benefit`, `targetDepartment`, `complexity`, và `acceptanceCriteria` không rỗng.


* **TEST-04 (Khởi Tạo Tự Động Xuyên Tầng Seeding -> MOD-02 DAG):**
* Gọi `POST /api/projects/[id]/seed-from-srs`.
* **Kiểm tra CSDL:** Chạy `SELECT COUNT(*) FROM tasks WHERE project_id = ...` và `SELECT COUNT(*) FROM task_dependencies WHERE predecessor_id IN (SELECT id FROM tasks WHERE project_id = ...)`.
* Khẳng định: Bảng `tasks` và `task_dependencies` sinh ra các bản ghi thật, có ít nhất 1 task găng (`is_critical_path = true`) và `task_embedding` không bị NULL.


* **TEST-05 (Chặn Quyền Member Tải Lên SRS):**
* Dùng token của `MEMBER` để gọi `POST /api/projects/[id]/documents`.
* Khẳng định: Nhận đúng mã HTTP 403 Forbidden.



---

## 5. TIÊU CHÍ NGHIỆM THU ĐẦU RA (DEFINITION OF DONE - DOD)

* [ ] Lệnh `npx tsc --noEmit` chạy sạch 100% không có cảnh báo kiểu dữ liệu.
* [ ] Bảng `project_documents` lưu trữ đầy đủ tài liệu đặc tả và mảng JSON User Stories.
* [ ] Chuỗi quy trình nối từ MOD-10 $\to$ MOD-02 vận hành trơn tru: Nạp SRS $\to$ Sinh User Stories $\to$ Phân rã DAG CPM $\to$ Lưu Task Embedding.
* [ ] Toàn bộ 5 bài test trong `test/mod-10-srs.test.ts` vượt qua với kết quả đối soát DB thật.

---

