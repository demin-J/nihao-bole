# 你好伯乐（可公开发布版）

“你好伯乐”是一个可视化网页应用，用于根据岗位 JD 自动评估候选人简历，输出：

- 岗位契合度分档：淘汰 / 良 / 优
- 简历真实度评估（项目可信度、能力匹配、AI 编写比例、学历核验）
- 五维雷达图（价值观、专业性、成长性、稳定性、上手速度）
- 60 分以上简历的核心顾虑（<=2）和 3 条面试追问

本版本已支持**公开部署**，访问者在网页里切换模型服务商并填写自己的 API Key 即可使用，不会占用你的 API。

## 1. 给使用者的极简说明（直接复制给对方）

使用者只要做两步：

1. 打开你分享的网页链接  
2. 在页面选择千问/Kimi/DeepSeek，填自己的 API Key，点击「开始评估」

不需要安装软件，不需要命令行，不需要本地启动任何服务。

## 2. 支持的模型服务商

- 千问（Qwen）
- Kimi
- DeepSeek

用户在前端可选择服务商并填写自己的 Key：

- 千问默认模型：`qwen-plus`
- Kimi 默认模型：`moonshot-v1-8k`
- DeepSeek 默认模型：`deepseek-chat`
- 每个服务商都提供模型下拉选择，也支持自定义模型名

## 3. 本地开发（可选）

```bash
cd /Users/zlxer/Desktop/你好伯乐
npm install
cp .env.example .env
npm run dev
```

访问：`http://localhost:3000`

`.env` 仅需：

```bash
PORT=3000
```

## 4. 公开发布（推荐 Render）

目标：发布后你不需要在本地启动，任何人拿到网址就能访问。

1. 将项目推送到 GitHub 仓库。
2. 打开 [Render](https://render.com/) 并创建 **Web Service**（也可直接使用仓库里的 `render.yaml` Blueprint）。
3. 连接你的 GitHub 仓库，按以下配置：
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
4. 环境变量设置：
   - `PORT`（可不填，Render 会自动注入）
5. 点击 Deploy，完成后会获得一个公开 URL（如 `https://xxx.onrender.com`）。

发布后，前端页面会要求每位使用者填写自己的千问/Kimi/DeepSeek API Key，再进行评估。

## 5. 输入支持

- 岗位名称 + JD 文本（必填）
- 支持“岗位/JD 模板”一键预填（并可继续修改）
- 支持复用“最近一次填写”的岗位与 JD
- 简历文本（可多份，用 `---` 分隔）
- PDF / 图片简历（可多选）

## 6. 结果规则（已内置）

- `fitScore < 60`：淘汰 + 淘汰理由
- `60 <= fitScore <= 80`：良，HR 可接触
- `fitScore > 80`：优
- 若识别到学历疑似造假，强制淘汰

## 7. 目录结构

```txt
你好伯乐/
  public/
    index.html
    style.css
    app.js
  lib/
    extractors.js
    prompt.js
  server.js
  package.json
  .env.example
```

