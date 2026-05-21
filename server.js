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
  deepseek: {
    name: "DeepSeek",
    endpoint: "https://api.deepseek.com/chat/completions",
    defaultModel: "deepseek-chat",
  },
};
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 90_000;
const DIMENSION_WEIGHTS = {
  values: 0.1,
  professionalism: 0.3,
  growth: 0.2,
  stability: 0.1,
  rampUpSpeed: 0.3,
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
    return res.status(400).json({ error: "provider 仅支持 qwen、kimi 或 deepseek。" });
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

      const parsed = await runEvaluationWithProcessGuard({
        providerConfig,
        apiKey: String(apiKey),
        modelId: modelId || providerConfig.defaultModel,
        prompt,
        resumeName: resume.name,
      });
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
  const dimensions = {
    values: clampNumber(raw?.dimensions?.values, 0, 100, 0),
    professionalism: clampNumber(raw?.dimensions?.professionalism, 0, 100, 0),
    growth: clampNumber(raw?.dimensions?.growth, 0, 100, 0),
    stability: clampNumber(raw?.dimensions?.stability, 0, 100, 0),
    rampUpSpeed: clampNumber(raw?.dimensions?.rampUpSpeed, 0, 100, 0),
  };
  const weightedFitScore = computeWeightedFitScore(dimensions);
  const educationFraud = Boolean(raw?.authenticity?.educationCheck?.fraudSuspected);
  const fitScore = educationFraud ? Math.min(weightedFitScore, 59) : weightedFitScore;

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
    jobFamily: normalizeJobFamily(raw.jobFamily),
    jdStructured: normalizeJdStructured(raw.jdStructured),
    professionalDetail: normalizeProfessionalDetail(raw.professionalDetail),
    weightBreakdown: {
      valuesWeight: DIMENSION_WEIGHTS.values,
      professionalismWeight: DIMENSION_WEIGHTS.professionalism,
      growthWeight: DIMENSION_WEIGHTS.growth,
      stabilityWeight: DIMENSION_WEIGHTS.stability,
      rampUpSpeedWeight: DIMENSION_WEIGHTS.rampUpSpeed,
      calculatedFitScore: fitScore,
    },
    fitScore,
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
    dimensions,
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

function computeWeightedFitScore(dimensions) {
  const weighted =
    dimensions.values * DIMENSION_WEIGHTS.values +
    dimensions.professionalism * DIMENSION_WEIGHTS.professionalism +
    dimensions.growth * DIMENSION_WEIGHTS.growth +
    dimensions.stability * DIMENSION_WEIGHTS.stability +
    dimensions.rampUpSpeed * DIMENSION_WEIGHTS.rampUpSpeed;
  return clampNumber(Math.round(weighted), 0, 100, 0);
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeJobFamily(value) {
  const family = String(value || "").trim().toUpperCase();
  if (family === "A" || family === "B" || family === "C") {
    return family;
  }
  return "C";
}

function normalizeJdStructured(value) {
  return {
    hardRequirements: toStringArray(value?.hardRequirements, 8),
    keyResponsibilities: toStringArray(value?.keyResponsibilities, 8),
    plusItems: toStringArray(value?.plusItems, 5),
  };
}

function normalizeProfessionalDetail(value) {
  return {
    commonItems: normalizeScoredItems(value?.commonItems),
    specializedItems: normalizeScoredItems(value?.specializedItems),
    commonScore: clampNumber(value?.commonScore, 0, 100, 0),
    specializedScore: clampNumber(value?.specializedScore, 0, 100, 0),
    finalScore: clampNumber(value?.finalScore, 0, 100, 0),
  };
}

function normalizeScoredItems(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => ({
      name: String(item?.name || "").trim(),
      score: clampNumber(item?.score, 0, 100, 0),
      evidence: toStringArray(item?.evidence, 2),
    }))
    .filter((item) => item.name);
}

async function runEvaluationWithProcessGuard({ providerConfig, apiKey, modelId, prompt, resumeName }) {
  const maxAttempts = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const appendedPrompt =
      attempt === 1
        ? prompt
        : `${prompt}\n\n【纠偏要求】上一次输出缺少流程字段。请严格补齐 jobFamily、jdStructured、professionalDetail 后重新输出完整 JSON。`;

    try {
      const responseText = await callModel({
        providerConfig,
        apiKey,
        modelId,
        prompt: appendedPrompt,
      });
      const raw = parseJsonFromText(responseText || "{}");
      validateEvaluationProcess(raw);
      return normalizeEvaluation(raw, resumeName);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `评估流程校验未通过：${formatError(lastError)}。请稍后重试。`
  );
}

function validateEvaluationProcess(raw) {
  const family = normalizeJobFamily(raw?.jobFamily);
  const hasFamily = family === "A" || family === "B" || family === "C";
  const hardReqs = toStringArray(raw?.jdStructured?.hardRequirements, 8);
  const keyResp = toStringArray(raw?.jdStructured?.keyResponsibilities, 8);
  const hasJdStruct = hardReqs.length > 0 && keyResp.length > 0;
  const hasProfessionalDetail =
    raw?.professionalDetail &&
    Number.isFinite(Number(raw?.professionalDetail?.commonScore)) &&
    Number.isFinite(Number(raw?.professionalDetail?.specializedScore)) &&
    Number.isFinite(Number(raw?.professionalDetail?.finalScore));
  const hasDimensions =
    Number.isFinite(Number(raw?.dimensions?.values)) &&
    Number.isFinite(Number(raw?.dimensions?.professionalism)) &&
    Number.isFinite(Number(raw?.dimensions?.growth)) &&
    Number.isFinite(Number(raw?.dimensions?.stability)) &&
    Number.isFinite(Number(raw?.dimensions?.rampUpSpeed));

  if (!hasFamily || !hasJdStruct || !hasProfessionalDetail || !hasDimensions) {
    throw new Error("模型未严格执行“先判岗+JD结构化，再打分”的流程。");
  }
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
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetch(providerConfig.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errText = await response.text();
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"), attempt);
      const limitHint = response.status === 429 ? "（可能触发频率或额度限制）" : "";

      if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_RETRIES) {
        await sleep(retryAfterMs);
        continue;
      }

      throw new Error(
        `${providerConfig.name} 调用失败（${response.status}）${limitHint}：${trimErrorBody(errText)}`
      );
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      if (attempt < MAX_RETRIES) {
        await sleep(1200 * attempt);
        continue;
      }
      throw new Error(`${providerConfig.name} 返回为空，请重试。`);
    }

    return normalizeModelContent(content);
  }

  throw new Error(`${providerConfig.name} 调用失败：多次重试后仍未成功。`);
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

function parseRetryAfterMs(retryAfterHeader, attempt) {
  const raw = String(retryAfterHeader || "").trim();
  if (/^\d+$/.test(raw)) {
    return Math.max(1000, Math.min(60_000, Number(raw) * 1000));
  }
  // 指数退避 + 上限，尽量避开 429 窗口
  return Math.min(12_000, 1500 * 2 ** (attempt - 1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
