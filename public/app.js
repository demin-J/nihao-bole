const form = document.querySelector("#evaluateForm");
const submitBtn = document.querySelector("#submitBtn");
const cards = document.querySelector("#cards");
const summary = document.querySelector("#summary");
const modelHint = document.querySelector("#modelHint");
const providerHint = document.querySelector("#providerHint");
const healthDot = document.querySelector("#healthDot");
const healthText = document.querySelector("#healthText");
const template = document.querySelector("#resultCardTemplate");
const providerSelect = document.querySelector("#provider");
const apiKeyInput = document.querySelector("#apiKey");
const modelPresetSelect = document.querySelector("#modelPreset");
const customModelWrap = document.querySelector("#customModelWrap");
const customModelInput = document.querySelector("#customModelInput");
const modelIdInput = document.querySelector("#modelId");
const jobTitleInput = document.querySelector("#jobTitle");
const jdTextInput = document.querySelector("#jdText");
const jdPresetSelect = document.querySelector("#jdPreset");
const jdPresetHint = document.querySelector("#jdPresetHint");

const PROVIDER_OPTIONS = {
  qwen: {
    label: "千问",
    apiPlaceholder: "请输入千问 API Key（sk-...）",
    hint: "千问接口更常见，推荐新手优先选择。",
    models: [
      { id: "qwen-plus", label: "qwen-plus（默认）" },
      { id: "qwen-turbo", label: "qwen-turbo（更快）" },
      { id: "qwen-max", label: "qwen-max（效果更强）" },
    ],
    defaultModel: "qwen-plus",
  },
  kimi: {
    label: "Kimi",
    apiPlaceholder: "请输入 Kimi API Key（sk-...）",
    hint: "Kimi 也可直接使用，切换后请填写对应 Key。",
    models: [
      { id: "moonshot-v1-8k", label: "moonshot-v1-8k（默认）" },
      { id: "moonshot-v1-32k", label: "moonshot-v1-32k（长上下文）" },
      { id: "moonshot-v1-128k", label: "moonshot-v1-128k（超长上下文）" },
    ],
    defaultModel: "moonshot-v1-8k",
  },
  deepseek: {
    label: "DeepSeek",
    apiPlaceholder: "请输入 DeepSeek API Key（sk-...）",
    hint: "DeepSeek 推理能力较强，可用于更复杂简历判断。",
    models: [
      { id: "deepseek-chat", label: "deepseek-chat（默认）" },
      { id: "deepseek-reasoner", label: "deepseek-reasoner（推理增强）" },
    ],
    defaultModel: "deepseek-chat",
  },
};

const JD_PRESETS = {
  backend: {
    jobTitle: "后端工程师（Java/Go）",
    jdText:
      "岗位职责：负责核心业务服务的设计、开发与维护；参与系统架构优化和性能调优；保障接口稳定性与可观测性。\n任职要求：3年以上后端开发经验；熟悉 Java 或 Go；熟悉 MySQL/Redis/Kafka 等基础组件；具备微服务和高并发系统经验；有良好代码规范与协作能力。",
  },
  frontend: {
    jobTitle: "前端工程师（Web）",
    jdText:
      "岗位职责：负责 Web 前端页面与交互开发；推动组件化和工程化建设；与产品和后端协作落地业务需求。\n任职要求：熟悉 JavaScript/TypeScript；熟悉 React/Vue 至少一种；掌握前端工程化工具链；具备性能优化和问题排查能力。",
  },
  product: {
    jobTitle: "产品经理（B端）",
    jdText:
      "岗位职责：负责 B 端产品需求调研、方案设计和迭代规划；协调研发、测试、运营推进落地；跟踪核心指标并持续优化。\n任职要求：2年以上 B 端产品经验；具备优秀需求分析与文档能力；理解数据分析方法；有跨团队沟通与项目推动能力。",
  },
};

const STORAGE_KEYS = {
  provider: "nihao_bole_provider",
  apiKeyByProvider: "nihao_bole_api_key_by_provider",
  modelChoiceByProvider: "nihao_bole_model_choice_by_provider",
  customModelByProvider: "nihao_bole_custom_model_by_provider",
  jobTitle: "nihao_bole_job_title",
  jdText: "nihao_bole_jd_text",
};

restoreFormState();
initHealth();
providerSelect.addEventListener("change", handleProviderChange);
modelPresetSelect.addEventListener("change", handleModelPresetChange);
customModelInput.addEventListener("input", handleCustomModelInput);
apiKeyInput.addEventListener("input", persistProviderState);
jdPresetSelect.addEventListener("change", applyJdPreset);
jobTitleInput.addEventListener("input", persistJobAndJdState);
jdTextInput.addEventListener("input", persistJobAndJdState);
form.addEventListener("submit", handleSubmit);
syncProviderUI();
syncRecentPresetHint();

async function initHealth() {
  try {
    const resp = await fetch("/api/health");
    if (!resp.ok) throw new Error("health error");
    healthDot.classList.add("ok");
    healthText.textContent = "服务在线（可直接网页使用）";
  } catch {
    healthDot.classList.add("bad");
    healthText.textContent = "服务离线，请稍后重试";
  }
}

function handleProviderChange() {
  syncProviderUI();
  persistProviderState();
}

function syncProviderUI() {
  const provider = providerSelect.value;
  const providerConfig = PROVIDER_OPTIONS[provider];
  if (!providerConfig) return;

  restoreProviderBoundValues(provider);
  providerHint.textContent = providerConfig.hint;
  apiKeyInput.placeholder = providerConfig.apiPlaceholder;
  renderModelOptions(providerConfig);
  syncModelHint(providerConfig);
}

function renderModelOptions(providerConfig) {
  modelPresetSelect.innerHTML = "";
  for (const model of providerConfig.models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.label;
    modelPresetSelect.appendChild(option);
  }

  const customOption = document.createElement("option");
  customOption.value = "__custom__";
  customOption.textContent = "自定义模型";
  modelPresetSelect.appendChild(customOption);

  const choiceMap = readJsonStorage(STORAGE_KEYS.modelChoiceByProvider);
  const provider = providerSelect.value;
  const savedChoice = choiceMap[provider];
  const exists = providerConfig.models.some((item) => item.id === savedChoice);
  modelPresetSelect.value = exists ? savedChoice : savedChoice === "__custom__" ? "__custom__" : providerConfig.defaultModel;
  toggleCustomModelInput(modelPresetSelect.value === "__custom__");
  syncResolvedModelId();
}

function handleModelPresetChange() {
  toggleCustomModelInput(modelPresetSelect.value === "__custom__");
  syncResolvedModelId();
  persistProviderState();
}

function handleCustomModelInput() {
  syncResolvedModelId();
  persistProviderState();
}

function toggleCustomModelInput(visible) {
  customModelWrap.classList.toggle("hidden", !visible);
}

function syncResolvedModelId() {
  const selected = modelPresetSelect.value;
  const providerConfig = PROVIDER_OPTIONS[providerSelect.value];
  if (selected === "__custom__") {
    modelIdInput.value = customModelInput.value.trim();
    return;
  }
  modelIdInput.value = selected || providerConfig.defaultModel;
}

function syncModelHint(providerConfig) {
  const labels = providerConfig.models.map((item) => item.id).join(" / ");
  modelHint.textContent = `可选模型：${labels}（默认：${providerConfig.defaultModel}）`;
}

async function handleSubmit(event) {
  event.preventDefault();
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    showFriendlyError("请先填写 API Key。");
    apiKeyInput.focus();
    return;
  }
  syncResolvedModelId();
  if (!modelIdInput.value.trim()) {
    showFriendlyError("你选择了自定义模型，请先填写模型名。");
    customModelInput.focus();
    return;
  }

  persistJobAndJdState();
  persistProviderState();

  setLoading(true);
  cards.innerHTML = "";
  summary.textContent = "评估中，请稍候...";
  summary.classList.remove("muted");

  try {
    const fd = new FormData(form);
    const resp = await fetch("/api/evaluate", {
      method: "POST",
      body: fd,
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "评估失败");

    renderSummary(data.summary);
    renderCards(data.results || []);
    window.scrollTo({ top: summary.offsetTop - 12, behavior: "smooth" });
  } catch (error) {
    showFriendlyError(toFriendlyErrorMessage(error));
  } finally {
    setLoading(false);
  }
}

function renderSummary(s) {
  summary.textContent = `共 ${s.total} 份简历：优 ${s.excellent}，良 ${s.good}，淘汰 ${s.rejected}`;
}

function renderCards(results) {
  cards.innerHTML = "";
  for (const item of results) {
    const node = template.content.cloneNode(true);
    node.querySelector(".candidate").textContent = `${item.candidateName} (${item.resumeName})`;
    node.querySelector(".tier").textContent = item.fitTier;
    node.querySelector(".score").textContent = `${item.fitScore} 分`;
    node.querySelector(".conclusion").textContent = item.conclusion || "暂无结论";
    const auditToggleBtn = node.querySelector(".audit-toggle-btn");
    const auditBlock = node.querySelector(".audit-block");
    const auditGrid = node.querySelector(".audit-grid");
    node.querySelector(".job-family").textContent = formatJobFamily(item.jobFamily);

    const jdLines = [
      `硬性要求：${toInlineText(item?.jdStructured?.hardRequirements)}`,
      `关键职责：${toInlineText(item?.jdStructured?.keyResponsibilities)}`,
      `加分项：${toInlineText(item?.jdStructured?.plusItems)}`,
    ];
    fillList(node.querySelector(".jd-structured"), jdLines);

    fillList(node.querySelector(".weight-breakdown"), buildWeightLines(item));
    fillList(node.querySelector(".pro-common"), buildScoredItemLines(item?.professionalDetail?.commonItems));
    fillList(node.querySelector(".pro-specialized"), buildScoredItemLines(item?.professionalDetail?.specializedItems));
    auditToggleBtn.addEventListener("click", () => {
      const expanded = !auditBlock.classList.contains("hidden");
      auditBlock.classList.toggle("hidden", expanded);
      auditGrid.classList.toggle("hidden", expanded);
      auditToggleBtn.textContent = expanded ? "查看评分依据" : "收起评分依据";
    });

    fillList(node.querySelector(".strengths"), item.strengths);
    fillList(node.querySelector(".weaknesses"), item.weaknesses);

    const authLines = [
      `项目经历可信度：${item.authenticity.projectCredibility || "-"}`,
      `能力-经历匹配：${item.authenticity.capabilityMatch || "-"}`,
      `AI编写比例：${item.authenticity.aiWritingRatio}%`,
      `学历核验：${item.authenticity.educationCheck.details || "-"}`,
      `学历造假风险：${item.authenticity.educationCheck.fraudSuspected ? "是" : "否"}`,
    ];
    fillList(node.querySelector(".auth-list"), authLines);

    fillList(node.querySelector(".concerns"), item.coreConcerns);
    fillList(node.querySelector(".questions"), item.interviewQuestions);
    fillList(node.querySelector(".reject-reasons"), item.rejectReasons);

    const rejectWrap = node.querySelector(".reject-wrap");
    const concernWrap = node.querySelector(".concern-wrap");
    if (item.fitScore < 60) {
      concernWrap.style.display = "none";
    } else {
      rejectWrap.style.display = "none";
    }

    cards.appendChild(node);
    const canvas = cards.lastElementChild.querySelector(".radar");
    drawRadar(canvas, item.dimensions);
  }
}

function fillList(el, values) {
  el.innerHTML = "";
  const list = Array.isArray(values) && values.length ? values : ["暂无"];
  for (const text of list) {
    const li = document.createElement("li");
    li.textContent = text;
    el.appendChild(li);
  }
}

function drawRadar(canvas, dimensions) {
  const labels = ["价值观", "专业性", "成长性", "稳定性", "上手速度"];
  const values = [
    dimensions.values,
    dimensions.professionalism,
    dimensions.growth,
    dimensions.stability,
    dimensions.rampUpSpeed,
  ];

  // eslint-disable-next-line no-undef
  new Chart(canvas, {
    type: "radar",
    data: {
      labels,
      datasets: [
        {
          label: "五维评分",
          data: values,
          fill: true,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37,99,235,0.2)",
          pointBackgroundColor: "#1d4ed8",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: { stepSize: 20 },
        },
      },
    },
  });
}

function setLoading(loading) {
  submitBtn.disabled = loading;
  submitBtn.textContent = loading ? "评估中..." : "开始评估";
}

function toFriendlyErrorMessage(error) {
  const message = String(error?.message || "");
  if (message.includes("401") || message.includes("403")) {
    return "API Key 无效或权限不足，请检查后重试。";
  }
  if (message.includes("429")) {
    return "触发服务商限流/额度限制。请等待 30-60 秒后重试；若仍失败，请检查该 Key 是否有可用额度，或切换到另一家服务商。";
  }
  if (message.includes("500")) {
    return "服务暂时繁忙，请稍后重试。";
  }
  if (message.includes("timeout")) {
    return "请求超时。可能是服务商响应慢，请稍后重试。";
  }
  if (message.includes("JSON")) {
    return "模型返回格式异常，请重试一次或更换模型。";
  }
  return message || "评估失败，请稍后重试。";
}

function showFriendlyError(message) {
  summary.textContent = `评估失败：${message}`;
  summary.classList.add("muted");
}

function restoreFormState() {
  const savedProvider = localStorage.getItem(STORAGE_KEYS.provider);
  if (savedProvider === "qwen" || savedProvider === "kimi" || savedProvider === "deepseek") {
    providerSelect.value = savedProvider;
  }
  jobTitleInput.value = localStorage.getItem(STORAGE_KEYS.jobTitle) || "";
  jdTextInput.value = localStorage.getItem(STORAGE_KEYS.jdText) || "";
}

function persistProviderState() {
  const provider = providerSelect.value;
  localStorage.setItem(STORAGE_KEYS.provider, provider);

  const apiMap = readJsonStorage(STORAGE_KEYS.apiKeyByProvider);
  apiMap[provider] = apiKeyInput.value.trim();
  localStorage.setItem(STORAGE_KEYS.apiKeyByProvider, JSON.stringify(apiMap));

  const modelChoiceMap = readJsonStorage(STORAGE_KEYS.modelChoiceByProvider);
  modelChoiceMap[provider] = modelPresetSelect.value;
  localStorage.setItem(STORAGE_KEYS.modelChoiceByProvider, JSON.stringify(modelChoiceMap));

  const customModelMap = readJsonStorage(STORAGE_KEYS.customModelByProvider);
  customModelMap[provider] = customModelInput.value.trim();
  localStorage.setItem(STORAGE_KEYS.customModelByProvider, JSON.stringify(customModelMap));
}

function restoreProviderBoundValues(provider) {
  const apiMap = readJsonStorage(STORAGE_KEYS.apiKeyByProvider);
  const customModelMap = readJsonStorage(STORAGE_KEYS.customModelByProvider);
  apiKeyInput.value = apiMap[provider] || "";
  customModelInput.value = customModelMap[provider] || "";
}

function applyJdPreset() {
  const value = jdPresetSelect.value;
  if (!value) {
    return;
  }
  if (value === "recent") {
    const recentTitle = localStorage.getItem(STORAGE_KEYS.jobTitle) || "";
    const recentJd = localStorage.getItem(STORAGE_KEYS.jdText) || "";
    if (!recentTitle || !recentJd) {
      showFriendlyError("暂时没有最近一次填写记录，请先手动填写并评估一次。");
      jdPresetSelect.value = "";
      return;
    }
    jobTitleInput.value = recentTitle;
    jdTextInput.value = recentJd;
    summary.textContent = "已套用最近一次填写的岗位与 JD。";
    summary.classList.add("muted");
    return;
  }

  const preset = JD_PRESETS[value];
  if (!preset) {
    return;
  }
  jobTitleInput.value = preset.jobTitle;
  jdTextInput.value = preset.jdText;
  persistJobAndJdState();
  summary.textContent = `已套用模板：${preset.jobTitle}`;
  summary.classList.add("muted");
}

function persistJobAndJdState() {
  localStorage.setItem(STORAGE_KEYS.jobTitle, jobTitleInput.value.trim());
  localStorage.setItem(STORAGE_KEYS.jdText, jdTextInput.value.trim());
  syncRecentPresetHint();
}

function syncRecentPresetHint() {
  const hasRecent = Boolean(localStorage.getItem(STORAGE_KEYS.jobTitle) && localStorage.getItem(STORAGE_KEYS.jdText));
  const recentOption = jdPresetSelect.querySelector('option[value="recent"]');
  if (recentOption) {
    recentOption.disabled = !hasRecent;
  }
  jdPresetHint.textContent = hasRecent
    ? "可选“最近一次填写”快速复用上次的岗位与 JD。"
    : "暂无最近记录，手动填写后会自动保存。";
}

function readJsonStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function formatJobFamily(family) {
  if (family === "A") return "A类：行政/职能支持";
  if (family === "B") return "B类：通用业务岗";
  if (family === "C") return "C类：技术/产品岗";
  return "未识别岗位类别";
}

function toInlineText(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return "暂无";
  }
  return values.join("；");
}

function buildWeightLines(item) {
  const weights = item?.weightBreakdown || {};
  const lines = [
    `专业度权重：${toPercent(weights.professionalismWeight, 30)}`,
    `上手速度权重：${toPercent(weights.rampUpSpeedWeight, 30)}`,
    `成长性权重：${toPercent(weights.growthWeight, 20)}`,
    `价值观权重：${toPercent(weights.valuesWeight, 10)}`,
    `稳定性权重：${toPercent(weights.stabilityWeight, 10)}`,
  ];
  if (Number.isFinite(Number(weights.calculatedFitScore))) {
    lines.push(`加权计算总分：${Number(weights.calculatedFitScore)} 分`);
  }
  return lines;
}

function toPercent(value, fallbackPercent) {
  const num = Number(value);
  if (Number.isFinite(num) && num >= 0) {
    return `${Math.round(num * 100)}%`;
  }
  return `${fallbackPercent}%`;
}

function buildScoredItemLines(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return ["暂无细分项（本次结果可能来自旧版规则）"];
  }
  return items.map((item) => {
    const evidence = Array.isArray(item?.evidence) && item.evidence.length ? item.evidence.join("；") : "暂无证据";
    return `${item?.name || "未命名"}：${Number(item?.score || 0)} 分；证据：${evidence}`;
  });
}
