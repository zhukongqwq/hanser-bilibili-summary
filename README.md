# 📊 Bilibili History Analyzer & AI Profiler
# B站历史记录成分分析 & AI 深度画像生成器

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)
![Docker](https://img.shields.io/badge/Docker-Supported-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

这是一个基于 Node.js 的全栈应用，允许用户通过扫码登录 Bilibili，批量获取历史浏览记录，统计特定关键词（如“Hanser”）的浓度，并利用 AI（如 DeepSeek, OpenAI）生成深度的用户画像分析报告。

> **特色功能**：支持断点续传、多用户隔离、自定义标签统计、AI 深度分析、Docker 一键部署。

---

## ✨ 功能特性

- **🔐 安全登录**：使用 Bilibili 官方 APP 扫码登录，Cookie 本地/服务端加密存储（24小时自动过期）。
- **📈 成分统计**：
  - 实时统计特定关键词（Tag、标题、简介）的出现频率。
  - 支持**自定义标签**，用户可动态添加感兴趣的关键词。
  - Chart.js 可视化柱状图展示。
- **💾 断点续传**：
  - 自动保存爬取进度。
  - 支持暂停/继续，防止因网络中断或误触导致从头开始。
  - 服务端文件存储，支持多用户并发使用，数据互不干扰。
- **🧠 AI 深度画像**：
  - 将筛选后的高相关度视频数据发送给 AI。
  - 生成 Markdown 格式的深度分析报告（成分饼图、核心关键词、性格分析）。
  - 支持 **OpenAI 格式** 的所有 API（DeepSeek, Moonshot, ChatGPT 等）。
- **⚙️ 管理员后台**：
  - 独立的 `/admin` 管理页面。
  - 可配置 AI API 地址、Key、模型名称。
  - **自定义系统提示词 (System Prompt)**，定制 AI 的说话风格（如：毒舌、傲娇、专业分析师）。

---

## 🛠️ 快速开始 (本地运行)

### 前置要求
- Node.js 18.0 或更高版本

### 安装步骤

1. **克隆项目**
   ```bash
   git clone https://github.com/your-username/bili-history-analyzer.git
   cd bili-history-analyzer
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **启动服务**
   ```bash
   node server.js
   ```

4. **访问应用**
   - 前台页面：`http://localhost:3000`
   - 管理后台：`http://localhost:3000/admin`

---

## 🐳 Docker 部署 (推荐)

支持 Docker Compose 一键部署，适合部署在云服务器上供多人使用。

### 方法一：使用一键脚本 (Linux)

项目根目录下提供了 `deploy.sh` 脚本：

```bash
chmod +x deploy.sh
./deploy.sh
```

### 方法二：手动 Docker Compose

确保已安装 Docker 和 Docker Compose。

1. **构建并启动**
   ```bash
   docker-compose up -d --build
   ```

2. **查看日志**
   ```bash
   docker logs -f bili_hanser_app
   ```

3. **停止服务**
   ```bash
   docker-compose down
   ```

---

## ⚙️ 配置指南

### 1. 管理员后台配置
部署完成后，请第一时间访问 `http://你的IP:3000/admin` 进行配置。

- **默认密码**：`admin` (⚠️ 请在 `server.js` 中修改 `ADMIN_PASSWORD` 常量以确保安全)
- **API Base URL**：支持 OpenAI 通用格式。
  - DeepSeek: `https://api.deepseek.com` (系统会自动补全 `/chat/completions`)
  - OpenAI: `https://api.openai.com/v1`
  - 自建 OneAPI: `http://your-oneapi-domain/v1`
- **System Prompt**：你可以自定义 AI 的人设，例如：
  > "你是一个傲娇的二次元少女，根据用户的观看记录狠狠地吐槽他..."

### 2. 项目结构说明

```text
├── server.js            # 后端核心逻辑 (Express)
├── index.html           # 前端：扫描与统计页
├── analysis.html        # 前端：AI 分析报告页
├── admin.html           # 前端：管理员配置页
├── deploy.sh            # 一键部署脚本
├── Dockerfile           # Docker 构建文件
├── docker-compose.yml   # Docker 编排文件
├── user_data/           # [自动生成] 存放用户临时数据
└── server_config.json   # [自动生成] 存放 AI 配置信息
```

---

## ⚠️ 免责声明

1. **API 使用**：本项目仅用于学习和个人数据分析用途。使用的 Bilibili API 均为公开接口，但请勿进行高频滥用，否则可能导致 IP 被 B 站封禁。
2. **数据隐私**：
   - 用户的 Cookie 和浏览记录仅保存在服务器的 `user_data` 目录下。
   - 系统设有定时任务，**超过 24 小时未活跃的文件将被自动永久删除**。
   - 建议不要在公共的不受信任的服务器上使用此服务。
3. **AI 内容**：AI 生成的画像报告由第三方大模型提供，仅供娱乐，不代表绝对准确。

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！如果你有更好的 Prompt 创意或者 UI 优化建议，请随时分享。

## 📄 License

MIT License
