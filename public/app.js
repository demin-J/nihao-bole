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
const modelInput = document.querySelector("#modelId");

const STORAGE_KEYS = {
  provider: "nihao_bole_provider",
  apiKeyByProvider: "nihao_bole_api_key_by_provider",
  modelByProvider: "nihao_bole_model_by_provider",
};

restoreFormState();
initHealth();
providerSelect.addEventListener("change", syncProviderHints);
form.addEventListener("submit", handleSubmit);
apiKeyInput.addEventListener("input", persistProviderState);
modelInput.addEventListener("input", persistProviderState);
syncProviderHints();

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

function syncProviderHints() {
  const provider = providerSelect.value;
  restoreProviderBoundValues(provider);

  if (provider === "qwen") {
    modelHint.textContent = "推荐模型：qwen-plus（默认）/ qwen-turbo";
    providerHint.textContent = "千问接口更常见，推荐新手优先选择。";
    modelInput.placeholder = "例如：qwen-plus";
    apiKeyInput.placeholder = "请输入千问 API Key（sk-...）";
    return;
  }

  modelHint.textContent = "推荐模型：moonshot-v1-8k（默认）/ moonshot-v1-32k";
  providerHint.textContent = "Kimi 也可直接使用，切换后请填写对应 Key。";
  modelInput.placeholder = "例如：moonshot-v1-8k";
  apiKeyInput.placeholder = "请输入 Kimi API Key（sk-...）";
}

async function handleSubmit(event) {
  event.preventDefault();
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    showFriendlyError("请先填写 API Key。");
    apiKeyInput.focus();
    return;
  }
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
    return "请求过于频繁，请稍后再试。";
  }
  if (message.includes("500")) {
    return "服务暂时繁忙，请稍后重试。";
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
  if (savedProvider === "qwen" || savedProvider === "kimi") {
    providerSelect.value = savedProvider;
  }
}

function persistProviderState() {
  const provider = providerSelect.value;
  localStorage.setItem(STORAGE_KEYS.provider, provider);

  const apiMap = readJsonStorage(STORAGE_KEYS.apiKeyByProvider);
  apiMap[provider] = apiKeyInput.value.trim();
  localStorage.setItem(STORAGE_KEYS.apiKeyByProvider, JSON.stringify(apiMap));

  const modelMap = readJsonStorage(STORAGE_KEYS.modelByProvider);
  modelMap[provider] = modelInput.value.trim();
  localStorage.setItem(STORAGE_KEYS.modelByProvider, JSON.stringify(modelMap));
}

function restoreProviderBoundValues(provider) {
  const apiMap = readJsonStorage(STORAGE_KEYS.apiKeyByProvider);
  const modelMap = readJsonStorage(STORAGE_KEYS.modelByProvider);
  apiKeyInput.value = apiMap[provider] || "";
  modelInput.value = modelMap[provider] || "";
}

function readJsonStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
