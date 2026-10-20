# AI SPECIFICATION PROMPT: MIGRATION & SYNCHRONIZATION PLAN (MOD-01, MOD-02, MOD-03)

> **Mục tiêu:** Kế hoạch tổng thể và hướng dẫn chi tiết nhằm đồng bộ hóa mã nguồn của cả 3 mô-đun đầu tiên (MOD-01, MOD-02, MOD-03) theo đúng lược đồ cơ sở dữ liệu mở rộng 14 bảng trong `init.sql` và `prisma/schema.prisma`.
> 
> 
> **Nguyên tắc:** Đảm bảo toàn vẹn dữ liệu, triệt tiêu over-fetching, tận dụng tính năng lưu sẵn `task_embedding` và tối ưu hóa thời gian thực thi truy vấn tìm kiếm lai dưới 30ms.
> 
> 

---

## 1. QUY CHUẨN ĐẶT TÊN NHÁNH GIT (BRANCHING STRATEGY)

Để quản lý mã nguồn bài bản và dễ dàng kiểm soát thay đổi khi đẩy lên GitHub/GitLab:

* **Tên nhánh khuyến nghị cho đợt đồng bộ hóa này:**
```bash
feat/sync-schema-mod-01-02-03

```


* **Lệnh khởi tạo và chuyển nhánh:**
```bash
git checkout -b feat/sync-schema-mod-01-02-03

```


* **Lệnh commit sau khi hoàn thành từng bước:**
```bash
git commit -m "feat(core): synchronize MOD-01, MOD-02, MOD-03 with 14-table schema"
git push origin feat/sync-schema-mod-01-02-03

```



---

## 2. KẾ HOẠCH VÀ HƯỚNG CẬP NHẬT CHO TỪNG MÔ-ĐUN

### Bước 1: Cập Nhật MOD-01 (Auth & Talent Profile)

* **Vấn đề cần xử lý:** CSDL đã bổ sung cột `avatar_url` trong bảng `users`. Ngoài ra, model `User` trong Prisma hiện liên kết thêm nhiều bảng mới (`skillRatings`, `skillLogs`, `dispatchLogs`, `statusHistory`).


* **Hướng cập nhật:**
1. `src/types/index.ts`: Bổ sung `avatarUrl?: string | null` vào `RegisterSchema`, `UpdateProfileSchema`, `UserResponseDto` và `AuthMeDto`.
2. `src/app/api/auth/register/route.ts`: Nhận `avatarUrl` từ payload và lưu vào bảng `users`.


3. `src/app/api/auth/me/route.ts`: Bắt buộc dùng `select` tường minh các trường (`id`, `email`, `fullName`, `avatarUrl`, `role`, `isActive`, `authVersion`, `talentProfile`). Tuyệt đối không dùng `include` bừa bãi để tránh truy vấn quá nhiều bảng không cần thiết.


4. `src/app/api/users/route.ts`: Cập nhật `avatarUrl` và duy trì cơ chế non-blocking embedding cho hồ sơ cá nhân.





---

### Bước 2: Cập Nhật MOD-02 (DAG Decomposition & CPM Engine)

* **Vấn đề cần xử lý:** Bảng `tasks` đã được bổ sung cột `task_embedding VECTOR(1536)` (có chỉ mục HNSW) cùng các mốc thời gian `actual_hours`, `due_date`, `in_review_at`.


* **Hướng cập nhật:**
1. `src/app/api/projects/[id]/decompose/route.ts`:
* Sau khi nhận danh sách tác vụ từ OpenAI Structured Outputs và chạy xong thuật toán Kahn/CPM (`runKahnAndCPM`), tiến hành sinh véc-tơ ngữ nghĩa 1536 chiều cho từng tác vụ bằng hàm `generateProfileEmbedding` (chạy song song qua `Promise.all` với context: `${task.title} ${task.description}`).


* Trong transaction lưu dữ liệu vào bảng `tasks`, lưu trực tiếp chuỗi véc-tơ vào cột `task_embedding` bằng cú pháp raw `${vectorString}::vector`.


* Gán giá trị khởi tạo: `actual_hours: null`, `due_date: null`, `in_review_at: null`.




2. `src/app/api/projects/[id]/dag/route.ts`:
* Đảm bảo cấu trúc trả về cho React Flow giữ đúng định dạng `nodes` và `edges` chuẩn, không bị ảnh hưởng bởi các trường mới.







---

### Bước 3: Triển Khai Hoàn Thiện MOD-03 (Hybrid Retrieval Engine)

* **Vấn đề cần xử lý:** Tận dụng `task_embedding` đã được lưu sẵn trong bảng `tasks` ở MOD-02 để thực thi câu lệnh SQL CTE kết hợp BM25 (chỉ mục GIN) và Vector Cosine (chỉ mục HNSW) qua công thức $RRF(k=60)$ mà không cần gọi OpenAI API lúc runtime.


* **Hướng cập nhật:**
1. `src/types/retrieval.types.ts`: Định nghĩa `CandidatesQuerySchema` và `RankedCandidateDto`.


2. `src/services/hybrid-search.service.ts`:
* Đọc trực tiếp `task_embedding` từ bảng `tasks`. Nếu chưa có mới gọi OpenAI sinh bù.


* Chạy câu truy vấn SQL CTE qua `prisma.$queryRaw` với 4 khối chính: `task_meta`, `eligible_users` (lọc cấp bậc $\ge$ yêu cầu), `sparse_search` (BM25 qua GIN), `dense_search` (Cosine qua HNSW), `rrf_merge` (hợp nhất hạng nghịch đảo với $k = 60$) và `active_workloads` (đếm task `IN_PROGRESS`).




3. `src/app/api/tasks/[taskId]/candidates/route.ts`:
* Kiểm tra phân quyền: Chặn `MEMBER` (trả về HTTP 403 Forbidden).


* Trả về danh sách Top K ứng viên phù hợp nhất.







---

## 3. LỘ TRÌNH THỰC THI 4 BƯỚC CHO DEVELOPER / AI ASSISTANT

1. **Khởi động lại CSDL và sinh Prisma Client:**
```bash
docker compose down -v
docker compose up -d
npx prisma generate

```


2. **Tiến hành cập nhật code lần lượt theo thứ tự:** MOD-01 $\to$ MOD-02 $\to$ MOD-03.
3. **Kiểm tra tính toàn vẹn kiểu dữ liệu toàn dự án:**
```bash
npx tsc --noEmit

```


4. **Kiểm thử dữ liệu thực tế trong PostgreSQL:**
* Kiểm tra `tasks.task_embedding` không bị `NULL` sau khi decompose.


* Kiểm tra endpoint `/api/tasks/[taskId]/candidates` trả về kết quả RRF chính xác.





---
