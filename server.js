import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import multer from "multer";
import { extractTextFromFile } from "./lib/extractors.js";
import { buildEvaluationPrompt } from "./lib/prompt.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROVIDERS = {
  qwen: {
    name: "千问",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    defaultModel: "qwen-plus",
  },
  kimi: {
    name: "Kimi",
    endpoint: "https://api.moonshot.cn/v1/chat/completions",
    defaultModel: "moonshot-v1-8k",
  },
};

const app = express();
const upload = multer({ dest: path.join(__dirname, "uploads") });

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.post("/api/evaluate", upload.array("resumeFiles", 10), async (req, res) => {
  const files = req.files || [];
  const {
    provider = "qwen",
    apiKey,
    modelId,
    jobTitle,
    jdText,
    resumeTextInput = "",
  } = req.body;
  const providerConfig = PROVIDERS[String(provider)];
  if (!providerConfig) {
    await cleanupUploads(files);
    return res.status(400).json({ error: "provider 仅支持 qwen 或 kimi。" });
  }
  if (!apiKey) {
    await cleanupUploads(files);
    return res.status(400).json({ error: "API Key 不能为空，请使用者填写自己的 Key。" });
  }

  if (!jobTitle || !jdText) {
    await cleanupUploads(files);
    return res.status(400).json({ error: "岗位名称与 JD 不能为空。" });
  }

  try {
    const resumes = await collectResumesFromInput(files, resumeTextInput);
    if (resumes.length === 0) {
      return res.status(400).json({ error: "请至少提供一份简历（文本/PDF/图片）。" });
    }

    const results = [];
    for (const resume of resumes) {
      const prompt = buildEvaluationPrompt({
        jobTitle,
        jdText,
        resumeText: resume.text,
        resumeName: resume.name,
      });

      const responseText = await callModel({
        providerConfig,
        apiKey: String(apiKey),
        modelId: modelId || providerConfig.defaultModel,
        prompt,
      });

      const parsed = normalizeEvaluation(parseJsonFromText(responseText || "{}"), resume.name);
      results.push(parsed);
    }

    const sorted = [...results].sort((a, b) => b.fitScore - a.fitScore);
    return res.json({
      ok: true,
      summary: {
        total: sorted.length,
        excellent: sorted.filter((item) => item.fitTier === "优").length,
        good: sorted.filter((item) => item.fitTier === "良").length,
        rejected: sorted.filter((item) => item.fitTier === "淘汰").length,
      },
      results: sorted,
    });
  } catch (error) {
    return res.status(500).json({ error: formatError(error) });
  } finally {
    await cleanupUploads(files);
  }
});

const BASE_PORT = Number(process.env.PORT || 3000);
await startServerWithPortFallback(app, BASE_PORT, 10);

async function collectResumesFromInput(files, rawTextInput) {
  const list = [];

  const textBlocks = String(rawTextInput || "")
    .split(/\n\s*---+\s*\n/g)
    .map((s) => s.trim())
    .filter(Boolean);

  textBlocks.forEach((text, index) => {
    list.push({
      name: `文本简历-${index + 1}`,
      text,
    });
  });

  for (const file of files) {
    const extracted = await extractTextFromFile(file.path, file.originalname);
    if (extracted) {
      list.push({
        name: file.originalname,
        text: extracted,
      });
    }
  }

  return list;
}

function normalizeEvaluation(raw, resumeName) {
  const fitScore = clampNumber(raw.fitScore, 0, 100, 0);
  const educationFraud = Boolean(raw?.authenticity?.educationCheck?.fraudSuspected);

  let fitTier = raw.fitTier;
  if (educationFraud) {
    fitTier = "淘汰";
  } else if (fitScore < 60) {
    fitTier = "淘汰";
  } else if (fitScore <= 80) {
    fitTier = "良";
  } else {
    fitTier = "优";
  }

  return {
    candidateName: raw.candidateName || "未识别候选人",
    resumeName: raw.resumeName || resumeName,
    fitScore: educationFraud ? Math.min(fitScore, 59) : fitScore,
    fitTier,
    rejectReasons: Array.isArray(raw.rejectReasons) ? raw.rejectReasons.slice(0, 3) : [],
    authenticity: {
      projectCredibility: raw?.authenticity?.projectCredibility || "",
      capabilityMatch: raw?.authenticity?.capabilityMatch || "",
      aiWritingRatio: clampNumber(raw?.authenticity?.aiWritingRatio, 0, 100, 0),
      educationCheck: {
        degreeMatch: Boolean(raw?.authenticity?.educationCheck?.degreeMatch),
        timelineConsistency: Boolean(raw?.authenticity?.educationCheck?.timelineConsistency),
        majorMatch: Boolean(raw?.authenticity?.educationCheck?.majorMatch),
        fraudSuspected: educationFraud,
        details: raw?.authenticity?.educationCheck?.details || "",
      },
    },
    dimensions: {
      values: clampNumber(raw?.dimensions?.values, 0, 100, 0),
      professionalism: clampNumber(raw?.dimensions?.professionalism, 0, 100, 0),
      growth: clampNumber(raw?.dimensions?.growth, 0, 100, 0),
      stability: clampNumber(raw?.dimensions?.stability, 0, 100, 0),
      rampUpSpeed: clampNumber(raw?.dimensions?.rampUpSpeed, 0, 100, 0),
    },
    strengths: toStringArray(raw.strengths, 4),
    weaknesses: toStringArray(raw.weaknesses, 4),
    coreConcerns: fitScore >= 60 ? toStringArray(raw.coreConcerns, 2) : [],
    interviewQuestions: fitScore >= 60 ? toStringArray(raw.interviewQuestions, 3) : [],
    conclusion: raw.conclusion || "",
  };
}

function parseJsonFromText(content) {
  const text = String(content || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced) {
    return JSON.parse(fenced);
  }
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("模型输出不是合法 JSON，请重试或更换模型。");
  }
}

function toStringArray(value, max) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(Boolean).map((item) => String(item)).slice(0, max);
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(Math.max(num, min), max);
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function callModel({ providerConfig, apiKey, modelId, prompt }) {
  const payload = {
    model: modelId,
    messages: [
      {
        role: "system",
        content: "你是严谨的招聘评估助手。必须只返回合法 JSON，禁止返回额外解释。",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.2,
  };
  const response = await fetch(providerConfig.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${providerConfig.name} 调用失败（${response.status}）：${trimErrorBody(errText)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`${providerConfig.name} 返回为空，请重试。`);
  }
  return normalizeModelContent(content);
}

function normalizeModelContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item?.type === "text" && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .join("\n")
      .trim();
  }
  return String(content);
}

function trimErrorBody(errorBody) {
  const text = String(errorBody || "").trim();
  if (!text) {
    return "无详细错误信息";
  }
  return text.length > 240 ? `${text.slice(0, 240)}...` : text;
}

async function cleanupUploads(files) {
  await Promise.all(
    files.map(async (file) => {
      try {
        await fs.unlink(file.path);
      } catch {
        // Ignore missing temp files.
      }
    })
  );
}

async function startServerWithPortFallback(expressApp, preferredPort, maxRetries) {
  const tryListen = (port) =>
    new Promise((resolve, reject) => {
      const server = http.createServer(expressApp);
      server.once("error", (error) => reject(error));
      server.listen(port, () => resolve(server));
    });

  for (let i = 0; i <= maxRetries; i += 1) {
    const port = preferredPort + i;
    try {
      await tryListen(port);
      // eslint-disable-next-line no-console
      console.log(`你好伯乐服务已启动: http://localhost:${port}`);
      if (i > 0) {
        // eslint-disable-next-line no-console
        console.log(`检测到端口 ${preferredPort} 被占用，已自动切换到 ${port}`);
      }
      return;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EADDRINUSE" || i === maxRetries) {
        throw error;
      }
    }
  }
}
