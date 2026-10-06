const STORAGE_KEY = "jiujiang-sale-claim-mvp-v1";
const MEDIA_EVIDENCE_NOTE =
  "影音文件未编入本文档，请在法院平台按本证据编号另行上传。";
const PDF_VERTICAL_MARGIN_PT = (25 / 25.4) * 72;
const PDF_HORIZONTAL_MARGIN_PT = (16 / 25.4) * 72;

function identityMaterialId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `identity-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultIdentityMaterialName(type = "个人") {
  return type === "个人" ? "身份证" : "营业执照";
}

function createIdentityMaterial(type = "个人", overrides = {}) {
  return {
    id: identityMaterialId(),
    name: defaultIdentityMaterialName(type),
    ...overrides,
  };
}

function evidenceId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `evidence-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createEvidenceItem(kind = "document", overrides = {}) {
  const media = kind === "media";
  return {
    id: evidenceId(),
    kind: media ? "media" : "document",
    name: "",
    copyType: media ? "" : "复印件",
    source: "原告提供",
    purpose: "",
    note: media ? MEDIA_EVIDENCE_NOTE : "",
    mediaType: media ? "视频" : "",
    fileCount: media ? 1 : 0,
    ...overrides,
  };
}

/* 文书契约：法院上传栏目与可生成文书的唯一真相源，见 contracts/jiujiang.js
 * 表单渲染、校验、进度、风险提示、文书生成、AI 工具面全部从它派生。 */
const CONTRACT = window.JIUJIANG_CONTRACT;
if (!CONTRACT)
  throw new Error(
    "文书契约未加载：请确认 index.html 中 contracts/jiujiang.js 在 app.js 之前引入",
  );

const defaultState = {
  court: "",
  jurisdictionAgreement: "unknown",
  arbitration: "unknown",
  jurisdictionClause: "",
  jurisdictionBases: [],
  jurisdictionNote: "",
  plaintiffType: "个人",
  plaintiffName: "",
  plaintiffGender: "",
  plaintiffCountry: "中国",
  plaintiffIdType: "居民身份证",
  plaintiffLicenseType: "营业执照",
  plaintiffId: "",
  plaintiffPhone: "",
  plaintiffAddress: "",
  plaintiffRepresentative: "",
  plaintiffRepresentativeTitle: "",
  plaintiffRepresentativePhone: "",
  identityMaterials: [createIdentityMaterial("个人")],
  represented: "no",
  agentName: "",
  agentType: "律师",
  agentIdType: "",
  agentId: "",
  agentPhone: "",
  agentOrganization: "",
  agentLicenseNo: "",
  defendantType: "公司",
  defendantName: "",
  defendantGender: "",
  defendantCountry: "中国",
  defendantIdType: "",
  defendantLicenseType: "营业执照",
  defendantId: "",
  defendantPhone: "",
  defendantAddress: "",
  defendantActualAddress: "",
  defendantRepresentative: "",
  defendantRepresentativePhone: "",
  defendantInfoSource: "",
  contractForm: "",
  contractDate: "",
  contractName: "",
  dealFormation: "",
  deliveryReceipt: "",
  priceBasis: "",
  debtAcknowledgement: "",
  goods: "",
  deliveryDate: "",
  deliveryPlace: "",
  deliveryDetails: "",
  totalAmount: "",
  paidAmount: "",
  dueDate: "",
  qualityDispute: "no",
  paymentTerms: "",
  qualityDetails: "",
  demandHistory: "",
  claimInterest: false,
  interestTerms: "",
  claimCosts: true,
  claimAttorneyFee: false,
  attorneyFeeTerms: "",
  serviceRecipient: "",
  serviceSigner: "",
  serviceAddress: "",
  servicePostcode: "",
  servicePhone: "",
  serviceEmail: "",
  electronicService: "yes",
  includeRefundAccount: false,
  refundAccountName: "",
  refundBankName: "",
  refundBankAccount: "",
  refundPhone: "",
  evidence: [createEvidenceItem("document")],
};

let state = loadState();
let uploads = {
  plaintiff: [],
  agent: [],
  defendant: [],
  evidence: [],
};
let currentStep = 0;
let currentDoc = "complaint";
const pdfJsPromise = import("./vendor/pdf.min.mjs").then((pdfjs) => {
  pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";
  return pdfjs;
});
let pdfPreviewCache = null;
let pdfPreviewPending = null;
let pdfPreviewTimer = null;
let pdfPreviewGeneration = 0;
let currentReviewIssues = [];
let currentAiIssues = [];
let aiReviewSignature = "";
const stepMeta = [
  [
    "起诉状",
    "填写起诉状需要的当事人、交易、诉讼请求和管辖信息。",
  ],
  [
    "当事人身份证明",
    "核对原告身份信息并上传对应材料；重复内容已从起诉状同步。",
  ],
  [
    "被告线索（辅助）",
    "集中核对被告主体、地址和送达线索，帮助法院识别被告。",
  ],
  [
    "证据目录",
    "按编号整理图文或影音证据；图文页码和文件数量由系统自动计算。",
  ],
  [
    "送达确认和收款账户",
    "确认法院送达地址；需要时一并填写收款或退费账户。",
  ],
  ["核对与下载", "只显示需要修改的问题。"],
];

const STEP_DOCUMENTS = [
  "complaint",
  "plaintiff",
  "defendant",
  "evidence",
  "service",
  null,
];

const docLabels = Object.fromEntries(
  CONTRACT.documents.map((doc) => [doc.id, doc.title]),
);

const TEMPLATE_SOURCES = {
  complaint: {
    kind: "official",
    badge: "法院公开模板",
    name: "九江经开区法院《买卖合同纠纷起诉状模板》",
    detail: "按公开模板的结构和必备事项，根据本案填写内容自动成稿。其他受理法院仍可能要求补充。",
  },
  plaintiff: {
    kind: "rule",
    badge: "官方栏目要求 · 无固定表式",
    name: "人民法院在线服务“当事人身份证明”栏目",
    detail: "按材料编号整理原告身份证明；第一页列明材料名称、数量和页码，后续原件按类别连续排版。",
  },
  defendant: {
    kind: "helper",
    badge: "工具辅助 · 非官方模板",
    name: "被告线索辅助表",
    detail: "用于核对名称、地址和送达线索，不是法院平台的独立必传栏目；与原告身份证明分开整理。",
  },
  evidence: {
    kind: "official",
    badge: "法院公开模板",
    name: "九江经开区法院《原告证据目录模板》",
    detail: "按公开模板字段整理，并将图文证据与影音证据分表展示；图文页码和文件数量由系统自动计算。",
  },
  service: {
    kind: "official",
    badge: "法院公开模板",
    name: "九江经开区法院《送达地址确认书模板》",
    detail: "按公开模板填写送达地址、联系方式、电子送达选择和签署信息。",
  },
  refund: {
    kind: "official",
    badge: "法院公开模板 · 选传",
    name: "九江经开区法院《退费账户确认书》",
    detail: "仅在选择生成时使用，包含退费告知事项和收款账户信息。",
  },
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const oldTemplateNames = new Set([
      "订货记录、聊天记录或交易往来材料",
      "送货单、签收单或物流记录",
      "对账单及付款记录",
      "催款聊天记录或催款函",
    ]);
    const migratedEvidence = (saved?.evidence || [])
      .filter((item) => !oldTemplateNames.has(item.name))
      .map((item) => {
        const { pageNumbers: _legacyPageNumbers, ...legacyItem } = item;
        const kind = item.kind === "media" ? "media" : "document";
        return createEvidenceItem(kind, {
          ...legacyItem,
          id: item.id || evidenceId(),
          kind,
          note: kind === "media" ? MEDIA_EVIDENCE_NOTE : item.note || "",
          mediaType: kind === "media" ? item.mediaType || "视频" : "",
          fileCount:
            kind === "media"
              ? Math.max(1, Number(item.fileCount || 1))
              : 0,
        });
      });
    if (!migratedEvidence.length)
      migratedEvidence.push(createEvidenceItem("document"));
    const identityMaterials = (saved?.identityMaterials || []).map((item) => ({
      id: item.id || identityMaterialId(),
      name: String(item.name || ""),
    }));
    if (!identityMaterials.length)
      identityMaterials.push(
        createIdentityMaterial(saved?.plaintiffType || defaultState.plaintiffType),
      );
    return saved
      ? {
          ...defaultState,
          ...saved,
          identityMaterials,
          evidence: migratedEvidence,
        }
      : structuredClone(defaultState);
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const status = document.getElementById("saveStatus");
  status.textContent = "已自动保存";
  clearTimeout(saveState.timer);
  saveState.timer = setTimeout(
    () => (status.textContent = "表单已保存在本机"),
    1500,
  );
}

function money(value) {
  const number = Number(value || 0);
  return number.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function principal() {
  return Math.max(
    0,
    Number(state.totalAmount || 0) - Number(state.paidAmount || 0),
  );
}

/* 日期：未填时留灰色空位，已填时带标记，便于核对 */
function dateCn(value) {
  if (!value) return '<span class="blank">____年__月__日</span>';
  const [y, m, d] = value.split("-");
  return `<span class="filled">${y}年${Number(m)}月${Number(d)}日</span>`;
}

function todayCn() {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* 已填内容在屏幕预览里加标记，便于一眼核对；
 * 下载的 Word 稿与打印稿自动去掉（wordHtml 未定义 .filled，@media print 中和） */
function valueOr(value, fallback = '<span class="blank">________</span>') {
  return value ? `<span class="filled">${esc(value)}</span>` : fallback;
}

function hydrateForm() {
  document.querySelectorAll("[data-field]").forEach((el) => {
    const key = el.dataset.field;
    if (el.type === "checkbox") el.checked = Boolean(state[key]);
    else el.value = state[key] ?? "";
  });
  document.querySelectorAll("#jurisdictionChoices input").forEach((el) => {
    el.checked = state.jurisdictionBases.includes(el.value);
  });
  renderEvidence();
  renderUploads();
  updateCompanyFields();
  updateTradeFields();
  updateAgentFields();
  updateRefundAccountFields();
}

function bindForm() {
  document.getElementById("caseForm").addEventListener("input", (event) => {
    const el = event.target;
    if (el.matches("[data-field]")) {
      const previousValue = state[el.dataset.field];
      state[el.dataset.field] = el.type === "checkbox" ? el.checked : el.value;
      if (
        el.dataset.field === "plaintiffType" ||
        el.dataset.field === "defendantType"
      )
        updateCompanyFields();
      if (el.dataset.field === "plaintiffType")
        updateIdentityMaterialDefault(previousValue, state.plaintiffType);
      if (el.dataset.field === "contractForm") updateTradeFields();
      if (el.dataset.field === "represented") updateAgentFields();
      if (el.dataset.field === "includeRefundAccount")
        updateRefundAccountFields();
      syncDefaults(el.dataset.field);
      refresh();
    }
    if (el.closest("#jurisdictionChoices")) {
      state.jurisdictionBases = [
        ...document.querySelectorAll("#jurisdictionChoices input:checked"),
      ].map((input) => input.value);
      refresh();
    }
  });
}

function updateIdentityMaterialDefault(previousType, nextType) {
  const first = state.identityMaterials?.[0];
  if (!first || state.identityMaterials.length !== 1) return;
  if (identityFilesFor(first.id).length) return;
  const previousDefault = defaultIdentityMaterialName(previousType);
  if (!first.name || first.name === previousDefault)
    first.name = defaultIdentityMaterialName(nextType);
  renderIdentityMaterials();
}

function syncDefaults(changedKey) {
  if (
    changedKey === "plaintiffName" &&
    (!state.serviceRecipient ||
      state.serviceRecipient === state._lastPlaintiffName)
  ) {
    state.serviceRecipient = state.plaintiffName;
    state._lastPlaintiffName = state.plaintiffName;
  }
  if (changedKey === "plaintiffPhone" && !state.servicePhone)
    state.servicePhone = state.plaintiffPhone;
  if (changedKey === "plaintiffAddress" && !state.serviceAddress)
    state.serviceAddress = state.plaintiffAddress;
  if (changedKey === "plaintiffName" && !state.refundAccountName)
    state.refundAccountName = state.plaintiffName;
  if (changedKey === "plaintiffPhone" && !state.refundPhone)
    state.refundPhone = state.plaintiffPhone;
}

function updateCompanyFields() {
  document
    .querySelectorAll(".plaintiff-company")
    .forEach((el) =>
      el.classList.toggle("hidden", state.plaintiffType === "个人"),
    );
  document
    .querySelectorAll(".defendant-company")
    .forEach((el) =>
      el.classList.toggle("hidden", state.defendantType === "个人"),
    );
  document
    .querySelectorAll(".plaintiff-natural")
    .forEach((el) =>
      el.classList.toggle("hidden", state.plaintiffType !== "个人"),
    );
  document
    .querySelectorAll(".defendant-natural")
    .forEach((el) =>
      el.classList.toggle("hidden", state.defendantType !== "个人"),
    );
  const help = document.getElementById("plaintiffUploadHelp");
  if (help)
    help.textContent =
      state.plaintiffType === "个人"
        ? "个人请上传身份证正反面；系统只会列出你实际上传的文件。"
        : state.plaintiffType === "个体工商户"
          ? "请上传营业执照和经营者身份证；系统只会列出你实际上传的文件。"
          : "请上传营业执照、法定代表人身份证明及身份证；系统只会列出你实际上传的文件。";
}

function updateAgentFields() {
  document
    .getElementById("agentPanel")
    ?.classList.toggle("hidden", state.represented !== "yes");
}

function updateRefundAccountFields() {
  if (state.includeRefundAccount) {
    if (!state.refundAccountName) state.refundAccountName = state.plaintiffName;
    if (!state.refundPhone) state.refundPhone = state.plaintiffPhone;
  }
  document
    .getElementById("refundAccountPanel")
    ?.classList.toggle("hidden", !state.includeRefundAccount);
}

function hasWrittenContract() {
  return state.contractForm === "书面买卖合同";
}

function hasNoWrittenContract() {
  return Boolean(state.contractForm) && !hasWrittenContract();
}

function updateTradeFields() {
  document
    .getElementById("noContractPanel")
    ?.classList.toggle("hidden", !hasNoWrittenContract());
  document
    .querySelectorAll(".written-contract-only")
    .forEach((el) => el.classList.toggle("hidden", !hasWrittenContract()));
}

const EVIDENCE_FILE_ACCEPT =
  ".jpg,.jpeg,.png,.webp,.pdf,.docx,.xls,.xlsx,.csv,.txt";
const EVIDENCE_FILE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "pdf",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "txt",
]);

function evidenceFilesFor(id) {
  return uploads.evidence.filter((file) => file.evidenceId === id);
}

function evidenceFileType(name) {
  const ext = fileExtension(name);
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return "图片";
  if (ext === "pdf") return "PDF";
  if (ext === "docx") return "Word";
  if (["xls", "xlsx", "csv"].includes(ext)) return "表格";
  if (ext === "txt") return "文字";
  return "未知";
}

function evidenceFileTypes(files) {
  return [...new Set(files.map((item) => evidenceFileType(item.name)))];
}

function renderEvidence() {
  const list = document.getElementById("evidenceList");
  list.innerHTML = state.evidence
    .map((item, index) => {
      item.id ||= evidenceId();
      item.kind = item.kind === "media" ? "media" : "document";
      item.copyType ??= "复印件";
      item.source ??= "原告提供";
      item.mediaType = item.kind === "media" ? item.mediaType || "视频" : "";
      item.fileCount =
        item.kind === "media" ? Math.max(1, Number(item.fileCount || 1)) : 0;
      item.note = item.kind === "media" ? MEDIA_EVIDENCE_NOTE : item.note || "";
      const files = evidenceFilesFor(item.id);
      const types = evidenceFileTypes(files);
      const documentFields = `
        <label><span>文件类型</span><input value="${esc(types.join("、") || "待上传")}" readonly /></label>
        <label><span>文件数量</span><input value="${files.length}" readonly /></label>
        <label><span>原件/复印件</span><select aria-label="原件或复印件" data-evidence-key="copyType"><option ${item.copyType === "原件" ? "selected" : ""}>原件</option><option ${item.copyType === "复印件" ? "selected" : ""}>复印件</option><option ${item.copyType === "电子材料" ? "selected" : ""}>电子材料</option></select></label>`;
      const mediaFields = `
        <label><span>文件类型</span><select aria-label="影音文件类型" data-evidence-key="mediaType"><option ${item.mediaType === "视频" ? "selected" : ""}>视频</option><option ${item.mediaType === "录音" ? "selected" : ""}>录音</option></select></label>
        <label><span>文件数量</span><input type="number" min="1" step="1" aria-label="影音文件数量" data-evidence-key="fileCount" value="${item.fileCount}" /></label>`;
      const fileArea =
        item.kind === "document"
          ? `<label class="upload-zone compact evidence-group-upload" for="evidenceFiles-${esc(item.id)}"><b>上传本编号的图文文件</b><span>支持图片、PDF、DOCX、表格和TXT，可一次选择多个</span><input id="evidenceFiles-${esc(item.id)}" data-evidence-file-input="${esc(item.id)}" type="file" multiple accept="${EVIDENCE_FILE_ACCEPT}" /></label>
             <div class="evidence-group-files">${files
               .map(
                 (file) => `<div class="file-chip"><span title="${esc(file.name)}">${esc(file.name)} · ${readableSize(file.size)}</span><button type="button" data-remove-evidence-file="${esc(file.id)}" aria-label="移除${esc(file.name)}">×</button></div>`,
               )
               .join("")}</div>`
          : `<div class="media-upload-note"><b>影音文件请自行上传</b><span>本助手只把这项证据写入影音证据目录，不接收录音或视频原文件。</span></div>`;
      return `
    <div class="evidence-row evidence-row-${item.kind}" data-evidence-index="${index}" data-evidence-id="${esc(item.id)}">
      <span class="index">${String(index + 1).padStart(2, "0")}</span>
      <div class="evidence-row-main">
        <div class="evidence-kind-line"><span class="evidence-kind-badge">${item.kind === "media" ? "影音证据" : "图文证据"}</span><small>${item.kind === "media" ? "另行上传影音文件" : `已上传 ${files.length} 个文件`}</small></div>
        <div class="evidence-editor-fields">
        <label><span>证据名称</span><input aria-label="证据名称" data-evidence-key="name" value="${esc(item.name)}" placeholder="证据名称" /></label>
        ${item.kind === "media" ? mediaFields : documentFields}
        <label><span>证据来源</span><input aria-label="证据来源" data-evidence-key="source" value="${esc(item.source)}" placeholder="如：原告提供" /></label>
        <label class="wide"><span>证明内容</span><input aria-label="证明内容" data-evidence-key="purpose" value="${esc(item.purpose)}" placeholder="证明什么事实" /></label>
        <label class="wide"><span>备注</span><input aria-label="备注" data-evidence-key="note" value="${esc(item.note)}" ${item.kind === "media" ? "readonly" : 'placeholder="没有可留空"'} /></label>
        </div>
        ${fileArea}
      </div>
      <button type="button" class="remove-evidence" aria-label="删除这项证据" ${state.evidence.length === 1 ? "disabled" : ""}>×</button>
    </div>`;
    })
    .join("");
  list.querySelectorAll("[data-evidence-key]").forEach((input) => {
    const update = (event) => {
      const row = event.target.closest("[data-evidence-index]");
      const key = event.target.dataset.evidenceKey;
      const value =
        key === "fileCount"
          ? Math.max(1, Math.floor(Number(event.target.value || 1)))
          : event.target.value;
      if (value !== event.target.value) event.target.value = value;
      state.evidence[Number(row.dataset.evidenceIndex)][key] = value;
      refresh(false);
    };
    input.addEventListener("input", update);
    input.addEventListener("change", update);
    input.addEventListener("blur", update);
  });
  list.querySelectorAll(".remove-evidence").forEach((button) =>
    button.addEventListener("click", (event) => {
      const index = Number(
        event.target.closest("[data-evidence-index]").dataset.evidenceIndex,
      );
      if (state.evidence.length === 1) return;
      const [removed] = state.evidence.splice(index, 1);
      uploads.evidence = uploads.evidence.filter(
        (item) => item.evidenceId !== removed.id,
      );
      renderEvidence();
      refresh();
    }),
  );
  list.querySelectorAll("[data-evidence-file-input]").forEach((input) =>
    input.addEventListener("change", (event) => {
      handleEvidenceFiles(event.target.dataset.evidenceFileInput, event.target.files);
      event.target.value = "";
    }),
  );
  list.querySelectorAll("[data-remove-evidence-file]").forEach((button) =>
    button.addEventListener("click", () => {
      uploads.evidence = uploads.evidence.filter(
        (item) => item.id !== button.dataset.removeEvidenceFile,
      );
      renderEvidence();
      refresh(false);
    }),
  );
}

function fileId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function identityMaterialTypes(type = state.plaintiffType) {
  if (type === "个人") return ["身份证", "户口簿", "其他身份证明"];
  if (type === "个体工商户")
    return ["营业执照", "经营者身份证", "其他主体资格材料"];
  return [
    "营业执照",
    "法定代表人身份证明",
    "法定代表人身份证",
    "其他主体资格材料",
  ];
}

function identityFilesFor(materialId) {
  return uploads.plaintiff.filter((item) => item.materialId === materialId);
}

function handleIdentityFiles(materialId, fileList) {
  const rejected = [];
  for (const file of [...fileList]) {
    if (!["pdf", "docx", "jpg", "jpeg", "png"].includes(fileExtension(file.name))) {
      rejected.push(file.name);
      continue;
    }
    uploads.plaintiff.push({
      id: fileId(),
      materialId,
      name: file.name,
      size: file.size,
      file,
    });
  }
  renderIdentityMaterials();
  refresh(false);
  if (rejected.length)
    toast(`这些文件不能可靠排版，请转换后再上传：${rejected.join("、")}`);
}

function renderIdentityMaterials() {
  const target = document.getElementById("identityMaterialList");
  if (!target) return;
  const options = identityMaterialTypes();
  target.innerHTML =
    state.identityMaterials
      .map((material, index) => {
        material.id ||= identityMaterialId();
        const files = identityFilesFor(material.id);
        return `<div class="identity-material-row" data-identity-material-index="${index}" data-identity-material="${esc(material.id)}">
          <span class="index">${String(index + 1).padStart(2, "0")}</span>
          <div class="identity-material-main">
            <div class="identity-material-fields">
              <label><span>材料名称</span><input list="identityMaterialOptions" data-identity-material-name value="${esc(material.name)}" placeholder="填写或选择材料名称" /></label>
              <label><span>文件数量</span><input value="${files.length}" readonly /></label>
            </div>
            <label class="upload-zone compact identity-group-upload" for="identityFiles-${esc(material.id)}"><b>上传本编号的身份文件</b><span>支持PDF、DOCX、JPG和PNG，可一次选择多个</span><input id="identityFiles-${esc(material.id)}" data-identity-file-input="${esc(material.id)}" type="file" multiple accept=".pdf,.docx,.jpg,.jpeg,.png" /></label>
            <div class="identity-group-files">${files
              .map(
                (file) => `<div class="file-chip"><span title="${esc(file.name)}">${esc(file.name)} · ${readableSize(file.size)}</span><button type="button" data-remove-identity-file="${esc(file.id)}" aria-label="移除${esc(file.name)}">×</button></div>`,
              )
              .join("")}</div>
          </div>
          <button type="button" class="remove-identity-material" aria-label="删除这项身份材料" ${state.identityMaterials.length === 1 ? "disabled" : ""}>×</button>
        </div>`;
      })
      .join("") +
    `<datalist id="identityMaterialOptions">${options.map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist>`;

  target.querySelectorAll("[data-identity-material-name]").forEach((input) => {
    const update = (event) => {
      const row = event.target.closest("[data-identity-material-index]");
      state.identityMaterials[Number(row.dataset.identityMaterialIndex)].name =
        event.target.value;
      refresh(false);
    };
    input.addEventListener("input", update);
    input.addEventListener("change", update);
  });
  target.querySelectorAll("[data-identity-file-input]").forEach((input) =>
    input.addEventListener("change", (event) => {
      handleIdentityFiles(event.target.dataset.identityFileInput, event.target.files);
      event.target.value = "";
    }),
  );
  target.querySelectorAll("[data-remove-identity-file]").forEach((button) =>
    button.addEventListener("click", () => {
      uploads.plaintiff = uploads.plaintiff.filter(
        (item) => item.id !== button.dataset.removeIdentityFile,
      );
      renderIdentityMaterials();
      refresh(false);
    }),
  );
  target.querySelectorAll(".remove-identity-material").forEach((button) =>
    button.addEventListener("click", (event) => {
      if (state.identityMaterials.length === 1) return;
      const row = event.target.closest("[data-identity-material-index]");
      const index = Number(row.dataset.identityMaterialIndex);
      const [removed] = state.identityMaterials.splice(index, 1);
      uploads.plaintiff = uploads.plaintiff.filter(
        (item) => item.materialId !== removed.id,
      );
      renderIdentityMaterials();
      refresh(false);
    }),
  );
}

function addIdentityMaterial() {
  state.identityMaterials.push(
    createIdentityMaterial(state.plaintiffType, { name: "" }),
  );
  renderIdentityMaterials();
  refresh(false);
  targetLastIdentityMaterialName();
}

function targetLastIdentityMaterialName() {
  document
    .querySelector("#identityMaterialList [data-identity-material-index]:last-of-type [data-identity-material-name]")
    ?.focus();
}

function handleFiles(group, fileList) {
  const rejected = [];
  for (const file of [...fileList]) {
    if (!["pdf", "docx", "jpg", "jpeg", "png"].includes(fileExtension(file.name))) {
      rejected.push(file.name);
      continue;
    }
    const item = { id: fileId(), name: file.name, size: file.size, file };
    uploads[group].push(item);
  }
  renderUploads();
  refresh(false);
  if (rejected.length)
    toast(`这些文件不能可靠排版，请转换后再上传：${rejected.join("、")}`);
}

function handleEvidenceFiles(evidenceIdValue, fileList) {
  const rejected = [];
  for (const file of [...fileList]) {
    const ext = fileExtension(file.name);
    if (!EVIDENCE_FILE_EXTENSIONS.has(ext)) {
      rejected.push(file.name);
      continue;
    }
    uploads.evidence.push({
      id: fileId(),
      evidenceId: evidenceIdValue,
      name: file.name,
      size: file.size,
      file,
    });
  }
  renderEvidence();
  refresh(false);
  if (rejected.length)
    toast(`这些文件不能可靠排版，请转换后再上传：${rejected.join("、")}`);
}

function readableSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderFileChips(group, targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.innerHTML = uploads[group]
    .map(
      (item) => `
    <div class="file-chip"><span title="${esc(item.name)}">${esc(item.name)} · ${readableSize(item.size)}</span><button type="button" data-remove-upload="${group}:${item.id}" aria-label="移除${esc(item.name)}">×</button></div>`,
    )
    .join("");
}

function renderUploads() {
  renderIdentityMaterials();
  renderFileChips("agent", "agentFileList");
  renderFileChips("defendant", "defendantFileList");

  document.querySelectorAll("[data-remove-upload]").forEach((button) =>
    button.addEventListener("click", () => {
      const [group, id] = button.dataset.removeUpload.split(":");
      uploads[group] = uploads[group].filter((item) => item.id !== id);
      renderUploads();
      refresh(false);
    }),
  );
}

function addEvidence(kind) {
  state.evidence.push(createEvidenceItem(kind));
  renderEvidence();
  refresh();
  document
    .querySelector("#evidenceList [data-evidence-index]:last-child [data-evidence-key='name']")
    ?.focus();
}

function setStep(index, syncDocument = true) {
  currentStep = Math.max(0, Math.min(5, index));
  if (syncDocument && STEP_DOCUMENTS[currentStep]) {
    currentDoc = STEP_DOCUMENTS[currentStep];
    document
      .querySelectorAll("[data-doc]")
      .forEach((button) =>
        button.classList.toggle("active", button.dataset.doc === currentDoc),
      );
  }
  document
    .querySelectorAll("[data-step-panel]")
    .forEach((panel) =>
      panel.classList.toggle(
        "active",
        Number(panel.dataset.stepPanel) === currentStep,
      ),
    );
  document
    .querySelectorAll(".step-link")
    .forEach((button) =>
      button.classList.toggle(
        "active",
        Number(button.dataset.step) === currentStep,
      ),
    );
  document.getElementById("stepEyebrow").textContent =
    `步骤 ${currentStep + 1} / 6`;
  document.getElementById("stepTitle").textContent = stepMeta[currentStep][0];
  document.getElementById("stepDescription").textContent =
    stepMeta[currentStep][1];
  document.getElementById("prevBtn").disabled = currentStep === 0;
  document.getElementById("nextBtn").textContent = "下一步";
  document.getElementById("nextBtn").classList.toggle("hidden", currentStep === 5);
  document
    .querySelector(".completion-badge")
    ?.classList.toggle("hidden", currentStep === 5);
  if (currentStep === 5) renderReview();
  if (syncDocument && STEP_DOCUMENTS[currentStep]) refresh();
  document
    .querySelector(".form-panel")
    .scrollTo({ top: 0, behavior: "smooth" });
}

/* ==========================================================================
 * 契约派生层：必选材料项、进度、风险
 * 表单、进度、提交前检查、AI 工具面共用同一份数据，不再各自维护一份清单。
 * ========================================================================== */

function allSections() {
  return CONTRACT.documents.flatMap((doc) =>
    doc.sections.map((section) => ({
      ...section,
      docId: doc.id,
      docTitle: doc.title,
    })),
  );
}

function platformChecks() {
  return (CONTRACT.platformMaterials || [])
    .map((material) => {
      const { applicable, ok } = evaluateSection(material);
      if (!applicable) return null;
      return {
        id: material.id,
        label: material.title,
        ok,
        step: material.step,
        doc: "法院上传栏目",
        hint: material.hint || "",
        fields: material.requiredFields || material.fields || [],
        folder: material.folder,
        officiallyRequired: material.requirement === "required",
      };
    })
    .filter(Boolean);
}

function fieldFilled(ref, s = state, up = uploads) {
  if (ref.startsWith("uploads:")) return (up[ref.slice(8)] || []).length > 0;
  const value = s[ref];
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length > 0;
  return value !== "" && value != null;
}

/* 返回 { applicable, ok }：applicable=false 表示该材料项在当前案件下不适用或不计入进度 */
function evaluateSection(section, s = state, up = uploads) {
  if (section.requirement === "optional" || section.requirement === "fixed")
    return { applicable: false, ok: true };
  if (section.when && !section.when(s, up))
    return { applicable: false, ok: true };
  const requiredFields = section.requiredFields || section.fields || [];
  const ok = section.check
    ? Boolean(section.check(s, up))
    : requiredFields.every((field) => fieldFilled(field, s, up));
  return { applicable: true, ok };
}

/* 必选 / 条件必选材料项 → 提交前检查清单，带步骤与文书归属 */
function requiredChecks() {
  const coveredByPlatform = new Set([
    "plaintiff-identity-file",
    "agent-file",
    "evidence-list",
    "service-info",
    "refund-account-info",
  ]);
  return allSections()
    .filter((section) => !coveredByPlatform.has(section.id))
    .map((section) => {
      const { applicable, ok } = evaluateSection(section);
      if (!applicable) return null;
      return {
        id: section.id,
        label: section.title,
        ok,
        step: section.step,
        doc: section.docTitle,
        hint: section.hint || "",
        fields: section.requiredFields || section.fields || [],
      };
    })
    .filter(Boolean);
}

/* 契约自检：找出「收集了但契约未声明」的白问字段，和「契约声明但 state 不存在」的拼写错误 */
function validateContract() {
  const declared = new Set();
  allSections().forEach((section) =>
    (section.fields || []).forEach((field) => declared.add(field)),
  );
  const stateKeys = Object.keys(defaultState).filter(
    (key) => key !== "evidence" && !key.startsWith("_"),
  );
  return {
    orphans: stateKeys.filter((key) => !declared.has(key)),
    unknown: [...declared].filter(
      (field) => !field.startsWith("uploads:") && !(field in defaultState),
    ),
  };
}

function risks() {
  const result = [];
  if (state.arbitration === "yes")
    result.push([
      "danger",
      "你签过书面仲裁约定，可能应向仲裁机构申请，而不是直接向法院起诉。",
      { step: 0, field: "arbitration" },
    ]);
  else if (state.arbitration === "unknown")
    result.push([
      "warn",
      "尚未确认是否另行签过书面仲裁约定，请提交前核对现有书面材料。",
      { step: 0, field: "arbitration" },
    ]);
  if (!state.jurisdictionBases.length)
    result.push([
      "danger",
      "尚未填写九江管辖依据，仅因原告居住在九江通常不足以确定管辖。",
      { step: 0, selector: "#jurisdictionChoices input" },
    ]);
  if (state.qualityDispute === "yes")
    result.push([
      "warn",
      "对方提出质量、数量或退货争议，建议补充验收、异议时间和质量证明。",
      { step: 0, field: "qualityDetails" },
    ]);
  if (state.jurisdictionAgreement === "yes" && !state.jurisdictionClause)
    result.push([
      "warn",
      "已选择书面合同约定了管辖法院，但未填写约定内容，起诉状将无法写明协议管辖依据。",
      { step: 0, field: "jurisdictionClause" },
    ]);
  if (hasWrittenContract() && state.jurisdictionAgreement === "unknown")
    result.push([
      "warn",
      "尚未确认书面合同是否约定管辖法院，请核对合同原文；如已协议管辖，应向约定的法院起诉。",
      { step: 0, field: "jurisdictionAgreement" },
    ]);
  if (
    hasNoWrittenContract() &&
    (!state.dealFormation || !state.deliveryReceipt || !state.priceBasis)
  )
    result.push([
      "danger",
      "无书面合同的证明链尚不完整，请补充交易如何达成、送货单由谁签收以及价格如何确定。",
      { step: 0, field: "dealFormation" },
    ]);
  if (state.claimInterest && !state.interestTerms)
    result.push([
      "warn",
      "勾选了利息或违约金，但尚未填写计算方式；请依据合同约定或法院认可的逾期付款损失标准明确起算日和计算方式。",
      { step: 0, field: "interestTerms" },
    ]);
  if (Number(state.paidAmount || 0) > Number(state.totalAmount || 0))
    result.push([
      "danger",
      "已付款金额高于货款总额，请检查金额。",
      { step: 0, field: "paidAmount" },
    ]);
  if (!state.defendantId)
    result.push([
      "warn",
      "被告证件号码或统一社会信用代码未填写；能够补充时更有利于明确被告。",
      { step: 2, field: "defendantId" },
    ]);
  const mediaEvidence = state.evidence.filter((item) => item.kind === "media");
  if (mediaEvidence.length)
    result.push([
      "warn",
      `有 ${mediaEvidence.length} 项影音证据需要在法院平台另行上传原文件。`,
      {
        step: 3,
        selector: `[data-evidence-id="${mediaEvidence[0].id}"]`,
      },
    ]);
  if (!result.length)
    result.push([
      "good",
      "目前没有识别到明显的材料风险，仍请核对事实、金额和法院要求。",
    ]);
  return result;
}

function completion() {
  const checks = [...platformChecks(), ...requiredChecks()];
  if (!checks.length) return 0;
  return Math.round(
    (checks.filter((check) => check.ok).length / checks.length) * 100,
  );
}

const REVIEW_UPLOAD_TARGETS = {
  "uploads:plaintiff": "#identityMaterialList",
  "uploads:agent": "#agentFiles",
  "uploads:defendant": "#defendantFiles",
  "uploads:evidence": "#evidenceList",
};

const REVIEW_FALLBACK_TARGETS = {
  "court-complaint": '[data-field="contractForm"]',
  "court-identity": "#identityMaterialList",
  "court-agent": "#agentFiles",
  "court-evidence": "#evidenceList",
  "court-service": '[data-field="serviceRecipient"]',
  "court-refund": '[data-field="refundAccountName"]',
};

function reviewTargetForCheck(check) {
  for (const field of check.fields || []) {
    if (REVIEW_UPLOAD_TARGETS[field]) return REVIEW_UPLOAD_TARGETS[field];
    if (field in state) {
      const scoped = `[data-step-panel="${check.step}"] [data-field="${field}"]`;
      return document.querySelector(scoped)
        ? scoped
        : `[data-field="${field}"]`;
    }
  }
  return REVIEW_FALLBACK_TARGETS[check.id] || null;
}

function collectReviewIssues() {
  const issues = [];
  [...platformChecks(), ...requiredChecks()]
    .filter((check) => !check.ok)
    .forEach((check) =>
      issues.push({
        level: "danger",
        step: check.step,
        selector: reviewTargetForCheck(check),
        title: `${check.label}未完成`,
        advice: check.hint || "请补充这一项后再下载资料包。",
      }),
    );
  risks()
    .filter(([level]) => level !== "good")
    .forEach(([level, text, target = {}]) =>
      issues.push({
        level,
        step: target.step ?? 0,
        selector:
          target.selector ||
          (target.field ? `[data-field="${target.field}"]` : null),
        title: text,
        advice: "点击此项，直接前往对应位置修改。",
      }),
    );
  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.step}|${issue.selector}|${issue.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderReview() {
  currentReviewIssues = collectReviewIssues();
  const status = document.getElementById("reviewStatus");
  const list = document.getElementById("issueList");
  status.className = `review-status ${currentReviewIssues.length ? "has-issues" : "good"}`;
  status.textContent = currentReviewIssues.length
    ? `发现 ${currentReviewIssues.length} 个问题`
    : "未发现需要修改的问题";
  list.innerHTML = currentReviewIssues
    .map(
      (issue, index) => `
      <button type="button" class="review-issue ${issue.level}" data-review-issue="${index}">
        <span class="review-issue-mark">${issue.level === "danger" ? "!" : "?"}</span>
        <span><strong>${esc(issue.title)}</strong><small>建议：${esc(issue.advice)}</small></span>
        <span class="review-issue-arrow">›</span>
      </button>`,
    )
    .join("");
  if (aiReviewSignature && aiReviewSignature !== currentAiReviewSignature()) {
    document.getElementById("aiReviewStatus").textContent =
      "填写内容已经变化，请重新进行 AI 检查。";
  }
}

function openIssue(issue) {
  if (!issue) return;
  setStep(issue.step);
  setTimeout(() => {
    const target = issue.selector
      ? document.querySelector(issue.selector)
      : document.querySelector(`[data-step-panel="${issue.step}"]`);
    if (!target) return;
    const highlight = target.closest(
      ".field, .upload-zone, .switch-row, .choice-grid, .money-strip, .no-contract-panel",
    ) || target;
    highlight.scrollIntoView({ behavior: "smooth", block: "center" });
    highlight.classList.add("review-focus");
    if (!target.matches('input[type="file"]')) target.focus?.();
    setTimeout(() => highlight.classList.remove("review-focus"), 1800);
  }, 260);
}

function openReviewIssue(index) {
  openIssue(currentReviewIssues[index]);
}

function currentAiReviewSignature() {
  const uploadMeta = Object.fromEntries(
    Object.entries(uploads).map(([group, items]) => [
      group,
      items.map((item) => ({
        evidenceId: item.evidenceId || "",
        materialId: item.materialId || "",
        category: item.category || "",
        materialType: item.materialType || "",
        purpose: item.purpose || "",
        copyType: item.copyType || "",
        source: item.source || "",
        note: item.note || "",
      })),
    ]),
  );
  return JSON.stringify({ state, uploadMeta });
}

function htmlToReviewText(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return (template.content.textContent || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function buildAiReviewPayload() {
  const excludedFields = new Set(
    Object.keys(state).filter((key) => key.startsWith("_")),
  );
  excludedFields.add("identityMaterials");
  excludedFields.add('defendantMaterials');
  if(!state.claimInterest)excludedFields.add('interestTerms');
  if(!state.claimAttorneyFee)excludedFields.add('attorneyFeeTerms');
  if (state.plaintiffType === "个人") {
    [
      "plaintiffLicenseType",
      "plaintiffRepresentative",
      "plaintiffRepresentativeTitle",
      "plaintiffRepresentativePhone",
    ].forEach((key) => excludedFields.add(key));
  } else {
    ["plaintiffGender", "plaintiffIdType"].forEach((key) =>
      excludedFields.add(key),
    );
  }
  if (state.defendantType === "个人") {
    [
      "defendantLicenseType",
      "defendantRepresentative",
      "defendantRepresentativePhone",
    ].forEach((key) => excludedFields.add(key));
  } else {
    ["defendantGender", "defendantIdType"].forEach((key) =>
      excludedFields.add(key),
    );
  }
  if (state.represented !== "yes")
    Object.keys(state)
      .filter((key) => key.startsWith("agent"))
      .forEach((key) => excludedFields.add(key));
  if (!state.includeRefundAccount)
    Object.keys(state)
      .filter((key) => key.startsWith("refund"))
      .forEach((key) => excludedFields.add(key));
  if (!hasWrittenContract())
    ["contractDate", "contractName", "jurisdictionAgreement", "jurisdictionClause"].forEach(
      (key) => excludedFields.add(key),
    );
  const cleanState = Object.fromEntries(
    Object.entries(state).filter(([key]) => !excludedFields.has(key)),
  );
  const materialSummary = {
    plaintiff: state.identityMaterials.map((material, index) => ({
      number: index + 1,
      materialName: material.name,
      fileCount: identityFilesFor(material.id).length,
    })),
    agent: uploads.agent.map(() => ({ materialType: "代理材料" })),
    defendant: defendantMaterialGroups().map(group=>({materialName:group.item.name,fileCount:group.files.length,fileTypes:evidenceFileTypes(group.files)})),
    evidence: state.evidence.map((item, index) => {
      const files = evidenceFilesFor(item.id);
      return {
        number: index + 1,
        kind: item.kind,
        name: item.name,
        fileTypes:
          item.kind === "media"
            ? [item.mediaType]
            : evidenceFileTypes(files),
        fileCount:
          item.kind === "media" ? Number(item.fileCount || 0) : files.length,
        copyType: item.kind === "media" ? "" : item.copyType,
        source: item.source,
        purpose: item.purpose,
        note: item.note,
      };
    }),
  };
  const docs = documents();
  return {
    caseType: "买卖合同货款纠纷民事一审",
    region: CONTRACT.region,
    fields: cleanState,
    uploadedMaterialSummary: materialSummary,
    generatedDocuments: {
      complaint: htmlToReviewText(docs.complaint),
      evidenceDirectory: htmlToReviewText(docs.evidence),
      serviceConfirmation: htmlToReviewText(docs.service),
    },
    localChecks: collectReviewIssues().map((issue) => ({
      level: issue.level,
      title: issue.title,
      advice: issue.advice,
      step: issue.step,
    })),
    allowedFields: Object.keys(cleanState),
  };
}

function renderAiReview(result) {
  currentAiIssues = (result.issues || []).map((issue) => {
    const field = issue.field && issue.field in state ? issue.field : "";
    const baseSelector = field ? `[data-field="${field}"]` : null;
    const scopedSelector = baseSelector
      ? `[data-step-panel="${issue.step}"] ${baseSelector}`
      : null;
    const target = scopedSelector
      ? document.querySelector(scopedSelector) || document.querySelector(baseSelector)
      : null;
    const panel = target?.closest("[data-step-panel]");
    return {
      ...issue,
      step: panel ? Number(panel.dataset.stepPanel) : issue.step,
      selector: target
        ? `[data-step-panel="${panel.dataset.stepPanel}"] ${baseSelector}`
        : null,
    };
  });
  const status = document.getElementById("aiReviewStatus");
  const target = document.getElementById("aiReviewResult");
  status.textContent = currentAiIssues.length
    ? `AI发现 ${currentAiIssues.length} 个需要核对的地方`
    : "AI未发现新的明显问题";
  target.innerHTML = `
    <div class="ai-review-summary">${esc(result.summary)}<span class="ai-review-model">${esc(result.model || "DeepSeek")}</span></div>
    ${currentAiIssues
      .map(
        (issue, index) => `
        <button type="button" class="review-issue ${esc(issue.level)}" data-ai-review-issue="${index}">
          <span class="review-issue-mark">${issue.level === "danger" ? "!" : issue.level === "info" ? "i" : "?"}</span>
          <span><strong>${esc(issue.title)}</strong><small>建议：${esc(issue.advice)}</small></span>
          <span class="review-issue-arrow">›</span>
        </button>`,
      )
      .join("")}`;
}

async function runAiReview() {
  const button = document.getElementById("aiReviewBtn");
  const status = document.getElementById("aiReviewStatus");
  const target = document.getElementById("aiReviewResult");
  button.disabled = true;
  button.textContent = "检查中…";
  status.textContent = "正在检查已填写的文字和材料清单…";
  try {
    const signature = currentAiReviewSignature();
    const response = await fetch("/api/ai-review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildAiReviewPayload()),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "AI检查暂时不可用");
    aiReviewSignature = signature;
    renderAiReview(result);
  } catch (error) {
    currentAiIssues = [];
    target.innerHTML = "";
    status.textContent = error.message || "AI检查失败，请稍后重试";
  } finally {
    button.disabled = false;
    button.textContent = "重新检查";
  }
}

function refresh(rehydrate = true) {
  if (rehydrate)
    document.querySelectorAll("[data-field]").forEach((el) => {
      const key = el.dataset.field;
      if (el !== document.activeElement) {
        if (el.type === "checkbox") el.checked = Boolean(state[key]);
        else el.value = state[key] ?? "";
      }
    });
  document.getElementById("principalDisplay").textContent =
    `¥ ${money(principal())}`;
  const official = platformChecks().filter(
    (check) => check.officiallyRequired,
  );
  const checks = requiredChecks();
  document.getElementById("completionText").textContent = `${completion()}%`;
  document.getElementById("completionDetail").textContent =
    `法院必传 ${official.filter((check) => check.ok).length}/${official.length} · 信息 ${checks.filter((check) => check.ok).length}/${checks.length}`;
  document.getElementById("previewTitle").textContent = docLabels[currentDoc];
  renderTemplateSource();
  queuePdfPreview();
  if (currentStep === 5) renderReview();
  saveState();
}

function renderTemplateSource() {
  const source = TEMPLATE_SOURCES[currentDoc];
  const target = document.getElementById("templateSource");
  target.dataset.kind = source.kind;
  const signing = signingGuidance(currentDoc);
  target.innerHTML = `<div class="template-source-head"><span class="template-source-badge">${esc(source.badge)}</span><strong>${esc(source.name)}</strong></div><p>${esc(source.detail)}</p>${signing ? `<p class="template-signing"><b>签署方式：</b>${esc(signing)}</p>` : ""}`;
}

function signingGuidance(docId) {
  if (!["complaint", "plaintiff", "evidence", "service", "refund"].includes(docId))
    return "";
  if (docId === "refund" && state.plaintiffType === "个人")
    return "按照九江公开模板，个人应本人签名并按手印。";
  if (state.plaintiffType === "个人")
    return "由本人签名并按手印。";
  if (state.plaintiffType === "个体工商户")
    return "加盖个体工商户公章，并由经营者签名，不按手印。";
  return "加盖公司公章，并由负责人签名，不按手印。";
}

function partyDescription(prefix) {
  const type = state[`${prefix}Type`];
  const name = valueOr(state[`${prefix}Name`]);
  const id = valueOr(state[`${prefix}Id`]);
  const address = valueOr(state[`${prefix}Address`]);
  const phone = valueOr(state[`${prefix}Phone`]);
  const country = valueOr(state[`${prefix}Country`]);
  if (type === "个人")
    return `${name}，性别：${valueOr(state[`${prefix}Gender`])}，国别或地区：${country}，${valueOr(state[`${prefix}IdType`], "证件")}号码：${id}，住所地：${address}，联系电话：${phone}。`;
  const rep = valueOr(state[`${prefix}Representative`]);
  const title = state[`${prefix}RepresentativeTitle`];
  const repPhone = valueOr(
    state[`${prefix}RepresentativePhone`],
    phone,
  );
  // 个体工商户没有「法定代表人」，按民诉法解释第 59 条写「经营者」
  const role = type === "个体工商户" ? "经营者" : "法定代表人";
  // 职务与角色名相同时不重复输出，避免「经营者：张三（经营者）」
  const repText = title && title !== role ? `${rep}（${esc(title)}）` : rep;
  return `${name}（${esc(type)}），国别或地区：${country}，证照类型：${valueOr(state[`${prefix}LicenseType`])}，统一社会信用代码：${id}，住所地：${address}，${role}：${repText}，负责人联系电话：${repPhone}。`;
}

/* 本案目前按单一被告设计；将来支持多个被告时，此处返回被告人数 */
function defendantCount() {
  return 1;
}

/* 金额：文书里带标记，便于核对数字。principalDisplay 等屏幕展示仍用 money() */
function moneyMark(value) {
  return `<span class="filled">${money(value)}</span>`;
}

function jurisdictionParagraph() {
  if (
    hasWrittenContract() &&
    state.jurisdictionAgreement === "yes" &&
    state.jurisdictionClause
  ) {
    return `双方书面约定由${valueOr(state.court)}管辖，故贵院对本案依法具有管辖权。`;
  }
  const grounds = state.jurisdictionBases || [];
  let reason = "本案与贵院辖区存在管辖连接点";
  if (grounds.includes("被告住所地或公司登记地在九江"))
    reason = `被告住所地位于${valueOr(state.defendantAddress)}`;
  else if (grounds.includes("合同履行地或交货地在九江"))
    reason = `货物交付地${valueOr(state.deliveryPlace)}属于合同履行地`;
  else if (
    grounds.includes(
      "原告住所地在九江（货款为给付货币，接收货币一方所在地为合同履行地）",
    )
  )
    reason = `原告作为接收货币一方，其所在地${valueOr(state.plaintiffAddress)}属于合同履行地`;
  else if (state.jurisdictionNote)
    reason = valueOr(state.jurisdictionNote);
  return `因${reason}，${valueOr(state.court)}对本案依法具有管辖权。${state.arbitration === "no" ? "双方未约定仲裁。" : ""}`;
}

/* 附项：起诉状副本份数与证据份数（起诉状样式必备，自动派生） */
function attachmentsBlock() {
  const lines = [
    "当事人身份证明",
    "证据目录及证据材料",
    "送达地址确认书",
    ...(state.includeRefundAccount ? ["收款账户确认书"] : []),
    ...(state.represented === "yes"
      ? ["委托代理人委托手续和身份材料"]
      : []),
  ];
  return `<section class="complaint-attachments"><p class="no-indent"><b>附：</b></p>${lines.map((line, index) => `<p class="no-indent">${index + 1}. ${esc(line)}；</p>`).join("")}</section>`;
}

function complaintSignatureBlock() {
  if (state.plaintiffType === "个人")
    return `<div class="signature"><p class="no-indent">起诉人（签名、按手印）：${valueOr(state.plaintiffName)}</p><p class="no-indent">日期：${todayCn()}</p></div>`;
  if (state.plaintiffType === "个体工商户")
    return `<div class="signature"><p class="no-indent">起诉人（字号盖章）：${valueOr(state.plaintiffName)}</p><p class="no-indent">经营者（签名）：${valueOr(state.plaintiffRepresentative)}</p><p class="no-indent">日期：${todayCn()}</p></div>`;
  return `<div class="signature"><p class="no-indent">起诉人（公章）：${valueOr(state.plaintiffName)}</p><p class="no-indent">负责人（签名）：${valueOr(state.plaintiffRepresentative)}</p><p class="no-indent">日期：${todayCn()}</p></div>`;
}

function documentSignatureBlock(
  role,
  date = true,
  signerName = state.plaintiffName,
  dateLabel = '日期',
) {
  if (state.plaintiffType === "个人")
    return `<div class="signature"><p class="no-indent">${role}（签名、按手印）：${valueOr(signerName)}</p>${date ? `<p class="no-indent">${esc(dateLabel)}：${todayCn()}</p>` : ""}</div>`;
  if (state.plaintiffType === "个体工商户")
    return `<div class="signature"><p class="no-indent">${role}（盖章）：${valueOr(state.plaintiffName)}</p><p class="no-indent">经营者（签名）：${valueOr(state.plaintiffRepresentative)}</p>${date ? `<p class="no-indent">${esc(dateLabel)}：${todayCn()}</p>` : ""}</div>`;
  return `<div class="signature"><p class="no-indent">${role}（盖章）：${valueOr(state.plaintiffName)}</p><p class="no-indent">负责人（签名）：${valueOr(state.plaintiffRepresentative)}</p>${date ? `<p class="no-indent">${esc(dateLabel)}：${todayCn()}</p>` : ""}</div>`;
}

function complaintDoc() {
  const claims = [
    `判令被告向原告支付拖欠货款人民币${moneyMark(principal())}元；`,
    state.claimInterest
      ? `判令被告支付逾期利息/违约金，计算方式为：${valueOr(state.interestTerms)}；`
      : "",
    state.claimAttorneyFee
      ? `判令被告承担实现债权费用：${valueOr(state.attorneyFeeTerms)}；`
      : "",
    state.claimCosts ? "判令本案诉讼费用由被告承担。" : "",
  ].filter(Boolean);
  const tradeText = hasWrittenContract()
    ? `${dateCn(state.contractDate)}，原告与被告签订${valueOr(state.contractName, "买卖合同")}，由被告向原告购买${valueOr(state.goods)}`
    : `${dateCn(state.contractDate)}，被告向原告购买${valueOr(state.goods)}，双方虽未签订书面合同，但买卖交易已经实际发生`;
  const acknowledgement = state.debtAcknowledgement
    ? "被告已确认上述交易及欠款。"
    : "";
  const dispute =
    state.qualityDispute !== "no" && state.qualityDetails
      ? `被告提出的争议为：${valueOr(state.qualityDetails)}。`
      : "";
  return `
    <h2>民事起诉状</h2>
    <p class="party-line"><b>原告：</b>${partyDescription("plaintiff")}</p>
    <p class="party-line"><b>被告：</b>${partyDescription("defendant")}</p>
    <p class="party-line"><b>案由：</b>买卖合同纠纷</p>
    <h3>诉讼请求</h3>
    ${claims.map((claim, index) => `<p class="no-indent">${index + 1}. ${claim}</p>`).join("")}
    <h3>事实与理由</h3>
    <p>${tradeText}。原告于${dateCn(state.deliveryDate)}将货物交付至${valueOr(state.deliveryPlace)}，被告已经签收。</p>
    <p>经双方结算，货款总额为人民币${moneyMark(state.totalAmount)}元。被告已支付人民币${moneyMark(state.paidAmount)}元，尚欠人民币${moneyMark(principal())}元，付款期限已于${dateCn(state.dueDate)}届满。${acknowledgement}${dispute}原告多次催收未果，被告至今未付。</p>
    <p>被告未按约支付货款，已构成违约。为维护自身合法权益，原告依据《中华人民共和国民法典》相关规定，特向贵院提起诉讼，恳请贵院依法支持原告全部诉讼请求。</p>
    <p>${jurisdictionParagraph()}</p>
    <p class="no-indent" style="margin-top:28px">此致</p>
    <p class="no-indent"><b>${valueOr(state.court)}</b></p>
    ${complaintSignatureBlock()}
    ${attachmentsBlock()}`;
}

function plaintiffDoc() {
  return identityCoverDoc();
}

function defendantMaterialGroups(){
  if(Array.isArray(state.defendantMaterials)&&state.defendantMaterials.length)return state.defendantMaterials.map((item,index)=>({item,number:index+1,files:uploads.defendant.filter(file=>file.materialId===item.id)})).filter(group=>group.files.length);
  const groups=new Map();
  uploads.defendant.forEach(file=>{const id=file.materialId||'legacy-defendant';if(!groups.has(id))groups.set(id,{item:{id,name:file.materialName||'被告信息材料'},number:groups.size+1,files:[]});groups.get(id).files.push(file);});
  return Array.from(groups.values());
}
function defendantDoc(pageRanges=new Map()) {
  const materials=defendantMaterialGroups();
  return `<section class="defendant-cover">
    <h2>被告身份及送达线索表</h2>
    <table class="doc-table left-aligned-table">
      <tr><th style="width:30%">项目</th><th>已知信息</th></tr>
      <tr><td>被告类型</td><td>${valueOr(state.defendantType)}</td></tr>
      <tr><td>姓名 / 名称</td><td>${valueOr(state.defendantName)}</td></tr>
      <tr><td>证件号码 / 统一社会信用代码</td><td>${valueOr(state.defendantId, "未知")}</td></tr>
      <tr><td>注册地址 / 住所地</td><td>${valueOr(state.defendantAddress)}</td></tr>
      <tr><td>实际经营 / 居住地址</td><td>${valueOr(state.defendantActualAddress, "未知")}</td></tr>
      <tr><td>联系电话</td><td>${valueOr(state.defendantPhone, "未知")}</td></tr>
      <tr><td>法定代表人 / 经营者</td><td>${valueOr(state.defendantRepresentative, "未知")}</td></tr>
      <tr><td>信息来源</td><td>${valueOr(state.defendantInfoSource, "合同、转账记录、聊天记录或公开登记信息")}</td></tr>
    </table>
    ${materials.length?`<h3>所附被告线索材料</h3><table class="doc-table left-aligned-table"><tr><th>编号</th><th>材料名称</th><th>文件类型</th><th>文件数量</th><th>页码</th></tr>${materials.map(group=>`<tr><td>${group.number}</td><td>${valueOr(group.item.name)}</td><td>${evidenceFileTypes(group.files).join('、')}</td><td>${group.files.length}</td><td>${valueOr(pageNumberList(pageRanges.get(group.item.id)),'—')}</td></tr>`).join('')}</table>`:''}
    <h3>送达线索补充说明</h3>
    <p>${valueOr(state.jurisdictionNote, "暂无其他线索。")}</p>
    <div class="defendant-cover-signature">${documentSignatureBlock("提交人",true)}</div>
    </section>`;
}

function pageNumberList(range) {
  if (!range?.start || !range?.end) return "";
  return Array.from(
    { length: range.end - range.start + 1 },
    (_, index) => range.start + index,
  ).join("-");
}

function evidenceDoc(pageRanges = new Map()) {
  const documentRows = state.evidence
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind !== "media");
  const mediaRows = state.evidence
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === "media");
  const documentTable = documentRows.length
    ? `<h3>图文证据目录</h3><table class="doc-table evidence-official-table evidence-document-table">
      <tr><th style="width:5%">编号</th><th style="width:16%">证据名称</th><th style="width:10%">文件类型</th><th style="width:7%">文件数量</th><th style="width:10%">页码</th><th style="width:11%">原件/复印件</th><th style="width:11%">证据来源</th><th style="width:22%">证明内容</th><th style="width:8%">备注</th></tr>
      ${documentRows
        .map(({ item, index }) => {
          const files = evidenceFilesFor(item.id);
          return `<tr><td>${index + 1}</td><td>${valueOr(item.name)}</td><td>${valueOr(evidenceFileTypes(files).join("、"), "待上传")}</td><td>${files.length}</td><td>${valueOr(pageNumberList(pageRanges.get(item.id)), "—")}</td><td>${valueOr(item.copyType, "复印件")}</td><td>${valueOr(item.source, "原告提供")}</td><td>${valueOr(item.purpose)}</td><td>${valueOr(item.note, "—")}</td></tr>`;
        })
        .join("")}
    </table>`
    : "";
  const mediaTable = mediaRows.length
    ? `<h3>影音证据目录</h3><table class="doc-table evidence-official-table evidence-media-table">
      <tr><th style="width:7%">编号</th><th style="width:19%">证据名称</th><th style="width:10%">文件类型</th><th style="width:8%">文件数量</th><th style="width:13%">证据来源</th><th style="width:28%">证明内容</th><th style="width:15%">备注</th></tr>
      ${mediaRows
        .map(
          ({ item, index }) => `<tr><td>${index + 1}</td><td>${valueOr(item.name)}</td><td>${valueOr(item.mediaType, "视频")}</td><td>${Math.max(1, Number(item.fileCount || 1))}</td><td>${valueOr(item.source, "原告提供")}</td><td>${valueOr(item.purpose)}</td><td>${esc(MEDIA_EVIDENCE_NOTE)}</td></tr>`,
        )
        .join("")}
    </table>`
    : "";
  return `
    <h2>原告证据目录</h2>
    <p class="party-line"><b>原告：</b>${valueOr(state.plaintiffName)}　　<b>被告：</b>${valueOr(state.defendantName)}</p>
    <p class="party-line"><b>案由：</b>买卖合同纠纷</p>
    ${documentTable}
    ${mediaTable}
    <div class="evidence-signing">
      <div class="evidence-court-signing"><p class="no-indent"><b>审判人员：</b>________________</p><p class="no-indent">日期：　　年　月　日</p></div>
      <div class="evidence-party-signing">${documentSignatureBlock("提交人",false)}<p class="no-indent">提交日期：　　年　月　日</p></div>
    </div>`;
}

function serviceDoc() {
  const yes = state.electronicService === "yes";
  const no = state.electronicService === "no";
  const idLabel =
    state.plaintiffType === "个人" ? "身份证件号码" : "统一社会信用代码";
  return `
    <h2>送达地址确认书</h2>
    <p class="party-line"><b>提交法院：</b>${valueOr(state.court)}</p>
    <table class="doc-table left-aligned-table">
      <tr><th style="width:28%">案由</th><td>买卖合同纠纷</td></tr>
      <tr><th>案号</th><td>（　　　）赣　　　　　号</td></tr>
      <tr><th>受送达人</th><td>${valueOr(state.serviceRecipient)}</td></tr>
      <tr><th>${idLabel}</th><td>${valueOr(state.plaintiffId)}</td></tr>
      <tr><th>邮寄地址</th><td>${valueOr(state.serviceAddress)}</td></tr>
      <tr><th>收件人</th><td>${valueOr(state.serviceSigner, state.serviceRecipient)}</td></tr>
      <tr><th>邮政编码</th><td>${valueOr(state.servicePostcode)}</td></tr>
      <tr><th>移动电话</th><td>${valueOr(state.servicePhone)}</td></tr>
      <tr><th>电子邮箱</th><td>${valueOr(state.serviceEmail)}</td></tr>
      <tr><th>电子送达</th><td><span class="check-square">${yes ? "☑" : "□"}</span> 同意　<span class="check-square">${no ? "☑" : "□"}</span> 不同意　${state.electronicService === "unsure" ? "暂不确定" : ""}</td></tr>
    </table>
    <p>我确认上述送达地址和信息真实、准确。上述信息如在诉讼中发生变化，将及时书面告知法院。</p>
    <p>本人同意法院采用向上述移动电话和电子邮箱发送短信、电子邮件等方式送达通知类诉讼文书和传票。</p>
    ${documentSignatureBlock("受送达人", true, state.serviceRecipient)}`;
}

function refundDoc() {
  if (!state.includeRefundAccount)
    return `<h2>收款账户确认书</h2><p class="no-indent">本案尚未选择生成收款账户确认书。该材料在法院平台中属于非必传材料。</p>`;
  return `
    <h2>退费账户确认书</h2>
    <h3>告知事项</h3>
    <ol class="official-notice"><li>需要向当事人退还诉讼费用的，人民法院依法主动退还有关当事人。</li><li>当事人应当如实、正确提供用于接收诉讼费用退费的本人有效银行账户。</li><li>指定收款人不是本案当事人的，应当另行提交特别授权委托书。</li><li>账户在退费前发生变化的，应及时向人民法院提交新的退费账户确认书。</li><li>因账户信息不准确或变更后未及时提交，导致无法办理退费的，由当事人自行承担相应后果。</li></ol>
    <table class="doc-table left-aligned-table">
      <tr><th style="width:28%">收款人名称</th><td>${valueOr(state.refundAccountName)}</td></tr>
      <tr><th>身份证号码（统一社会信用代码）</th><td>${valueOr(state.plaintiffId)}</td></tr>
      <tr><th>收款人账户</th><td>${valueOr(state.refundBankAccount)}</td></tr>
      <tr><th>收款人开户行</th><td>${valueOr(state.refundBankName)}</td></tr>
      <tr><th>联系方式</th><td>${valueOr(state.refundPhone)}</td></tr>
    </table>
    <p>本人/本单位已经阅读上述告知事项，确认提供的银行账户正确、有效，请将诉讼费用退款转（汇）入上述银行账户。</p>
    ${state.plaintiffType === "个人" ? `<div class="signature"><p class="no-indent">当事人（签名、按手印）：${valueOr(state.plaintiffName)}</p><p class="no-indent">日期：${todayCn()}</p></div>` : documentSignatureBlock("当事人")}`;
}

function documents() {
  return {
    complaint: complaintDoc(),
    plaintiff: plaintiffDoc(),
    defendant: defendantDoc(),
    evidence: evidenceDoc(),
    service: serviceDoc(),
    refund: refundDoc(),
  };
}

/* 导出正式稿前剥掉屏幕预览专用的标记，使 .doc 源码本身也是干净的 */
/* 备用：需要一份“无标记的正式稿”时，用它剥掉屏幕标记 */
function stripPreviewMarks(html) {
  return String(html)
    .replace(/<span class="filled">([\s\S]*?)<\/span>/g, "$1")
    .replace(/<span class="blank">([\s\S]*?)<\/span>/g, "$1");
}

/* 与右侧预览、浏览器打印保持一致的标记样式（写进下载的 .doc 里） */
const MARK_CSS = ".filled{text-decoration:underline}" + ".blank{color:#657582}";

function wordHtml(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:SimSun,'Songti SC',serif;font-size:14pt;line-height:1.8;margin:2.5cm;color:#111}h2{text-align:center;font-size:22pt;letter-spacing:.2em}h3{font-size:15pt;margin-top:1.2em}p{text-indent:2em;margin:.35em 0}.no-indent,.party-line{text-indent:0}.doc-table{width:100%;border-collapse:collapse;margin:1em 0;font-size:11pt}.doc-table th,.doc-table td{border:1px solid #333;padding:7px;vertical-align:top}.doc-table th{background:#f3f3f3}.signature{margin:2em 0 0 auto;width:48%}.check-square{font-family:Arial,sans-serif}${MARK_CSS}</style></head><body>${body}</body></html>`;
}

function fileExtension(name) {
  return String(name).split(".").pop().toLowerCase();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsText(file, "utf-8");
  });
}

function sanitizeImportedHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  template.content
    .querySelectorAll("script,style,iframe,object,embed,link,meta,form")
    .forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attr) => {
      if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
      if (
        ["src", "href"].includes(attr.name) &&
        /^(https?:|javascript:)/i.test(attr.value)
      )
        node.removeAttribute(attr.name);
    });
  });
  return template.innerHTML;
}

async function spreadsheetToHtml(file) {
  const bytes = await file.arrayBuffer();
  let workbook;
  if (/\.csv$/i.test(file.name)) {
    let decoded;
    try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { decoded = new TextDecoder("gbk").decode(bytes); }
    workbook = XLSX.read(decoded, { type: "string" });
  } else {
    workbook = XLSX.read(bytes, { type: "array" });
  }
  return workbook.SheetNames.map(
    (name) =>
      `<h4>${esc(name)}</h4><div class="imported-table">${XLSX.utils.sheet_to_html(workbook.Sheets[name])}</div>`,
  ).join("");
}

async function docxToHtml(file) {
  const bytes = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes });
  return sanitizeImportedHtml(result.value);
}

function attachmentCaption(item, index, category) {
  const purpose = item.purpose ? `<p><b>证明目的：</b>${esc(item.purpose)}</p>` : "";
  return `<h3>${category || "材料"}${index + 1}：${esc(item.name)}</h3>${purpose}<p class="file-meta">原始文件名：${esc(item.name)}</p>`;
}

async function buildAttachmentHtml(
  items,
  categoryName,
  { firstAttachmentInline = false } = {},
) {
  const sections = [];
  const pdfItems = [];
  const preservedOnly = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const ext = fileExtension(item.name);
    const caption = attachmentCaption(item, index, item.category || categoryName);
    const attachmentClass =
      firstAttachmentInline && index === 0
        ? "pdf-attachment-page pdf-attachment-inline"
        : "pdf-attachment-page";
    try {
      if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
        const src = await fileToDataUrl(item.file);
        sections.push(`<section class="${attachmentClass}">${caption}<img src="${src}" alt="${esc(item.name)}" /></section>`);
      } else if (ext === "pdf") {
        pdfItems.push(item);
      } else if (ext === "docx") {
        const html = await docxToHtml(item.file);
        sections.push(`<section class="${attachmentClass}">${caption}<div class="imported-document">${html}</div></section>`);
      } else if (["xls", "xlsx", "csv"].includes(ext)) {
        const html = await spreadsheetToHtml(item.file);
        sections.push(`<section class="${attachmentClass} landscape-table">${caption}${html}</section>`);
      } else if (ext === "txt") {
        const text = await fileToText(item.file);
        sections.push(`<section class="${attachmentClass}">${caption}<pre class="imported-text">${esc(text)}</pre></section>`);
      } else {
        preservedOnly.push(item);
      }
    } catch (error) {
      preservedOnly.push(item);
    }
  }
  return { html: sections.join(""), pdfItems, preservedOnly };
}

function waitForImages(root) {
  return Promise.all(
    [...root.querySelectorAll("img")].map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
          }),
    ),
  );
}

function findCrossingTextLine(root) {
  const rootRect = root.getBoundingClientRect();
  const pageHeight = (rootRect.width * 247) / 178;
  const elements = [...root.querySelectorAll("p,li,h2,h3,h4")];
  for (const element of elements) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let line = null;
    let node;
    const checkLine = () => {
      if (!line) return null;
      const relativeTop = line.top - rootRect.top;
      const relativeBottom = line.bottom - rootRect.top;
      const boundary = (Math.floor(relativeTop / pageHeight) + 1) * pageHeight;
      if (relativeBottom > boundary - 1 && relativeTop < boundary)
        return { ...line, gap: Math.ceil(boundary - relativeTop + 2) };
      return null;
    };
    while ((node = walker.nextNode())) {
      for (let offset = 0; offset < node.data.length; offset++) {
        if (!node.data[offset].trim()) continue;
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const rect = range.getBoundingClientRect();
        if (!rect.width && !rect.height) continue;
        if (!line || Math.abs(rect.top - line.top) > 1) {
          const crossing = checkLine();
          if (crossing) return crossing;
          line = {
            node,
            offset,
            top: rect.top,
            bottom: rect.bottom,
          };
        } else {
          line.bottom = Math.max(line.bottom, rect.bottom);
        }
      }
    }
    const crossing = checkLine();
    if (crossing) return crossing;
  }
  return null;
}

function protectPdfTextLines(root) {
  for (let pass = 0; pass < 20; pass++) {
    const crossing = findCrossingTextLine(root);
    if (!crossing) return;
    const marker = document.createElement("span");
    marker.className = "pdf-line-spacer";
    marker.style.height = `${crossing.gap}px`;
    const tail = crossing.node.splitText(crossing.offset);
    tail.parentNode.insertBefore(marker, tail);
  }
}

async function htmlToPdfBytes(title, body) {
  if (!window.html2pdf || !window.PDFLib)
    throw new Error("PDF组件尚未加载，请刷新页面后重试");
  const host = document.createElement("div");
  host.className = "pdf-export-host";
  host.innerHTML = `<article class="pdf-document">${stripPreviewMarks(body)}</article>`;
  document.body.appendChild(host);
  await waitForImages(host);
  protectPdfTextLines(host.querySelector(".pdf-document"));
  try {
    const buffer = await html2pdf()
      .set({
        margin: [25, 16, 25, 16],
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: false,
          logging: false,
          backgroundColor: "#ffffff",
          scrollX: 0,
          scrollY: 0,
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"] },
      })
      .from(host.querySelector(".pdf-document"))
      .outputPdf("arraybuffer");
    return new Uint8Array(buffer);
  } finally {
    host.remove();
  }
}

async function mergePdfAttachments(baseBytes, pdfItems) {
  const output = await PDFLib.PDFDocument.load(baseBytes);
  for (const item of pdfItems) {
    try {
      const sourcePages = await output.embedPdf(await item.file.arrayBuffer());
      sourcePages.forEach((sourcePage) => {
        const pageWidth = 595.28;
        const pageHeight = 841.89;
        const availableWidth = pageWidth - PDF_HORIZONTAL_MARGIN_PT * 2;
        const availableHeight = pageHeight - PDF_VERTICAL_MARGIN_PT * 2;
        const scale = Math.min(
          availableWidth / sourcePage.width,
          availableHeight / sourcePage.height,
          1,
        );
        const width = sourcePage.width * scale;
        const height = sourcePage.height * scale;
        const page = output.addPage([pageWidth, pageHeight]);
        page.drawPage(sourcePage, {
          x: PDF_HORIZONTAL_MARGIN_PT + (availableWidth - width) / 2,
          y: PDF_VERTICAL_MARGIN_PT + (availableHeight - height) / 2,
          width,
          height,
        });
      });
    } catch (error) {
      // 原始PDF仍会保留在资料包；汇编正文中已列出文件名。
    }
  }
  return new Uint8Array(await output.save());
}

async function appendPdfBytes(output, bytes) {
  const source = await PDFLib.PDFDocument.load(bytes);
  const pages = await output.copyPages(source, source.getPageIndices());
  pages.forEach((page) => output.addPage(page));
}

function canvasPngBytes(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error("材料标签生成失败"));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png"),
  );
}

function identityGroupTitle(item) {
  return String(item.materialType || item.category || "身份证明材料")
    .replace(/(正面|反面)$/, "")
    .trim();
}

async function materialHeaderImage(
  output,
  { title, count, startPage, endPage, unit = "份" },
) {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 150;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#111111";
  context.font = '700 42px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText(`文件类型：${title}`, 24, 58);
  context.font = '32px "PingFang SC", "Microsoft YaHei", sans-serif';
  const pages = startPage === endPage ? `${startPage}` : `${startPage}-${endPage}`;
  context.fillText(`数量：${count}${unit}　　页码：${pages}`, 24, 108);
  context.strokeStyle = "#999999";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(24, 136);
  context.lineTo(1576, 136);
  context.stroke();
  return output.embedPng(await canvasPngBytes(canvas));
}

function imageChunks(entries, forcePairs = false) {
  if (forcePairs) {
    const chunks = [];
    for (let index = 0; index < entries.length; index += 2)
      chunks.push(entries.slice(index, index + 2));
    return chunks;
  }
  const chunks = [];
  let pendingWide = [];
  const flushWide = () => {
    while (pendingWide.length) chunks.push(pendingWide.splice(0, 2));
  };
  entries.forEach((entry) => {
    const ratio = entry.embedded.height / Math.max(entry.embedded.width, 1);
    if (ratio > 1.35) {
      flushWide();
      chunks.push([entry]);
    } else {
      pendingWide.push(entry);
      if (pendingWide.length === 2) flushWide();
    }
  });
  flushWide();
  return chunks;
}

async function prepareRenderableGroup(output, items) {
  const images = [];
  const documents = [];
  const preservedOnly = [];
  for (const item of items) {
    const ext = fileExtension(item.name);
    try {
      if (["jpg", "jpeg", "png"].includes(ext)) {
        const bytes = await item.file.arrayBuffer();
        const embedded =
          ext === "png"
            ? await output.embedPng(bytes)
            : await output.embedJpg(bytes);
        images.push({ item, embedded });
      } else if (ext === "pdf") {
        const bytes = new Uint8Array(await item.file.arrayBuffer());
        const pdf = await PDFLib.PDFDocument.load(bytes);
        documents.push({ item, bytes, pageCount: pdf.getPageCount() });
      } else if (ext === "docx") {
        const bytes = await htmlToPdfBytes(item.name, await docxToHtml(item.file));
        const pdf = await PDFLib.PDFDocument.load(bytes);
        documents.push({ item, bytes, pageCount: pdf.getPageCount() });
      } else if (["xls", "xlsx", "csv"].includes(ext)) {
        const bytes = await htmlToPdfBytes(item.name, await spreadsheetToHtml(item.file));
        const pdf = await PDFLib.PDFDocument.load(bytes);
        documents.push({ item, bytes, pageCount: pdf.getPageCount() });
      } else if (ext === "txt") {
        const text = await fileToText(item.file);
        const bytes = await htmlToPdfBytes(item.name, `<pre class="imported-text">${esc(text)}</pre>`);
        const pdf = await PDFLib.PDFDocument.load(bytes);
        documents.push({ item, bytes, pageCount: pdf.getPageCount() });
      } else {
        preservedOnly.push(item);
      }
    } catch (error) {
      preservedOnly.push(item);
    }
  }
  return { images, documents, preservedOnly };
}

function addMaterialImagePage(output, entries, header, layout, showHeader) {
  const page = output.addPage([layout.pageWidth, layout.pageHeight]);
  const marginTop = layout.marginTop ?? layout.margin;
  const marginBottom = layout.marginBottom ?? layout.margin;
  const marginLeft = layout.marginLeft ?? layout.margin;
  const topSpace = showHeader ? layout.labelHeight + layout.labelGap : 0;
  if (showHeader)
    page.drawImage(header, {
      x: marginLeft,
      y: layout.pageHeight - marginTop - layout.labelHeight,
      width: layout.contentWidth,
      height: layout.labelHeight,
    });
  const availableHeight =
    layout.pageHeight - marginTop - marginBottom - topSpace;
  const gap = entries.length > 1 ? 16 : 0;
  const slotHeight = (availableHeight - gap) / entries.length;
  entries.forEach((entry, index) => {
    const scale = Math.min(
      layout.contentWidth / entry.embedded.width,
      slotHeight / entry.embedded.height,
      1,
    );
    const width = entry.embedded.width * scale;
    const height = entry.embedded.height * scale;
    const slotTop =
      marginBottom +
      availableHeight -
      index * (slotHeight + gap) -
      slotHeight;
    page.drawImage(entry.embedded, {
      x: marginLeft + (layout.contentWidth - width) / 2,
      y: slotTop + (slotHeight - height) / 2,
      width,
      height,
    });
  });
}

async function addMaterialDocumentPages(
  output,
  document,
  header,
  layout,
  showHeaderFirst,
) {
  const sourcePages = await output.embedPdf(document.bytes);
  sourcePages.forEach((sourcePage, index) => {
    const showHeader = showHeaderFirst && index === 0;
    const page = output.addPage([layout.pageWidth, layout.pageHeight]);
    const marginTop = layout.marginTop ?? layout.margin;
    const marginBottom = layout.marginBottom ?? layout.margin;
    const marginLeft = layout.marginLeft ?? layout.margin;
    const topSpace = showHeader ? layout.labelHeight + layout.labelGap : 0;
    if (showHeader)
      page.drawImage(header, {
        x: marginLeft,
        y: layout.pageHeight - marginTop - layout.labelHeight,
        width: layout.contentWidth,
        height: layout.labelHeight,
      });
    const availableHeight =
      layout.pageHeight - marginTop - marginBottom - topSpace;
    const scale = Math.min(
      layout.contentWidth / sourcePage.width,
      availableHeight / sourcePage.height,
      1,
    );
    const width = sourcePage.width * scale;
    const height = sourcePage.height * scale;
    page.drawPage(sourcePage, {
      x: marginLeft + (layout.contentWidth - width) / 2,
      y: marginBottom + (availableHeight - height) / 2,
      width,
      height,
    });
  });
}

async function rawMaterialPdf(items) {
  if (!window.PDFLib) throw new Error("PDF组件尚未加载，请刷新页面后重试");
  if (!items.length) throw new Error("请先上传需要提交的身份材料");
  const output = await PDFLib.PDFDocument.create();
  const parties = [];
  const groups = new Map();
  for (const item of items) {
    const partyName = item.partyName || state.plaintiffName || "未填写";
    const partyType = item.partyType || state.plaintiffType || "未填写";
    let party = parties.find(
      (entry) => entry.name === partyName && entry.type === partyType,
    );
    if (!party) {
      party = { name: partyName, type: partyType, materials: [] };
      parties.push(party);
    }
    const material = identityGroupTitle(item);
    if (!party.materials.includes(material)) party.materials.push(material);
    const groupKey = `${partyName}|${partyType}|${material}`;
    if (!groups.has(groupKey)) groups.set(groupKey, { title: material, items: [] });
    groups.get(groupKey).items.push(item);
  }
  const coverBody = `<h2>当事人身份证明</h2><table class="doc-table identity-summary-table"><tr><th style="width:34%">当事人</th><th>所附材料</th></tr>${parties.map((party) => `<tr><td>${esc(party.name)}（${esc(party.type)}）</td><td>${party.materials.map((material, index) => `${index + 1}. ${esc(material)}`).join("<br>")}</td></tr>`).join("")}</table>`;
  await appendPdfBytes(
    output,
    await htmlToPdfBytes("当事人身份证明", coverBody),
  );
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 36;
  const marginTop = PDF_VERTICAL_MARGIN_PT;
  const marginBottom = PDF_VERTICAL_MARGIN_PT;
  const labelHeight = 42;
  const labelGap = 12;
  const contentWidth = pageWidth - margin * 2;
  const imageHeight =
    pageHeight - marginTop - marginBottom - labelHeight - labelGap;
  const layout = {
    pageWidth,
    pageHeight,
    margin,
    marginTop,
    marginBottom,
    marginLeft: margin,
    labelHeight,
    labelGap,
    contentWidth,
    imageHeight,
  };
  for (const group of groups.values()) {
    const prepared = await prepareRenderableGroup(output, group.items);
    const chunks = imageChunks(
      prepared.images,
      group.title.includes("身份证"),
    );
    const pageCount =
      chunks.length +
      prepared.documents.reduce((sum, document) => sum + document.pageCount, 0);
    if (!pageCount) continue;
    const startPage = output.getPageCount() + 1;
    const endPage = startPage + pageCount - 1;
    const header = await materialHeaderImage(output, {
      title: group.title,
      count: prepared.images.length + prepared.documents.length,
      startPage,
      endPage,
    });
    let headerShown = false;
    chunks.forEach((chunk) => {
      addMaterialImagePage(output, chunk, header, layout, !headerShown);
      headerShown = true;
    });
    for (const document of prepared.documents) {
      await addMaterialDocumentPages(
        output,
        document,
        header,
        layout,
        !headerShown,
      );
      headerShown = true;
    }
  }
  if (!output.getPageCount()) throw new Error("没有可生成PDF的材料");
  return new Uint8Array(await output.save());
}

async function rasterEvidenceInfo(file, ext) {
  const source = await fileToDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error(`${file.name} 无法读取`));
    element.src = source;
  });
  if (ext !== "webp")
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      format: ext === "png" ? "png" : "jpg",
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d").drawImage(image, 0, 0);
  return {
    bytes: await canvasPngBytes(canvas),
    format: "png",
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

async function prepareEvidenceGroup(files) {
  const prepared = [];
  for (const item of files) {
    const ext = fileExtension(item.name);
    try {
      if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
        prepared.push({
          kind: "image",
          item,
          ...(await rasterEvidenceInfo(item.file, ext)),
        });
      } else if (ext === "pdf") {
        const bytes = new Uint8Array(await item.file.arrayBuffer());
        const pdf = await PDFLib.PDFDocument.load(bytes);
        prepared.push({ kind: "document", item, bytes, pageCount: pdf.getPageCount() });
      } else if (ext === "docx") {
        const bytes = await htmlToPdfBytes(item.name, await docxToHtml(item.file));
        const pdf = await PDFLib.PDFDocument.load(bytes);
        prepared.push({ kind: "document", item, bytes, pageCount: pdf.getPageCount() });
      } else if (["xls", "xlsx", "csv"].includes(ext)) {
        const bytes = await htmlToPdfBytes(item.name, await spreadsheetToHtml(item.file));
        const pdf = await PDFLib.PDFDocument.load(bytes);
        prepared.push({ kind: "document", item, bytes, pageCount: pdf.getPageCount() });
      } else if (ext === "txt") {
        const bytes = await htmlToPdfBytes(
          item.name,
          `<pre class="imported-text">${esc(await fileToText(item.file))}</pre>`,
        );
        const pdf = await PDFLib.PDFDocument.load(bytes);
        prepared.push({ kind: "document", item, bytes, pageCount: pdf.getPageCount() });
      } else {
        throw new Error("文件格式不受支持");
      }
    } catch (error) {
      throw new Error(`${item.name} 无法编入PDF，请删除或重新导出后上传`);
    }
  }
  return prepared;
}

function evidenceOperations(prepared) {
  const operations = [];
  for (let index = 0; index < prepared.length; index++) {
    const entry = prepared[index];
    if (entry.kind === "document") {
      operations.push({ kind: "document", entry, pageCount: entry.pageCount });
      continue;
    }
    const next = prepared[index + 1];
    const wide = entry.height / Math.max(entry.width, 1) <= 1.35;
    const nextWide =
      next?.kind === "image" &&
      next.height / Math.max(next.width, 1) <= 1.35;
    if (wide && nextWide) {
      operations.push({ kind: "images", entries: [entry, next], pageCount: 1 });
      index += 1;
    } else {
      operations.push({ kind: "images", entries: [entry], pageCount: 1 });
    }
  }
  return operations;
}

function identityOperations(prepared, forcePairs) {
  const operations = [];
  for (let index = 0; index < prepared.length; index++) {
    const entry = prepared[index];
    if (entry.kind === "document") {
      operations.push({ kind: "document", entry, pageCount: entry.pageCount });
      continue;
    }
    const next = prepared[index + 1];
    const wide = entry.height / Math.max(entry.width, 1) <= 1.35;
    const nextWide =
      next?.kind === "image" &&
      next.height / Math.max(next.width, 1) <= 1.35;
    if (next?.kind === "image" && (forcePairs || (wide && nextWide))) {
      operations.push({ kind: "images", entries: [entry, next], pageCount: 1 });
      index += 1;
    } else {
      operations.push({ kind: "images", entries: [entry], pageCount: 1 });
    }
  }
  return operations;
}

function identityCoverDoc(pageRanges = new Map()) {
  const rows = state.identityMaterials
    .map((material, index) => {
      const files = identityFilesFor(material.id);
      return `<tr><td>${index + 1}</td><td>${valueOr(material.name)}</td><td>${files.length}</td><td>${valueOr(pageNumberList(pageRanges.get(material.id)), "—")}</td></tr>`;
    })
    .join("");
  return `<section class="identity-cover">
    <h2>当事人身份证明</h2>
    <div class="identity-party-description">
      <p class="no-indent"><b>当事人：</b>${partyDescription("plaintiff")}</p>
    </div>
    <h3>身份证明材料目录</h3>
    <table class="doc-table identity-directory-table">
      <tr><th style="width:10%">编号</th><th>材料名称</th><th style="width:18%">文件数量</th><th style="width:22%">页码</th></tr>
      ${rows}
    </table>
    <div class="identity-cover-signature">${documentSignatureBlock("当事人", true)}</div>
  </section>`;
}

async function identityHeaderImage(
  output,
  { number, name, count, startPage, endPage },
) {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 170;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#111111";
  context.font = '700 40px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText(`材料编号 ${number}：${name || "未填写材料名称"}`, 24, 56);
  context.font = '30px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText(
    `文件数量：${count}个　页码：${pageNumberList({ start: startPage, end: endPage })}`,
    24,
    112,
  );
  context.strokeStyle = "#999999";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(24, 148);
  context.lineTo(1576, 148);
  context.stroke();
  return output.embedPng(await canvasPngBytes(canvas));
}

async function appendIdentityPlan(output, plan, range, layout) {
  const header = await identityHeaderImage(output, {
    number: plan.number,
    name: plan.material.name,
    count: plan.files.length,
    startPage: range.start,
    endPage: range.end,
  });
  let headerShown = false;
  for (const operation of plan.operations) {
    if (operation.kind === "images") {
      const entries = [];
      for (const entry of operation.entries) {
        const embedded =
          entry.format === "png"
            ? await output.embedPng(entry.bytes)
            : await output.embedJpg(entry.bytes);
        entries.push({ item: entry.item, embedded });
      }
      addMaterialImagePage(output, entries, header, layout, !headerShown);
      headerShown = true;
    } else {
      await addMaterialDocumentPages(
        output,
        operation.entry,
        header,
        layout,
        !headerShown,
      );
      headerShown = true;
    }
  }
}

function identityRanges(directoryPages, plans) {
  const ranges = new Map();
  let page = directoryPages + 1;
  for (const plan of plans) {
    ranges.set(plan.material.id, {
      start: page,
      end: page + plan.pageCount - 1,
    });
    page += plan.pageCount;
  }
  return ranges;
}

async function identityMaterialPdf() {
  const plans = [];
  for (let index = 0; index < state.identityMaterials.length; index++) {
    const material = state.identityMaterials[index];
    const files = identityFilesFor(material.id);
    if (!files.length) continue;
    const prepared = await prepareEvidenceGroup(files);
    const operations = identityOperations(
      prepared,
      String(material.name || "").includes("身份证"),
    );
    plans.push({
      material,
      number: index + 1,
      files,
      operations,
      pageCount: operations.reduce((sum, operation) => sum + operation.pageCount, 0),
    });
  }

  let coverPages = 1;
  let coverBytes;
  let ranges;
  let stable = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    ranges = identityRanges(coverPages, plans);
    coverBytes = await htmlToPdfBytes(
      "当事人身份证明",
      identityCoverDoc(ranges),
    );
    const actualPages = (
      await PDFLib.PDFDocument.load(coverBytes)
    ).getPageCount();
    if (actualPages === coverPages) {
      stable = true;
      break;
    }
    coverPages = actualPages;
  }
  if (!stable) throw new Error("身份证明材料目录页码未能稳定生成，请减少过长材料名称后重试");

  const output = await PDFLib.PDFDocument.load(coverBytes);
  const layout = {
    pageWidth: 595.28,
    pageHeight: 841.89,
    margin: 36,
    marginTop: PDF_VERTICAL_MARGIN_PT,
    marginBottom: PDF_VERTICAL_MARGIN_PT,
    marginLeft: 36,
    labelHeight: 58,
    labelGap: 12,
    contentWidth: 595.28 - 72,
  };
  for (const plan of plans)
    await appendIdentityPlan(output, plan, ranges.get(plan.material.id), layout);
  return new Uint8Array(await output.save());
}

async function evidenceHeaderImage(
  output,
  { number, name, types, count, startPage, endPage, label='证据编号' },
) {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 170;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#111111";
  context.font = '700 40px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText(`${label} ${number}：${name || "未填写材料名称"}`, 24, 56);
  context.font = '30px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText(
    `文件类型：${types.join("、") || "图文"}　数量：${count}个　页码：${pageNumberList({ start: startPage, end: endPage })}`,
    24,
    112,
  );
  context.strokeStyle = "#999999";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(24, 148);
  context.lineTo(1576, 148);
  context.stroke();
  return output.embedPng(await canvasPngBytes(canvas));
}

async function appendEvidencePlan(output, plan, range, layout) {
  const header = await evidenceHeaderImage(output, {
    number: plan.number,
    name: plan.item.name,
    types: plan.types,
    count: plan.files.length,
    startPage: range.start,
    endPage: range.end,
    label:plan.headerLabel||'证据编号',
  });
  let headerShown = false;
  for (const operation of plan.operations) {
    if (operation.kind === "images") {
      const entries = [];
      for (const entry of operation.entries) {
        const embedded =
          entry.format === "png"
            ? await output.embedPng(entry.bytes)
            : await output.embedJpg(entry.bytes);
        entries.push({ item: entry.item, embedded });
      }
      addMaterialImagePage(output, entries, header, layout, !headerShown);
      headerShown = true;
    } else {
      await addMaterialDocumentPages(
        output,
        operation.entry,
        header,
        layout,
        !headerShown,
      );
      headerShown = true;
    }
  }
}

function evidenceRanges(directoryPages, plans) {
  const ranges = new Map();
  let page = directoryPages + 1;
  for (const plan of plans) {
    ranges.set(plan.item.id, {
      start: page,
      end: page + plan.pageCount - 1,
    });
    page += plan.pageCount;
  }
  return ranges;
}

async function evidenceMaterialPdf() {
  const plans = [];
  for (let index = 0; index < state.evidence.length; index++) {
    const item = state.evidence[index];
    if (item.kind === "media") continue;
    const files = evidenceFilesFor(item.id);
    if (!files.length) continue;
    const prepared = await prepareEvidenceGroup(files);
    const operations = evidenceOperations(prepared);
    plans.push({
      item,
      number: index + 1,
      files,
      types: evidenceFileTypes(files),
      operations,
      pageCount: operations.reduce((sum, operation) => sum + operation.pageCount, 0),
    });
  }

  let directoryPages = 1;
  let directoryBytes;
  let ranges;
  let stable = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    ranges = evidenceRanges(directoryPages, plans);
    directoryBytes = await htmlToPdfBytes(
      "证据目录及证据材料",
      evidenceDoc(ranges),
    );
    const actualPages = (
      await PDFLib.PDFDocument.load(directoryBytes)
    ).getPageCount();
    if (actualPages === directoryPages) {
      stable = true;
      break;
    }
    directoryPages = actualPages;
  }
  if (!stable) throw new Error("证据目录页码未能稳定生成，请减少过长文字后重试");

  const output = await PDFLib.PDFDocument.load(directoryBytes);
  const layout = {
    pageWidth: 595.28,
    pageHeight: 841.89,
    margin: 36,
    marginTop: PDF_VERTICAL_MARGIN_PT,
    marginBottom: PDF_VERTICAL_MARGIN_PT,
    marginLeft: 36,
    labelHeight: 58,
    labelGap: 12,
    contentWidth: 595.28 - 72,
  };
  for (const plan of plans)
    await appendEvidencePlan(output, plan, ranges.get(plan.item.id), layout);
  return new Uint8Array(await output.save());
}

async function defendantMaterialPdf(){
  const plans=[];
  for(const group of defendantMaterialGroups()){
    const prepared=await prepareEvidenceGroup(group.files),operations=String(group.item.name).includes('身份证')?identityOperations(prepared,true):evidenceOperations(prepared);
    plans.push({...group,types:evidenceFileTypes(group.files),headerLabel:'材料编号',operations,pageCount:operations.reduce((sum,item)=>sum+item.pageCount,0)});
  }
  let coverPages=1,coverBytes,ranges,stable=false;
  for(let attempt=0;attempt<3;attempt++){
    ranges=evidenceRanges(coverPages,plans);coverBytes=await htmlToPdfBytes(docLabels.defendant,defendantDoc(ranges));
    const actual=(await PDFLib.PDFDocument.load(coverBytes)).getPageCount();
    if(actual===coverPages){stable=true;break;}coverPages=actual;
  }
  if(!stable)throw Error('被告线索材料页码未能稳定生成，请缩短材料名称后重试');
  const output=await PDFLib.PDFDocument.load(coverBytes),layout={pageWidth:595.28,pageHeight:841.89,margin:36,marginTop:PDF_VERTICAL_MARGIN_PT,marginBottom:PDF_VERTICAL_MARGIN_PT,marginLeft:36,labelHeight:58,labelGap:12,contentWidth:595.28-72};
  for(const plan of plans)await appendEvidencePlan(output,plan,ranges.get(plan.item.id),layout);
  return new Uint8Array(await output.save());
}

async function categoryPdf(
  title,
  body,
  items = [],
  categoryName = "材料",
  options = {},
) {
  const attachments = await buildAttachmentHtml(items, categoryName, options);
  const base = await htmlToPdfBytes(title, `${body}${attachments.html}`);
  return mergePdfAttachments(base, attachments.pdfItems);
}

function safeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

function uniqueArchivePath(path, usedPaths) {
  if (!usedPaths.has(path)) {
    usedPaths.add(path);
    return path;
  }
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const hasExtension = dot > slash + 1;
  const stem = hasExtension ? path.slice(0, dot) : path;
  const extension = hasExtension ? path.slice(dot) : "";
  let index = 2;
  let candidate;
  do {
    candidate = `${stem} (${index})${extension}`;
    index += 1;
  } while (usedPaths.has(candidate));
  usedPaths.add(candidate);
  return candidate;
}

function duplicateArchiveFilename(item, group, index) {
  const original = safeFilename(item.name);
  const dot = original.lastIndexOf(".");
  const extension = dot > 0 ? original.slice(dot) : "";
  const label =
    group === "evidence"
      ? item.category || "证据材料"
      : item.materialType || item.category || "材料";
  return safeFilename(`${label}${index}${extension}`);
}

function withCategory(items, category) {
  return items.map((item) => ({ ...item, category: item.category || category }));
}

async function pdfForPreview(docId) {
  if (docId === "refund" && !state.includeRefundAccount)
    throw new Error("收款账户确认书是选传材料，请先在送达信息中勾选生成");
  const docs = documents();
  if (docId === "plaintiff")
    return identityMaterialPdf();
  if (docId === "defendant")return defendantMaterialPdf();
  if (docId === "evidence")
    return evidenceMaterialPdf();
  return categoryPdf(docLabels[docId], docs[docId]);
}

function pdfSignature(docId) {
  const uploadMeta = Object.fromEntries(
    Object.entries(uploads).map(([group, items]) => [
      group,
      items.map((item) => ({
        evidenceId: item.evidenceId || "",
        materialId: item.materialId || "",
        name: item.name,
        size: item.file?.size || 0,
        modified: item.file?.lastModified || 0,
        category: item.category || "",
        purpose: item.purpose || "",
        copyType: item.copyType || "",
        source: item.source || "",
        note: item.note || "",
      })),
    ]),
  );
  return JSON.stringify({ docId, state, uploadMeta });
}

async function getPdfSnapshot(docId) {
  const signature = pdfSignature(docId);
  if (pdfPreviewCache?.signature === signature) return pdfPreviewCache;
  if (pdfPreviewPending?.signature === signature)
    return pdfPreviewPending.promise;
  const promise = pdfForPreview(docId).then((bytes) => ({
    docId,
    signature,
    bytes,
  }));
  pdfPreviewPending = { signature, promise };
  try {
    const snapshot = await promise;
    if (signature === pdfSignature(docId)) pdfPreviewCache = snapshot;
    return snapshot;
  } finally {
    if (pdfPreviewPending?.signature === signature) pdfPreviewPending = null;
  }
}

async function showPdfSnapshot(snapshot, generation) {
  if (
    generation !== pdfPreviewGeneration ||
    snapshot.docId !== currentDoc ||
    snapshot.signature !== pdfSignature(currentDoc)
  )
    return;
  const pdfjs = await pdfJsPromise;
  const pdf = await pdfjs.getDocument({ data: snapshot.bytes.slice() }).promise;
  if (
    generation !== pdfPreviewGeneration ||
    snapshot.docId !== currentDoc ||
    snapshot.signature !== pdfSignature(currentDoc)
  )
    return;
  const target = document.getElementById("documentPreview");
  target.innerHTML = '<div class="pdf-preview-pages" id="pdfPreviewPages"></div>';
  const pages = target.querySelector("#pdfPreviewPages");
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.65 });
    const canvas = document.createElement("canvas");
    canvas.className = "pdf-preview-page";
    canvas.setAttribute("aria-label", `${docLabels[currentDoc]} 第${pageNumber}页`);
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    pages.appendChild(canvas);
    await page.render({
      canvasContext: canvas.getContext("2d"),
      viewport,
    }).promise;
    if (generation !== pdfPreviewGeneration) return;
  }
}

function queuePdfPreview() {
  const target = document.getElementById("documentPreview");
  target.className = "paper pdf-preview-paper";
  target.innerHTML = '<div class="pdf-preview-status">正在生成与下载文件完全一致的 PDF 预览…</div>';
  clearTimeout(pdfPreviewTimer);
  const generation = ++pdfPreviewGeneration;
  pdfPreviewTimer = setTimeout(async () => {
    try {
      await showPdfSnapshot(await getPdfSnapshot(currentDoc), generation);
    } catch (error) {
      if (generation !== pdfPreviewGeneration) return;
      target.innerHTML = `<div class="pdf-preview-status">PDF预览生成失败：${esc(error.message || "请刷新后重试")}</div>`;
    }
  }, 220);
}

async function fileSet({originalsOnly=false}={}) {
  const docs = documents();
  const agentItems = uploads.agent.map((item) => ({
    ...item,
    category: item.category || "代理材料",
    partyName: state.agentName,
    partyType: state.agentType,
    materialType: item.materialType || "授权委托或代理身份证明",
  }));
  const rawRoot=originalsOnly?"02_Word内原始文件":"02_PDF内原始文件";
  const files = [
    [originalsOnly?"01_最终Word/":"01_最终PDF/", new Uint8Array()],
    [rawRoot+"/", new Uint8Array()],
    ["03_需另行上传的影音证据/", new Uint8Array()],
  ];
  if(!originalsOnly){
  files.push([
    "01_最终PDF/01_起诉状.pdf",
    await categoryPdf("民事起诉状", docs.complaint),
  ]);
  files.push([
    "01_最终PDF/02_当事人身份证明.pdf",
    await identityMaterialPdf(),
  ]);
  files.push([
    "01_最终PDF/03_被告线索辅助表.pdf",
    await defendantMaterialPdf(),
  ]);
  const agentPdfItems = agentItems.filter((item) =>
    ["pdf", "jpg", "jpeg", "png", "docx"].includes(fileExtension(item.name)),
  );
  if (state.represented === "yes" && agentPdfItems.length) {
    files.push([
      "01_最终PDF/03A_委托代理人委托手续和身份材料.pdf",
      await rawMaterialPdf(agentPdfItems),
    ]);
  }
  files.push([
    "01_最终PDF/04_证据目录及证据材料.pdf",
    await evidenceMaterialPdf(),
  ]);
  files.push([
    "01_最终PDF/05_送达地址确认书.pdf",
    await categoryPdf("送达地址确认书", docs.service),
  ]);
  if (state.includeRefundAccount) {
    files.push([
      "01_最终PDF/06_收款账户确认书.pdf",
      await categoryPdf("收款账户确认书", docs.refund),
    ]);
  }
  }
  const categoryFolders = {
    agent: "03A_委托代理人材料",
  };
  const usedPaths = new Set(files.map(([path]) => path));
  for (let materialIndex = 0; materialIndex < state.identityMaterials.length; materialIndex++) {
    const material = state.identityMaterials[materialIndex];
    const materialFiles = identityFilesFor(material.id);
    if (!materialFiles.length) continue;
    const folderName = `${String(materialIndex + 1).padStart(2, "0")}_${safeFilename(material.name || "未填写材料名称")}`;
    const nameCounts = new Map();
    materialFiles.forEach((item) => {
      const name = safeFilename(item.name);
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    });
    let duplicateIndex = 0;
    for (const item of materialFiles) {
      const safeName = safeFilename(item.name);
      let archiveFilename = safeName;
      if ((nameCounts.get(safeName) || 0) > 1) {
        duplicateIndex += 1;
        const dot = safeName.lastIndexOf(".");
        const extension = dot > 0 ? safeName.slice(dot) : "";
        archiveFilename = `${safeFilename(material.name || "身份材料")}${duplicateIndex}${extension}`;
      }
      const archivePath = uniqueArchivePath(
        `${rawRoot}/02_当事人身份证明/${folderName}/${archiveFilename}`,
        usedPaths,
      );
      files.push([
        archivePath,
        new Uint8Array(await item.file.arrayBuffer()),
      ]);
    }
  }
  for(const group of defendantMaterialGroups()){
    const folder=`${rawRoot}/03_被告线索辅助材料/${String(group.number).padStart(2,'0')}_${safeFilename(group.item.name||'被告信息材料')}`;
    for(let index=0;index<group.files.length;index++){
      const item=group.files[index],ext=fileExtension(item.name);
      const archivePath=uniqueArchivePath(`${folder}/${safeFilename(group.item.name||'被告信息材料')}${index+1}.${ext}`,usedPaths);
      files.push([archivePath,new Uint8Array(await item.file.arrayBuffer())]);
    }
  }
  for (const group of Object.keys(categoryFolders)) {
    if (group === "agent" && state.represented !== "yes") continue;
    const duplicateCounts = new Map();
    for (const item of uploads[group]) {
      const root = rawRoot;
      const key = `${root}/${categoryFolders[group]}/${safeFilename(item.name)}`;
      duplicateCounts.set(key, (duplicateCounts.get(key) || 0) + 1);
    }
    const duplicateIndexes = new Map();
    for (const item of uploads[group]) {
      const root = rawRoot;
      const originalPath = `${root}/${categoryFolders[group]}/${safeFilename(item.name)}`;
      let archiveFilename = safeFilename(item.name);
      if ((duplicateCounts.get(originalPath) || 0) > 1) {
        const label = item.materialType || item.category || "材料";
        const key = `${root}/${categoryFolders[group]}/${label}`;
        const index = (duplicateIndexes.get(key) || 0) + 1;
        duplicateIndexes.set(key, index);
        archiveFilename = duplicateArchiveFilename(item, group, index);
      }
      const archivePath = uniqueArchivePath(
        `${root}/${categoryFolders[group]}/${archiveFilename}`,
        usedPaths,
      );
      files.push([
        archivePath,
        new Uint8Array(await item.file.arrayBuffer()),
      ]);
    }
  }

  for (let evidenceIndex = 0; evidenceIndex < state.evidence.length; evidenceIndex++) {
    const evidence = state.evidence[evidenceIndex];
    if (evidence.kind === "media") continue;
    const evidenceFiles = evidenceFilesFor(evidence.id);
    if (!evidenceFiles.length) continue;
    const folderName = `${String(evidenceIndex + 1).padStart(2, "0")}_${safeFilename(evidence.name || "未填写证据名称")}`;
    const nameCounts = new Map();
    evidenceFiles.forEach((item) => {
      const name = safeFilename(item.name);
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    });
    let duplicateIndex = 0;
    for (const item of evidenceFiles) {
      const safeName = safeFilename(item.name);
      let archiveFilename = safeName;
      if ((nameCounts.get(safeName) || 0) > 1) {
        duplicateIndex += 1;
        const dot = safeName.lastIndexOf(".");
        const extension = dot > 0 ? safeName.slice(dot) : "";
        archiveFilename = `${safeFilename(evidence.name || "证据材料")}${duplicateIndex}${extension}`;
      }
      const archivePath = uniqueArchivePath(
        `${rawRoot}/04_证据材料/${folderName}/${archiveFilename}`,
        usedPaths,
      );
      files.push([
        archivePath,
        new Uint8Array(await item.file.arrayBuffer()),
      ]);
    }
  }

  const mediaRows = state.evidence
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === "media");
  const mediaChecklist = mediaRows.length
    ? [
        "影音证据另行上传清单",
        "",
        "以下影音文件未包含在本资料包中，请在人民法院在线服务平台按证据编号另行上传：",
        "",
        ...mediaRows.flatMap(({ item, index }) => [
          `编号：${index + 1}`,
          `证据名称：${item.name || "未填写"}`,
          `文件类型：${item.mediaType || "视频"}`,
          `文件数量：${Math.max(1, Number(item.fileCount || 1))}`,
          `证据来源：${item.source || "原告提供"}`,
          `证明内容：${item.purpose || "未填写"}`,
          `备注：${MEDIA_EVIDENCE_NOTE}`,
          "",
        ]),
      ].join("\n")
    : "影音证据另行上传清单\n\n本案当前未登记影音证据。";
  files.push([
    "03_需另行上传的影音证据/影音证据另行上传清单.txt",
    mediaChecklist,
  ]);
  return files;
}

function downloadBlob(filename, blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function downloadCurrent() {
  const filename = `${docLabels[currentDoc]}.pdf`;
  try {
    setDownloadBusy(true, "正在生成PDF…");
    const snapshot = await getPdfSnapshot(currentDoc);
    downloadBlob(
      filename,
      new Blob([snapshot.bytes], { type: "application/pdf" }),
    );
    toast(`已下载：${filename}`);
  } catch (error) {
    toast(`PDF生成失败：${error.message || "请重试"}`);
  } finally {
    setDownloadBusy(false);
  }
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  return new Uint8Array([value & 255, (value >>> 8) & 255]);
}
function u32(value) {
  return new Uint8Array([
    value & 255,
    (value >>> 8) & 255,
    (value >>> 16) & 255,
    (value >>> 24) & 255,
  ]);
}
function concat(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function makeZip(files) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const filename = encoder.encode(name);
    const data =
      content instanceof Uint8Array ? content : encoder.encode(content);
    const crc = crc32(data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(filename.length),
      u16(0),
      filename,
      data,
    ]);
    locals.push(local);
    centrals.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(filename.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        filename,
      ]),
    );
    offset += local.length;
  }
  const central = concat(centrals);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  return new Blob([...locals, central, end], { type: "application/zip" });
}

function setDownloadBusy(busy, label = "正在生成PDF资料包…") {
  ["downloadAllBtn", "downloadPackageBtn", "downloadCurrentBtn", "nextBtn"].forEach(
    (id) => {
      const button = document.getElementById(id);
      if (!button) return;
      if (busy) {
        if (!button.dataset.originalText)
          button.dataset.originalText = button.textContent;
        button.disabled = true;
        if (id !== "downloadCurrentBtn" || label.includes("PDF"))
          button.textContent = label;
      } else {
        button.disabled = false;
        if (button.dataset.originalText) {
          button.textContent = button.dataset.originalText;
          delete button.dataset.originalText;
        }
      }
    },
  );
}

async function downloadPackage() {
  const critical = [...platformChecks(), ...requiredChecks()].filter(
    (check) => !check.ok,
  ).length;
  try {
    setDownloadBusy(true);
    const files = await fileSet();
    downloadBlob(
      `九江买卖合同纠纷PDF资料_${state.plaintiffName || "草稿"}.zip`,
      makeZip(files),
    );
    toast(
      critical
        ? `PDF资料包已下载，仍有 ${critical} 项待补充`
        : "PDF资料包已下载，请在提交前签名并核对",
    );
  } catch (error) {
    toast(`PDF资料包生成失败：${error.message || "请重试"}`);
  } finally {
    setDownloadBusy(false);
  }
}

function fillSample() {
  uploads = {
    plaintiff: [],
    agent: [],
    defendant: [],
    evidence: [],
  };
  state = {
    ...structuredClone(defaultState),
    court: "九江市浔阳区人民法院",
    jurisdictionAgreement: "no",
    arbitration: "no",
    jurisdictionBases: [
      "被告住所地或公司登记地在九江",
      "原告住所地在九江（货款为给付货币，接收货币一方所在地为合同履行地）",
      "合同履行地或交货地在九江",
    ],
    jurisdictionNote:
      "被告登记地及实际经营地均位于九江市浔阳区，货物也交付至该经营场所。",
    plaintiffType: "个体工商户",
    plaintiffName: "浔阳区江畔百货商行",
    plaintiffCountry: "中国",
    plaintiffLicenseType: "营业执照",
    plaintiffId: "92360403XXXXXXXXXX",
    plaintiffPhone: "13800000000",
    plaintiffAddress: "江西省九江市浔阳区示例路18号",
    plaintiffRepresentative: "张三",
    plaintiffRepresentativeTitle: "经营者",
    plaintiffRepresentativePhone: "13800000000",
    identityMaterials: [createIdentityMaterial("个体工商户")],
    defendantType: "公司",
    defendantName: "九江示例商贸有限公司",
    defendantCountry: "中国",
    defendantLicenseType: "营业执照",
    defendantId: "91360403XXXXXXXXXX",
    defendantPhone: "13900000000",
    defendantAddress: "江西省九江市浔阳区示例大道66号",
    defendantActualAddress: "同注册地址",
    defendantRepresentative: "李四",
    defendantRepresentativePhone: "13900000000",
    defendantInfoSource: "送货单、付款记录及国家企业信用信息公示系统",
    contractForm: "无书面合同（送货单等）",
    contractDate: "2026-03-02",
    contractName: "",
    dealFormation:
      "被告法定代表人李四于2026年3月2日通过微信向原告订购一批日用品，双方在微信中确认了品名、数量、单价及交货地点",
    deliveryReceipt:
      "2026年3月12日送货单由被告仓库工作人员李某签字确认，送货单载明货物品名、数量、单价和总金额",
    priceBasis:
      "以双方微信中确认的报价和送货单所列单价为依据，原告开具的发票金额与送货单金额一致",
    debtAcknowledgement:
      "被告已支付18000元部分货款，并在后续催款微信中承认剩余货款尚未支付",
    goods: "日用百货一批，品名及数量见送货单",
    deliveryDate: "2026-03-12",
    deliveryPlace: "九江市浔阳区示例大道66号被告仓库",
    deliveryDetails:
      "原告按约将全部货物送至被告仓库，被告工作人员李某在送货单上签字确认，未在约定期限内提出质量或数量异议",
    totalAmount: "58000",
    paidAmount: "18000",
    dueDate: "2026-04-15",
    qualityDispute: "no",
    paymentTerms: "收货并验收后30日内付清全部货款",
    demandHistory:
      "2026年4月20日、5月8日和6月2日通过微信催款，被告法定代表人均回复资金周转困难并承诺尽快支付，但至今未付",
    claimInterest: false,
    interestTerms: "",
    claimCosts: true,
    serviceRecipient: "张三",
    serviceSigner: "张三",
    serviceAddress: "江西省九江市浔阳区示例路18号",
    servicePostcode: "332000",
    servicePhone: "13800000000",
    serviceEmail: "zhangsan@example.com",
    electronicService: "yes",
    includeRefundAccount: false,
    represented: "no",
    evidence: [
      createEvidenceItem("document", {
        name: "微信订货及催款记录",
        source: "原告提供",
        purpose: "证明双方达成买卖交易、付款期限届满及被告承认欠款",
      }),
    ],
  };
  hydrateForm();
  refresh();
  toast("已填入虚构示例，可直接体验生成效果");
}

function resetAll() {
  if (!confirm("确定清空当前填写的全部内容吗？此操作无法撤销。")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = structuredClone(defaultState);
  uploads = {
    plaintiff: [],
    agent: [],
    defendant: [],
    evidence: [],
  };
  hydrateForm();
  setStep(0);
  refresh();
  toast("已清空");
}

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}

function registerWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const signal = new AbortController();
  // 可写字段：除证据数组和内部字段外的全部案件字段
  const settableKeys = Object.keys(defaultState).filter(
    (key) =>
      !["evidence", "identityMaterials"].includes(key) && !key.startsWith("_"),
  );
  const tools = [
    {
      name: "set_case_fields",
      title: "填写案件字段",
      description:
        "批量填写本案任意字段并同步页面。字段名必须是案件字段名（如 plaintiffName、defendantAddress、totalAmount、dueDate、dealFormation）。调用后请把改动告诉用户确认。",
      inputSchema: {
        type: "object",
        properties: {
          fields: {
            type: "object",
            description: "字段名到值的映射",
            additionalProperties: true,
          },
        },
        required: ["fields"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const patch = input?.fields || {};
        const rejected = Object.keys(patch).filter(
          (key) => !settableKeys.includes(key),
        );
        if (rejected.length)
          throw new Error(`不支持的字段：${rejected.join("、")}`);
        if (
          patch.totalAmount != null &&
          patch.paidAmount != null &&
          Number(patch.paidAmount) > Number(patch.totalAmount)
        )
          throw new Error("已付款不能高于货款总额");
        const changed = [];
        for (const [key, value] of Object.entries(patch)) {
          const next = Array.isArray(value)
            ? value.map(String)
            : typeof value === "boolean"
              ? value
              : String(value);
          if (state[key] !== next) {
            state[key] = next;
            changed.push(key);
          }
        }
        hydrateForm();
        refresh();
        return {
          changed,
          outstandingAmount: principal(),
          completeness: completion(),
          stillMissing: [...platformChecks(), ...requiredChecks()]
            .filter((check) => !check.ok)
            .map((check) => check.label),
        };
      },
    },
    {
      name: "get_case_readiness",
      title: "检查资料完整度",
      description:
        "读取必选材料项的完成情况，按步骤分组，带缺项说明和风险提示。用于决定下一步该问用户什么。不修改页面。",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute() {
        const official = platformChecks();
        const checks = requiredChecks();
        const byStep = new Map();
        checks.forEach((check) => {
          if (!byStep.has(check.step))
            byStep.set(check.step, {
              step: check.step + 1,
              title: stepMeta[check.step][0],
              items: [],
            });
          byStep.get(check.step).items.push({
            id: check.id,
            label: check.label,
            document: check.doc,
            done: check.ok,
            hint: check.hint,
          });
        });
        return {
          region: CONTRACT.region,
          documents: CONTRACT.documents.map((doc) => doc.title),
          platformMaterials: (CONTRACT.platformMaterials || []).map(
            (material) => ({
              title: material.title,
              requirement:
                material.requirement === "required"
                  ? "必传"
                  : material.requirement === "conditional"
                    ? "按情况选传"
                    : "选传",
            }),
          ),
          completeness: completion(),
          officialRequiredTotal: official.filter(
            (check) => check.officiallyRequired,
          ).length,
          officialRequiredDone: official.filter(
            (check) => check.officiallyRequired && check.ok,
          ).length,
          informationTotal: checks.length,
          informationDone: checks.filter((check) => check.ok).length,
          missing: [...official, ...checks]
            .filter((check) => !check.ok)
            .map((check) => check.label),
          steps: [...byStep.values()].sort((a, b) => a.step - b.step),
          risks: risks().map(([level, text]) => ({ level, text })),
        };
      },
    },
  ];
  tools.forEach((tool) =>
    Promise.resolve(
      context.registerTool(tool, { signal: signal.signal }),
    ).catch(() => {}),
  );
}

document.getElementById("stepNav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-step]");
  if (button) setStep(Number(button.dataset.step));
});
document
  .getElementById("prevBtn")
  .addEventListener("click", () => setStep(currentStep - 1));
document
  .getElementById("nextBtn")
  .addEventListener("click", () =>
    currentStep === 5 ? downloadPackage() : setStep(currentStep + 1),
  );
document.getElementById("issueList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-review-issue]");
  if (button) openReviewIssue(Number(button.dataset.reviewIssue));
});
document.getElementById("aiReviewBtn").addEventListener("click", runAiReview);
document.getElementById("aiReviewResult").addEventListener("click", (event) => {
  const button = event.target.closest("[data-ai-review-issue]");
  if (button) openIssue(currentAiIssues[Number(button.dataset.aiReviewIssue)]);
});
const evidenceTypeDialog = document.getElementById("evidenceTypeDialog");
document.getElementById("addEvidenceBtn").addEventListener("click", () => {
  evidenceTypeDialog.returnValue = "";
  evidenceTypeDialog.showModal();
});
evidenceTypeDialog.addEventListener("close", () => {
  if (["document", "media"].includes(evidenceTypeDialog.returnValue))
    addEvidence(evidenceTypeDialog.returnValue);
});
document
  .getElementById("addIdentityMaterialBtn")
  .addEventListener("click", addIdentityMaterial);
document.getElementById("agentFiles").addEventListener("change", (event) => {
  handleFiles("agent", event.target.files);
  event.target.value = "";
});
document
  .getElementById("defendantFiles")
  .addEventListener("change", (event) => {
    handleFiles("defendant", event.target.files);
    event.target.value = "";
  });
document.getElementById("sampleBtn").addEventListener("click", fillSample);
document.getElementById("resetBtn").addEventListener("click", resetAll);
document
  .getElementById("downloadAllBtn")
  .addEventListener("click", downloadPackage);
document
  .getElementById("downloadPackageBtn")
  .addEventListener("click", downloadPackage);
document
  .getElementById("downloadCurrentBtn")
  .addEventListener("click", downloadCurrent);
document
  .getElementById("printBtn")
  .addEventListener("click", async () => {
    try {
      const snapshot = await getPdfSnapshot(currentDoc);
      const url = URL.createObjectURL(
        new Blob([snapshot.bytes], { type: "application/pdf" }),
      );
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      toast(`PDF打开失败：${error.message || "请重试"}`);
    }
  });
document.getElementById("documentTabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-doc]");
  if (!button) return;
  currentDoc = button.dataset.doc;
  const targetStep =
    currentDoc === "refund" ? 4 : STEP_DOCUMENTS.indexOf(currentDoc);
  if (targetStep >= 0 && targetStep !== currentStep)
    setStep(targetStep, false);
  document
    .querySelectorAll("[data-doc]")
    .forEach((el) => el.classList.toggle("active", el === button));
  refresh();
});

/* 法院列表与管辖连接点由契约渲染，换地区只改 contracts/*.js */
function populateCourts() {
  document.querySelectorAll('select[data-field="court"]').forEach((select) => {
    select.innerHTML =
      '<option value="">请选择</option>' +
      CONTRACT.courts.map((court) => `<option>${esc(court)}</option>`).join("");
    select.value = state.court || "";
  });
}

function populateJurisdictionChoices() {
  const wrap = document.getElementById("jurisdictionChoices");
  if (!wrap) return;
  wrap.innerHTML = CONTRACT.jurisdictionGrounds
    .map(
      (ground) =>
        `<label${ground.writtenContractOnly ? ' class="written-contract-only"' : ""}><input type="checkbox" value="${esc(ground.value)}" />${esc(ground.short)}</label>`,
    )
    .join("");
}

populateCourts();
populateJurisdictionChoices();
hydrateForm();
bindForm();
setStep(0);
refresh();
registerWebMcp();

/* 契约自检：防止「表单收集了字段但文书不输出」这类死字段重新出现 */
const contractIssues = validateContract();
if (contractIssues.orphans.length || contractIssues.unknown.length) {
  console.warn(
    "[契约自检] 收集了但契约未声明的字段（白问）:",
    contractIssues.orphans,
  );
  console.warn(
    "[契约自检] 契约声明但 state 中不存在的字段（拼写错误）:",
    contractIssues.unknown,
  );
}
