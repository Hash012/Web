# 财务数据智能分析平台

本项目为“财务数据智能分析”平台，支持多文件上传、AI智能分析、主副图可视化、决策建议等功能，前后端分离，适合本地或服务器一键部署。

---

## 目录结构

```
Nuclear_cloud/
├── client/    # 前端React + Vite
├── server/    # 后端Flask + AI接口
├── README.md  # 本说明
```

---

## 一、前端（React + Vite）

### 1. 环境要求
- Node.js ≥ 18.x（建议LTS）
- npm ≥ 9.x

### 2. 安装依赖
```bash
cd client
npm install
```

### 3. 启动开发环境
```bash
npm run dev
```
- 默认访问：http://localhost:5173

### 4. 主要依赖包
- react, react-dom, react-router-dom
- axios, classnames, dayjs
- recharts, react-markdown, remark-math, rehype-katex, katex
- @vitejs/plugin-react, eslint 等

### 5. 生产构建
```bash
npm run build
npm run preview
```

---

## 二、后端（Flask + AI接口）

### 1. 环境要求
- Python 3.9~3.11（推荐3.10）
- 推荐使用 Anaconda/Miniconda 管理环境

### 2. 安装依赖
```bash
cd server
conda create -n ncloud python=3.10  # 可选
conda activate ncloud
pip install -r requirements.txt
pip install requests numpy python-dateutil docx
```

#### OCR功能（如需图片识别）
- 需系统安装 Tesseract-OCR
  - Windows: [Tesseract下载](https://github.com/tesseract-ocr/tesseract)
  - 安装后将其路径加入环境变量

### 3. 配置
- 编辑 `server/config.py`，填写你的 DeepSeek API Token：
  ```python
  DEEPSEEK_API_TOKEN = "sk-xxxx..."  # 替换为你的Token
  DATABASE_PATH = "db/app.db"
  UPLOAD_FOLDER = "uploads"
  ```

### 4. 启动后端
```bash
python app.py
```
- 默认监听 http://localhost:5000

---

## 三、常见问题

1. **数据库自动建表**：首次运行自动生成 `server/db/app.db`，无需手动建表。
2. **AI接口不可用**：请确保 `DEEPSEEK_API_TOKEN` 有效，且服务器可访问外网。
3. **前后端联调**：开发时前端通过Vite代理API，生产环境可将前端build后静态文件交由Flask托管。
4. **文件上传支持**：xlsx、csv、docx、pdf、图片（jpg/png，需OCR）。
5. **Windows下OCR**：需手动安装Tesseract-OCR并配置环境变量。

---

## 四、快速启动流程

1. **后端**
   - 配置 `server/config.py`，填写API Token
   - 创建并激活conda环境，安装依赖
   - 启动后端：`python app.py`

2. **前端**
   - 进入 `client` 目录，安装依赖
   - 启动前端：`npm run dev`

3. **访问**
   - 前端：http://localhost:5173
   - 后端API：http://localhost:5000

---

如有问题欢迎反馈！ 