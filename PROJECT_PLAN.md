# 🎬 AI Video Editor Pro (Dự án Thương Mại)

Dự án này được định vị là một **Sản phẩm thương mại (Commercial Product)** chuyên nghiệp dành cho dân làm Affiliate / Reup. Công cụ giúp tự động hóa và nâng cao toàn bộ quy trình: Reup video -> Tẩy xóa sub cũ -> Dịch thuật -> Lồng tiếng AI -> Chỉnh sửa chuẩn CapCut -> Xuất video đa nền tảng.

## 🌟 Tính năng Cốt lõi (Advanced Features)

### 1. Xử lý Video Nâng cao (Video Manipulation)
- **Tùy chỉnh tỷ lệ khung hình (Aspect Ratio)**: Chuyển đổi linh hoạt tỷ lệ (9:16 cho TikTok/Reels, 16:9 cho YouTube, 1:1 cho FB). Hỗ trợ tính năng tự động fill nền mờ (Background Blur) hoặc Crop video nếu đổi tỷ lệ.
- **Xóa Sub/Watermark AI**: Tự động hoặc thủ công khoanh vùng phụ đề tiếng Trung cứng/Watermark trên video và dùng thuật toán làm mờ (Blur) hoặc AI Inpainting để tẩy sạch video gốc.

### 2. Trình chỉnh sửa Âm thanh & Lồng tiếng (Pro Audio Dubbing)
- **Auto-Sync & Time-Stretch (Tự động khớp thời gian)**: Thuật toán tự động phân tích độ dài gốc của câu tiếng Trung, sau đó tự động điều chỉnh tốc độ đọc (Speed) của giọng tiếng Việt sao cho khớp 100% với khoảng thời gian hiển thị trên video, giải quyết triệt để vấn đề độ dài ngôn ngữ khác nhau.
- **Preview từng câu lồng tiếng**: Người dùng có thể nghe thử giọng đọc AI cho từng câu sub riêng lẻ (để test xem AI đọc có ngắt nghỉ tự nhiên không) trước khi quyết định ghép vào video.
- **Cấu hình hàng loạt (Bulk Edit)**: Chọn 1 giọng đọc và tốc độ chuẩn, sau đó "Áp dụng cho tất cả", hoặc gán các giọng nam/nữ khác nhau cho từng dòng sub khác nhau.
- **Smart Audio Ducking (Auto-duck)**: Giống tính năng trên CapCut, tự động giảm nhỏ âm lượng nhạc nền (BGM) chỉ khi có giọng đọc tiếng Việt cất lên, và tăng BGM lại bình thường ở những khoảng lặng.

### 3. Giao diện Chỉnh sửa chuẩn CapCut (Pro Editor UI)
- **Timeline Đa track (Multi-track Timeline)**: Gồm Track Video, Track Nhạc, Track Giọng đọc (Audio), Track Phụ đề (Text). Người dùng có thể kéo thả viền để đổi thời lượng.
- **Subtitles Styling nâng cao**: Tùy chỉnh Font chữ, Outline (Viền), Background (Khung nền), Drop Shadow (Đổ bóng). Kéo thả và thay đổi kích thước chữ trực tiếp ngay trên khung Preview.
- **Quản lý Dự án (Project Management)**: Tự động lưu tiến trình đang làm (thành file Project `.aivp` hoặc database sqlite), cho phép tắt phần mềm và hôm sau mở lên làm tiếp.

---

## 🏗 Kiến trúc Hệ Thống
1. **Frontend (Tauri + React/Vite + TailwindCSS)**: 
   - Thư mục: `frontend/`
   - Đóng vai trò là Editor UI. Render Canvas siêu mượt, quản lý State phức tạp bằng `Zustand` hoặc `Redux` cho Timeline.
2. **Backend (Python + FastAPI)**:
   - Thư mục: `backend/`
   - Cung cấp API nội bộ cho UI. Gánh toàn bộ thuật toán xử lý: Tải qua downloader API riêng, Tách beat (`demucs`), Trích xuất Text (`faster-whisper`), TTS (`Edge-TTS/ElevenLabs`), Tẩy xóa & Render Render (`OpenCV/FFmpeg`).
3. **Local Database**: Dùng `SQLite` tích hợp thẳng vào app để lưu trạng thái các Project và Cấu hình người dùng.

---

## 🛤 Tiến độ thực hiện (Roadmap)

- [x] **Giai đoạn 1: Khởi tạo & Định hình sản phẩm**
  - [x] Khởi tạo cấu trúc `frontend` (Tauri/React) và `backend` (Python).
  - [x] Nâng cấp Scope dự án thành Sản phẩm thương mại (Thêm tính năng Aspect Ratio, Blur Sub, Preview Audio, Bulk Edit).
  
- [ ] **Giai đoạn 2: Xây dựng Core AI & Video Engine (Backend)**
  - [ ] Module Tải video & Tách âm thanh.
  - [ ] Module Xử lý hình ảnh: Làm mờ Sub/Watermark cứng.
  - [ ] Module Dịch thuật & TTS: Cho phép gen audio lẻ (Preview) và gen hàng loạt (Bulk). Xử lý thuật toán Time-stretch cho khớp hình.
  - [ ] Module FFmpeg Engine: Crop/Resize Video tỷ lệ 9:16, thuật toán Smart Audio Ducking và ghép Hardsub.

- [ ] **Giai đoạn 3: Xây dựng Pro Editor UI (Frontend)**
  - [x] Layout Editor phức tạp: Workspace, Multi-track Timeline, Properties Panel.
  - [ ] Interactive Canvas: Preview Crop video và kéo thả vị trí chữ trực tiếp.
  - [ ] Hệ thống Quản lý State & Lưu Project.

- [ ] **Giai đoạn 4: Đóng gói thương mại (Commercial Release)**
  - [ ] Tối ưu hóa UI/UX.
  - [ ] Cơ chế tải Model AI tự động để thu gọn file cài đặt.
  - [ ] Tích hợp cơ chế License Key/Login (nếu bạn định bán/thu phí).
  - [ ] Build file `.exe` (Windows) và `.dmg` (macOS).
