# Claude Session Manager (VS Code Extension)

**Tiếng Việt** | [English](README.md)

[![Visual Studio Code](https://img.shields.io/badge/VS%20Code-Extension-blue.svg)](https://marketplace.visualstudio.com)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-brightgreen.svg)]()
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Extension trực quan, siêu nhẹ và thời gian thực (real-time) giúp theo dõi, quản lý, phân loại và chuyển đổi nhanh giữa các session làm việc của **Claude Code** trực tiếp ngay trong VS Code. Hỗ trợ toàn diện cả **Issue/Ticket-based workflow (`#xxxx`)** lẫn **Chat tự do hàng ngày**.

---

## 💡 Vấn đề giải quyết

Khi sử dụng Claude Code (hoặc các AI agent tự động) cường độ cao:
- Bạn thường mở nhiều task cùng lúc nhưng không biết task nào **đang chạy**, task nào **đã xong**, task nào **đang dừng chờ duyệt lệnh (`need accept`)**.
- Lịch sử chat bị trôi, khó tìm lại đúng ngữ cảnh cũ.
- Khi cần duyệt lệnh terminal hoặc muốn quay lại cuộc trò chuyện cũ, phải gõ lệnh hoặc tìm ID thủ công.

**Claude Session Manager** quét trực tiếp runtime session và lịch sử của Claude Code trên máy bạn để tạo thành một bảng Dashboard trực quan 1-chạm ngay trên thanh công cụ của VS Code.

---

## ✨ Tính năng nổi bật

### 1. Giám sát trạng thái theo thời gian thực (Real-time OS Monitoring)
- 🔵 **ĐANG CHẠY (`Running`)**: Nhận diện chính xác theo tiến trình hệ điều hành (Process ID - PID). Chỉ khi nào tiến trình Claude đang thực thi thật sự trên OS thì mới xếp vào Đang chạy.
- 🟡 **CHỜ DUYỆT (`Need Accept`)**: Phát hiện ngay khoảnh khắc Claude dừng lại để xin phép bạn thực thi lệnh terminal nguy hiểm hoặc apply code diff.
- 🟢 **ĐÃ HOÀN THÀNH (`Done`)**: Các phiên làm việc đã hoàn tất turn.

### 2. Tự động tương thích 2 chế độ làm việc
- **Làm việc tự do (Không dùng Issue)**: Nếu bạn chỉ chat fix bug, test code bình thường (ví dụ: `fix auth bug`, `tets`, `xoá file cũ`), extension tự động lấy câu hỏi đầu tiên làm tiêu đề, không hiện rác `#0`.
- **Làm việc theo Issue / Ticket**: Tự động nhận diện cú pháp `#<số>` (ví dụ: `#100`, `#7152`, `#5433`) để gắn **Badge Issue màu xanh** nổi bật và làm sạch các đoạn text trùng lặp ở tiêu đề.

### 3. Thông báo đa điểm tiện lợi (2 vị trí)
- **Thanh Activity Bar (Sidebar bên trái)**: Icon **Claude Issues** kèm **Badge số màu cam/xanh** nhảy realtime khi có task cần duyệt lệnh.
- **Thanh Status Bar (Dưới đáy màn hình)**: Hiển thị nhanh số task đang xử lý (ví dụ: `🔔 Claude: 1 Chờ duyệt` hoặc `✨ Claude: 5 Tasks`), 1 click mở ngay panel.

### 4. 1-Click mở đúng cuộc trò chuyện (Instant Session Jump)
Click vào bất kỳ card nào trên giao diện ➔ VS Code sẽ kích hoạt trực tiếp Claude Code chuyển thẳng đến đúng session đó ngay lập tức.

### 5. Thống kê chi tiết & Thiết kế Clean, phẳng (No Bloat)
Mỗi card hiển thị đầy đủ thông số kỹ thuật được tối ưu trên 1 dòng gọn gàng, không emoji rườm rà:
- 🕒 **Thời gian tương đối**: `3 phút trước`, `2 giờ trước`, `5 ngày trước`...
- 💻 **Môi trường**: `<> VS Code` hoặc `Terminal`
- 🌿 **Git Branch**: Nhận diện đúng nhánh git đang làm việc
- ✨ **Model AI**: `Opus 5.5`, `Sonnet 3.7`, `Haiku 3.5`...
- 🗄️ **Tokens In / Out**: Quy đổi chuẩn `K`, `M`, `B` (vd: `1.5B · 2.4M ra`)
- 💵 **Chi phí ($ USD)**: Tổng tiền API tiêu thụ của session
- 💬 **Số lượt tương tác (Turns) & Session ID rút gọn** (8 ký tự)

### 6. Tốc độ mở 0ms & Tự động dọn dẹp Cache
- Sử dụng cơ chế In-Memory Cache và bộ đệm 64KB stream, mở extension là render ngay lập tức.
- Tự động phát hiện và loại bỏ các session mà file đã bị xóa trên máy, không lưu rác.

---

## 🛠️ Cài đặt

### Cách 1: Cài đặt từ file đóng gói `.vsix` (Khuyên dùng cho người dùng)

Tương thích hoàn toàn với macOS, Linux, và Windows mà không cần cài Node.js hay build code:

1. Tải file **`claude-session-manager-0.1.0.vsix`** từ Release hoặc thư mục gốc repository.
2. Mở VS Code, nhấn tổ hợp phím:
   - **macOS**: `Cmd + Shift + P`
   - **Windows / Linux**: `Ctrl + Shift + P`
3. Gõ:
   ```text
   Extensions: Install from VSIX...
   ```
4. Chọn file `claude-session-manager-0.1.0.vsix` và bấm **Install**.
5. Nhấn **Reload Window** (`Developer: Reload Window`).

---

### Cách 2: Cài đặt & Phát triển từ mã nguồn (Dành cho Developers)

```bash
# 1. Clone repository
git clone https://github.com/mquand/Claude-Session-Manager-.git
cd Claude-Session-Manager-

# 2. Cài đặt dependencies
npm install

# 3. Biên dịch mã nguồn TypeScript
npm run compile

# 4. Mở trong VS Code và nhấn phím F5 để chạy Debug
code .
```

---

## ⚙️ Cấu hình (Settings)

Extension tự động tìm kiếm theo đường dẫn mặc định của Claude Code trên máy tính của bạn:
- `~/.claude/projects` (lịch sử hội thoại `.jsonl`)
- `~/.claude/sessions` (runtime PID đang active)

Nếu bạn thay đổi cấu hình Claude Code sang thư mục khác:
1. Mở **Settings** (`Cmd + ,` hoặc `Ctrl + ,`).
2. Tìm từ khóa `Claude Session Manager`.
3. Tùy chỉnh:
   - `claudeSessionManager.storagePath`: Đường dẫn thư mục projects tùy chỉnh.
   - `claudeSessionManager.autoRefreshInterval`: Tần suất quét định kỳ (mặc định: `10` giây).

---

## 📦 Hướng dẫn đóng gói bản `.vsix` mới

Nếu bạn chỉnh sửa code và muốn đóng gói file cài đặt để chia sẻ hoặc phát hành lên GitHub Releases:

```bash
npm run compile
npx @vscode/vsce package --no-dependencies
```

---

## 🤝 Đóng góp & Phát triển (Contributing)

Mọi đóng góp, báo lỗi (Issues) hoặc tính năng mới (Pull Requests) đều được hoan nghênh:
1. Fork dự án
2. Tạo branch tính năng (`git checkout -b feature/tinh-nang-moi`)
3. Commit thay đổi (`git commit -m 'feat: thêm bộ lọc dự án'`)
4. Push branch (`git push origin feature/tinh-nang-moi`)
5. Mở Pull Request trên GitHub

---

## 📄 Bản quyền (License)

Dự án được phát hành theo giấy phép [MIT License](LICENSE).
