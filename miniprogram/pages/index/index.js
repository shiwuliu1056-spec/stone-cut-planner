// 文件用途：单页承载「石材下料」与「视频去水印」两个工具的全部交互逻辑。
// 两个工具用 data.tool 切换显隐（WXML 里走 hidden），不做页面跳转，
// 因此不存在 webview 交换，也就不会出现 iOS 切换时的整屏白帧。
const {
  defaultProject,
  loadProject,
  projectSummary,
  saveProject,
} = require("../../utils/project");
const {
  deleteCloudFile,
  getCloudTempUrl,
  readLocalFile,
  requestBinary,
  requestJson,
  uploadCloudFile,
} = require("../../services/api");
const { userMessage } = require("../../utils/errors");

/* ------------------------------------------------------------ 视频去水印常量 */

const VIDEO_PLATFORMS = [
  {
    value: "wechat_channels",
    label: "视频号",
    inputTitle: "粘贴视频号链接",
    placeholder:
      "支持 weixin.qq.com/sph/ 分享链接，也可输入视频 ID 或 exportId",
  },
  {
    value: "douyin",
    label: "抖音",
    inputTitle: "粘贴视频链接",
    placeholder: "支持抖音分享链接或完整分享文案",
  },
  {
    value: "xiaohongshu",
    label: "小红书",
    inputTitle: "粘贴视频链接",
    placeholder: "支持小红书视频笔记链接或分享文案",
  },
  {
    value: "tiktok",
    label: "TikTok",
    inputTitle: "粘贴视频链接",
    placeholder: "支持 TikTok 视频链接或完整分享文案",
  },
];

const DEFAULT_PLATFORM_INDEX = Math.max(
  0,
  VIDEO_PLATFORMS.findIndex((item) => item.value === "douyin"),
);
const DEFAULT_PLATFORM =
  VIDEO_PLATFORMS[DEFAULT_PLATFORM_INDEX] || VIDEO_PLATFORMS[0];

/** 导航栏标题：单页承载两个工具，切工具时要手动同步原生导航栏标题 */
const TOOL_TITLES = {
  cut: "石材下料工具",
  watermark: "视频去水印",
};

/* ---------------------------------------------------------------- 纯工具函数 */

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function progressPatch(value) {
  const progress = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return {
    progress,
    progressRingStyle: `background: conic-gradient(#c99352 ${progress}%, rgba(201, 147, 82, 0.16) 0);`,
  };
}

function videoProgressPatch(value) {
  const videoProgress = Math.max(
    0,
    Math.min(100, Math.round(Number(value) || 0)),
  );
  return {
    videoProgress,
    videoProgressRingStyle: `background: conic-gradient(#c99352 ${videoProgress}%, rgba(201, 147, 82, 0.16) 0);`,
  };
}

function publicApiBaseUrl() {
  const app = getApp();
  return String(
    (app && app.globalData && app.globalData.publicApiBaseUrl) || "",
  ).replace(/\/$/, "");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* --------------------------------------------------------------------- 页面 */

Page({
  data: {
    /** 当前工具：'cut' 石材下料 | 'watermark' 视频去水印 */
    tool: "cut",

    /* ---- 石材下料 ---- */
    project: defaultProject(),
    summary: { totalCount: 0, totalArea: "0.000" },
    slabLimits: ["不限", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
    importing: false,
    ocrBusy: false,
    solving: false,
    busy: false,
    progressTask: "",
    progress: 0,
    progressRingStyle: progressPatch(0).progressRingStyle,

    /* ---- 视频去水印 ---- */
    platforms: VIDEO_PLATFORMS,
    platformIndex: DEFAULT_PLATFORM_INDEX,
    platform: DEFAULT_PLATFORM.value,
    platformLabel: DEFAULT_PLATFORM.label,
    inputTitle: DEFAULT_PLATFORM.inputTitle,
    inputPlaceholder: DEFAULT_PLATFORM.placeholder,
    link: "",
    parsing: false,
    transcribing: false,
    saving: false,
    result: null,
    mediaToken: "",
    videoUrl: "",
    transcript: "",
    transcriptStatus: "",
    transcriptError: "",
    transcriptRequested: false,
    transcriptExpanded: false,
    transcriptCanExpand: false,
    videoProgressTask: "",
    videoProgressTitle: "",
    videoProgressMessage: "",
    videoProgress: 0,
    videoProgressRingStyle: videoProgressPatch(0).videoProgressRingStyle,
  },

  onLoad(query) {
    this.pageDestroyed = false;
    this.syncProject(loadProject());
    // 深链接：pages/index/index?tool=watermark 可直接落在去水印工具上。
    const requested = String((query && query.tool) || "");
    const tool = requested === "watermark" ? "watermark" : "cut";
    if (tool !== this.data.tool) this.setData({ tool });
    this.applyToolTitle(tool);
  },

  onShow() {
    // 只在页面重新可见时校准草稿（例如从拍照识别页返回后）。
    // 工具切换不再触发 onShow，所以切换路径上没有任何 setData。
    const stored = loadProject();
    if (JSON.stringify(stored) !== JSON.stringify(this.data.project)) {
      this.syncProject(stored);
    }
  },

  onUnload() {
    this.pageDestroyed = true;
    this.clearProgress();
    if (this.parseProgressTimer) clearInterval(this.parseProgressTimer);
    this.parseProgressTimer = null;
  },

  /* ------------------------------------------------------------ 工具切换 */

  switchTool(event) {
    const tool = String(event.currentTarget.dataset.tool || "");
    if (!tool || tool === this.data.tool) return;
    // 两个工具用 hidden 常驻，video 组件不会被销毁：切走时若不手动暂停，
    // 视频的音频会继续播。
    if (this.data.tool === "watermark" && this.data.videoUrl) {
      try {
        wx.createVideoContext("watermarkVideo", this).pause();
      } catch {
        /* 部分环境下取不到上下文，忽略 */
      }
    }
    // 只切 hidden，不换 webview、不重建 DOM —— 这是消除切换白帧的关键。
    this.setData({ tool });
    this.applyToolTitle(tool);
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    // 震动延后一个 tick：vibrateShort 会同步调用系统震动服务，
    // 先让它别挡在切换路径上。
    setTimeout(() => wx.vibrateShort({ type: "light", fail: () => {} }), 0);
  },

  /** 同步原生导航栏标题（原本由各页 json 的 navigationBarTitleText 提供）*/
  applyToolTitle(tool) {
    wx.setNavigationBarTitle({
      title: TOOL_TITLES[tool] || TOOL_TITLES.cut,
      fail: () => {},
    });
  },

  /* ============================================================ 石材下料 */

  isBusy() {
    return Boolean(this.busyLock);
  },

  lockBusy() {
    if (this.busyLock) return false;
    this.busyLock = true;
    if (!this.pageDestroyed) this.setData({ busy: true });
    return true;
  },

  unlockBusy() {
    this.busyLock = false;
    if (!this.pageDestroyed) this.setData({ busy: false });
  },

  beginProgress(task) {
    this.clearProgress();
    const token = String((this.progressSequence || 0) + 1);
    this.progressSequence = Number(token);
    this.progressToken = token;
    this.progressPhase = "upload";
    this.setData({ progressTask: task, ...progressPatch(1) });
    this.progressTimer = setInterval(() => {
      if (
        this.pageDestroyed ||
        token !== this.progressToken ||
        this.progressPhase !== "request"
      )
        return;
      const current = Number(this.data.progress) || 1;
      if (current >= 94) return;
      const next = Math.min(94, current + (current < 40 ? 4 : 2));
      this.setData(progressPatch(next));
    }, 360);
    return token;
  },

  updateUploadProgress(token, value) {
    if (this.pageDestroyed || token !== this.progressToken) return;
    const current = Number(this.data.progress) || 0;
    const mapped = Math.max(
      5,
      Math.min(45, 5 + Math.round(Number(value || 0) * 0.4)),
    );
    if (mapped > current) this.setData(progressPatch(mapped));
  },

  beginRequestProgress(token, baseline = 45) {
    if (this.pageDestroyed || token !== this.progressToken) return;
    this.progressPhase = "request";
    const current = Number(this.data.progress) || 0;
    this.setData(progressPatch(Math.max(current, baseline)));
  },

  clearProgress(token) {
    if (token && token !== this.progressToken) return;
    if (this.progressTimer) clearInterval(this.progressTimer);
    this.progressTimer = null;
    this.progressToken = "";
    this.progressPhase = "";
    if (!this.pageDestroyed && this.data.progressTask)
      this.setData({ progressTask: "", ...progressPatch(0) });
  },

  async completeProgress(token) {
    if (this.pageDestroyed || token !== this.progressToken) return false;
    if (this.progressTimer) clearInterval(this.progressTimer);
    this.progressTimer = null;
    if (!this.data.progressTask) return false;
    // 后端本地响应很快，完成动画只做短暂定格，避免人为拉长等待感。
    await new Promise((resolve) =>
      this.setData(progressPatch(100), () => setTimeout(resolve, 140)),
    );
    if (this.pageDestroyed || token !== this.progressToken) return false;
    this.clearProgress(token);
    return true;
  },

  syncProject(project) {
    this.setData({ project, summary: projectSummary(project) });
  },

  persist(project) {
    this.syncProject(saveProject(project));
  },

  updateSlab(event) {
    const { index, field } = event.currentTarget.dataset;
    const slabs = this.data.project.slabs.map((item, i) =>
      i === Number(index)
        ? { ...item, [field]: numberValue(event.detail.value) }
        : item,
    );
    this.persist({ ...this.data.project, slabs });
  },

  updateSlabLimit(event) {
    const index = Number(event.currentTarget.dataset.index);
    const selected = Number(event.detail.value);
    const slabs = this.data.project.slabs.map((item, i) =>
      i === index ? { ...item, limit: selected === 0 ? null : selected } : item,
    );
    this.persist({ ...this.data.project, slabs });
  },

  addSlab() {
    this.persist({
      ...this.data.project,
      slabs: [
        ...this.data.project.slabs,
        { id: "", w: 2400, h: 1600, limit: null },
      ],
    });
  },

  removeSlab(event) {
    if (this.data.project.slabs.length <= 1) {
      wx.showToast({ title: "至少保留一张大板", icon: "none" });
      return;
    }
    const index = Number(event.currentTarget.dataset.index);
    this.persist({
      ...this.data.project,
      slabs: this.data.project.slabs.filter((_, i) => i !== index),
    });
  },

  updatePart(event) {
    const { index, field } = event.currentTarget.dataset;
    const parts = this.data.project.parts.map((item, i) =>
      i === Number(index)
        ? { ...item, [field]: numberValue(event.detail.value) }
        : item,
    );
    this.persist({ ...this.data.project, parts });
  },

  addPart() {
    this.persist({
      ...this.data.project,
      parts: [
        ...this.data.project.parts,
        { id: "", w: 0, h: 0, qty: 1, rotatable: true },
      ],
    });
  },

  removePart(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.persist({
      ...this.data.project,
      parts: this.data.project.parts.filter((_, i) => i !== index),
    });
  },

  resetDefault() {
    wx.showModal({
      title: "恢复默认数据？",
      content: "当前录入内容会被替换。",
      confirmColor: "#173e38",
      success: (res) => {
        if (res.confirm) this.persist(defaultProject());
      },
    });
  },

  resetPartsDefault() {
    wx.showModal({
      title: "恢复小料默认？",
      content: "当前小料清单会被替换，大板设置不会改变。",
      confirmColor: "#173e38",
      success: (res) => {
        if (!res.confirm) return;
        const defaults = defaultProject();
        this.persist({ ...this.data.project, parts: defaults.parts });
      },
    });
  },

  chooseExcel() {
    if (this.isBusy() || !this.lockBusy()) return;
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["xlsx"],
      success: async (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) {
          this.unlockBusy();
          return;
        }
        this.setData({ importing: true });
        const progressToken = this.beginProgress("import");
        let cloudFileID = "";
        try {
          let result;
          if (getApp().globalData.useCloudContainer) {
            const uploaded = await uploadCloudFile(
              file.path,
              "imports",
              (value) => this.updateUploadProgress(progressToken, value),
            );
            cloudFileID = uploaded.fileID;
            const url = await getCloudTempUrl(cloudFileID);
            this.beginRequestProgress(progressToken);
            result = await requestJson("/api/import-url", {
              method: "POST",
              data: { url },
            });
          } else {
            const buffer = await readLocalFile(file.path);
            this.beginRequestProgress(progressToken, 18);
            result = await requestBinary("/api/import", buffer);
          }
          if (!Array.isArray(result.parts) || !result.parts.length)
            throw new Error("表格中没有有效的小料");
          this.persist({ ...this.data.project, parts: result.parts });
          if (!(await this.completeProgress(progressToken))) return;
          wx.showToast({
            title: `已导入 ${result.parts.length} 种规格`,
            icon: "success",
          });
        } catch (error) {
          this.clearProgress(progressToken);
          if (!this.pageDestroyed)
            wx.showModal({
              title: "导入失败",
              content: userMessage(error, "无法读取表格"),
              showCancel: false,
            });
        } finally {
          await deleteCloudFile(cloudFileID);
          if (!this.pageDestroyed) this.setData({ importing: false });
          this.unlockBusy();
        }
      },
      fail: (error) => {
        this.unlockBusy();
        if (error && error.errMsg && !error.errMsg.includes("cancel")) {
          wx.showToast({ title: "请在真机选择 .xlsx 文件", icon: "none" });
        }
      },
    });
  },

  choosePhoto() {
    if (this.isBusy() || !this.lockBusy()) return;
    wx.showActionSheet({
      itemList: ["毫米（mm）", "厘米（cm）"],
      success: (choice) =>
        this.choosePhotoWithUnit(choice.tapIndex === 1 ? "cm" : "mm"),
      fail: () => this.unlockBusy(),
    });
  },

  choosePhotoWithUnit(unit) {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["camera", "album"],
      success: async (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) {
          this.unlockBusy();
          return;
        }
        this.setData({ ocrBusy: true });
        const progressToken = this.beginProgress("ocr");
        let cloudFileID = "";
        try {
          let imagePath = file.tempFilePath;
          try {
            const compressed = await new Promise((resolve, reject) =>
              wx.compressImage({
                src: imagePath,
                quality: 85,
                success: resolve,
                fail: reject,
              }),
            );
            imagePath = compressed.tempFilePath || imagePath;
          } catch {
            /* 部分开发者工具不支持压缩，继续使用原图 */
          }
          let result;
          if (getApp().globalData.useCloudContainer) {
            const uploaded = await uploadCloudFile(imagePath, "ocr", (value) =>
              this.updateUploadProgress(progressToken, value),
            );
            cloudFileID = uploaded.fileID;
            const url = await getCloudTempUrl(cloudFileID);
            this.beginRequestProgress(progressToken);
            result = await requestJson("/api/ocr/photo-url", {
              method: "POST",
              data: { url, unit },
              timeout: 60000,
            });
          } else {
            const imageInfo = await new Promise((resolve, reject) =>
              wx.getImageInfo({
                src: imagePath,
                success: resolve,
                fail: reject,
              }),
            );
            const type = String(
              imageInfo.type ||
                imagePath.match(/\.([a-z0-9]+)$/i)?.[1] ||
                "jpeg",
            ).toLowerCase();
            const mime = type === "jpg" ? "jpeg" : type;
            const base64 = await readLocalFile(imagePath, "base64");
            const image = `data:image/${mime};base64,${base64}`;
            this.beginRequestProgress(progressToken, 18);
            result = await requestJson("/api/ocr/photo", {
              method: "POST",
              data: { image, unit },
              timeout: 60000,
            });
          }
          if (!Array.isArray(result.parts) || !result.parts.length)
            throw new Error("没有识别出有效尺寸，请换一张清晰照片");
          const app = getApp();
          app.globalData.ocrDraft = {
            imagePath,
            text: result.text || "",
            unit,
            parts: result.parts,
          };
          if (!(await this.completeProgress(progressToken))) return;
          wx.navigateTo({ url: "/pages/ocr-review/ocr-review" });
        } catch (error) {
          this.clearProgress(progressToken);
          if (!this.pageDestroyed)
            wx.showModal({
              title: "识别失败",
              content: userMessage(error, "请稍后重试"),
              showCancel: false,
            });
        } finally {
          await deleteCloudFile(cloudFileID);
          if (!this.pageDestroyed) this.setData({ ocrBusy: false });
          this.unlockBusy();
        }
      },
      fail: (error) => {
        this.unlockBusy();
        if (error && error.errMsg && !error.errMsg.includes("cancel")) {
          wx.showToast({ title: "请在真机使用相机或相册", icon: "none" });
        }
      },
    });
  },

  async handleSolve() {
    if (this.isBusy() || !this.lockBusy()) return;
    const { slabs, parts } = this.data.project;
    const invalidSlab = slabs.find(
      (item) =>
        !Number.isInteger(item.w) ||
        item.w <= 0 ||
        !Number.isInteger(item.h) ||
        item.h <= 0,
    );
    const invalidPart = parts.find(
      (item) =>
        !Number.isInteger(item.w) ||
        item.w <= 0 ||
        !Number.isInteger(item.h) ||
        item.h <= 0 ||
        !Number.isInteger(item.qty) ||
        item.qty <= 0,
    );
    if (invalidSlab) {
      this.unlockBusy();
      wx.showToast({ title: "请填写正确的大板尺寸", icon: "none" });
      return;
    }
    if (invalidPart) {
      this.unlockBusy();
      wx.showToast({ title: "请填写正确的小料尺寸和数量", icon: "none" });
      return;
    }
    if (!parts.length) {
      this.unlockBusy();
      wx.showToast({ title: "请至少添加一条小料", icon: "none" });
      return;
    }
    this.setData({ solving: true });
    const progressToken = this.beginProgress("standard");
    this.beginRequestProgress(progressToken, 18);
    try {
      const response = await requestJson("/api/solve", {
        method: "POST",
        data: { settings: { slabs }, parts },
        timeout: 90000,
      });
      if (
        !response.result ||
        !response.result.plans ||
        !response.result.plans.A
      )
        throw new Error("排版服务返回结果为空");
      getApp().globalData.latestResult = response.result;
      if (!(await this.completeProgress(progressToken))) return;
      wx.navigateTo({ url: "/pages/result/result" });
    } catch (error) {
      this.clearProgress(progressToken);
      if (!this.pageDestroyed)
        wx.showModal({
          title: "排版失败",
          content: userMessage(error, "请检查网络后重试"),
          showCancel: false,
        });
    } finally {
      if (!this.pageDestroyed) this.setData({ solving: false });
      this.unlockBusy();
    }
  },

  /* ======================================================== 视频去水印 */

  beginParseProgress(task, title, message) {
    if (this.parseProgressTimer) clearInterval(this.parseProgressTimer);
    this.setData({
      videoProgressTask: task,
      videoProgressTitle: title,
      videoProgressMessage: message,
      ...videoProgressPatch(0),
    });
    this.parseProgressTimer = setInterval(() => {
      const active =
        task === "video" ? this.data.parsing : this.data.transcribing;
      if (this.pageDestroyed || !active || this.data.videoProgressTask !== task)
        return;
      const current = Number(this.data.videoProgress) || 0;
      if (current >= 94) return;
      this.setData(
        videoProgressPatch(Math.min(94, current + (current < 40 ? 4 : 2))),
      );
    }, 360);
  },

  async completeParseProgress() {
    if (this.parseProgressTimer) clearInterval(this.parseProgressTimer);
    this.parseProgressTimer = null;
    if (this.pageDestroyed) return false;
    await new Promise((resolve) =>
      this.setData(videoProgressPatch(100), () => setTimeout(resolve, 320)),
    );
    return !this.pageDestroyed;
  },

  updateLink(event) {
    this.setData({
      link: event.detail.value,
      result: null,
      mediaToken: "",
      videoUrl: "",
      transcript: "",
      transcriptStatus: "",
      transcriptError: "",
      transcriptRequested: false,
      transcriptExpanded: false,
      transcriptCanExpand: false,
    });
  },

  changePlatform(event) {
    const index = Math.max(
      0,
      Math.min(VIDEO_PLATFORMS.length - 1, Number(event.detail.value) || 0),
    );
    const selected = VIDEO_PLATFORMS[index];
    this.setData({
      platformIndex: index,
      platform: selected.value,
      platformLabel: selected.label,
      inputTitle: selected.inputTitle,
      inputPlaceholder: selected.placeholder,
      link: "",
      result: null,
      mediaToken: "",
      videoUrl: "",
      transcript: "",
      transcriptStatus: "",
      transcriptError: "",
      transcriptRequested: false,
      transcriptExpanded: false,
      transcriptCanExpand: false,
    });
  },

  async waitForTranscript(token) {
    if (!token)
      return {
        status: "failed",
        transcript: "",
        error: "视频语音转写任务未创建",
      };
    this.setData({ videoProgressMessage: "正在识别视频语音…" });
    for (let attempt = 0; attempt < 90; attempt += 1) {
      if (this.pageDestroyed) return { status: "cancelled", transcript: "" };
      const state = await requestJson(
        `/api/video/transcript?token=${encodeURIComponent(token)}`,
        { timeout: 35000 },
      );
      if (state && state.status === "succeeded") {
        return {
          status: "succeeded",
          transcript: String(state.transcript || "").trim(),
        };
      }
      if (state && state.status === "failed") return state;
      await wait(1000);
    }
    return {
      status: "failed",
      transcript: "",
      error: "语音识别耗时较长，请稍后重新解析",
    };
  },

  async parseVideo() {
    const link = String(this.data.link || "").trim();
    if (!link) {
      wx.showToast({
        title: `请先输入${this.data.platformLabel}视频信息`,
        icon: "none",
      });
      return;
    }
    if (this.data.parsing || this.data.transcribing || this.data.saving) return;
    this.setData({
      parsing: true,
      result: null,
      mediaToken: "",
      videoUrl: "",
    });
    this.beginParseProgress("video", "解析视频", "正在获取无水印视频…");
    try {
      const result = await requestJson("/api/video/watermark", {
        method: "POST",
        data: { platform: this.data.platform, url: link },
        timeout: 70000,
      });
      if (
        !result ||
        typeof result.downloadPath !== "string" ||
        !result.downloadPath.startsWith("/api/video/download.mp4?token=")
      ) {
        throw new Error("视频解析结果无效");
      }
      const baseUrl = publicApiBaseUrl();
      if (!baseUrl) throw new Error("视频下载服务尚未配置");
      if (!(await this.completeParseProgress())) return;
      this.setData({
        result,
        mediaToken: String(result.mediaToken || ""),
        videoUrl: `${baseUrl}${result.downloadPath}`,
      });
    } catch (error) {
      wx.showModal({
        title: "解析失败",
        content: userMessage(error, "请检查链接后重试"),
        showCancel: false,
      });
    } finally {
      if (this.parseProgressTimer) clearInterval(this.parseProgressTimer);
      this.parseProgressTimer = null;
      if (!this.pageDestroyed)
        this.setData({
          parsing: false,
          videoProgressTask: "",
          videoProgressTitle: "",
          videoProgressMessage: "",
          ...videoProgressPatch(0),
        });
    }
  },

  async parseTranscript() {
    const link = String(this.data.link || "").trim();
    if (!link) {
      wx.showToast({
        title: `请先输入${this.data.platformLabel}视频信息`,
        icon: "none",
      });
      return;
    }
    if (this.data.parsing || this.data.transcribing || this.data.saving) return;
    this.setData({
      transcribing: true,
      transcript: "",
      transcriptStatus: "pending",
      transcriptError: "",
      transcriptRequested: true,
      transcriptExpanded: false,
      transcriptCanExpand: false,
    });
    this.beginParseProgress("transcript", "解析文案", "正在提交语音识别…");
    try {
      const requestData = { platform: this.data.platform, url: link };
      if (this.data.mediaToken) requestData.mediaToken = this.data.mediaToken;
      const started = await requestJson("/api/video/transcript", {
        method: "POST",
        data: requestData,
        timeout: this.data.platform === "wechat_channels" ? 360000 : 70000,
      });
      if (started && started.mediaToken)
        this.setData({ mediaToken: String(started.mediaToken) });
      const transcriptState = await this.waitForTranscript(
        started && started.transcriptToken,
      );
      if (!(await this.completeParseProgress())) return;
      const transcript = String(transcriptState.transcript || "").trim();
      this.setData({
        transcript,
        transcriptStatus: transcriptState.status,
        transcriptError: transcriptState.error || "",
        transcriptExpanded: false,
        transcriptCanExpand: transcript.length > 160,
      });
    } catch (error) {
      const message = userMessage(error, "请检查链接后重试");
      this.setData({ transcriptStatus: "failed", transcriptError: message });
      wx.showModal({
        title: "文案解析失败",
        content: message,
        showCancel: false,
      });
    } finally {
      if (this.parseProgressTimer) clearInterval(this.parseProgressTimer);
      this.parseProgressTimer = null;
      if (!this.pageDestroyed)
        this.setData({
          transcribing: false,
          videoProgressTask: "",
          videoProgressTitle: "",
          videoProgressMessage: "",
          ...videoProgressPatch(0),
        });
    }
  },

  saveVideo() {
    if (
      !this.data.videoUrl ||
      this.data.saving ||
      this.data.parsing ||
      this.data.transcribing
    )
      return;
    this.setData({
      saving: true,
      videoProgressTask: "save",
      videoProgressTitle: "保存视频",
      ...videoProgressPatch(1),
    });
    const downloadTask = wx.downloadFile({
      url: this.data.videoUrl,
      timeout: 180000,
      success: (download) => {
        if (download.statusCode !== 200 || !download.tempFilePath) {
          this.setData({
            saving: false,
            videoProgressTask: "",
            ...videoProgressPatch(0),
          });
          wx.showToast({ title: "视频下载失败", icon: "none" });
          return;
        }
        this.setData(videoProgressPatch(96));
        const filePath = `${wx.env.USER_DATA_PATH}/baosong-video-${Date.now()}.mp4`;
        const fileSystem = wx.getFileSystemManager();
        fileSystem.copyFile({
          srcPath: download.tempFilePath,
          destPath: filePath,
          success: () => {
            this.setData(videoProgressPatch(98));
            wx.saveVideoToPhotosAlbum({
              filePath,
              success: () => {
                this.setData(videoProgressPatch(100));
                wx.showToast({ title: "已保存到相册", icon: "success" });
              },
              fail: (error) =>
                wx.showModal({
                  title: "保存失败",
                  content: userMessage(error, "请允许访问相册后重试"),
                  showCancel: false,
                }),
              complete: () => {
                fileSystem.unlink({ filePath, fail: () => {} });
                setTimeout(
                  () =>
                    this.setData({
                      saving: false,
                      videoProgressTask: "",
                      videoProgressTitle: "",
                      ...videoProgressPatch(0),
                    }),
                  320,
                );
              },
            });
          },
          fail: (error) => {
            this.setData({
              saving: false,
              videoProgressTask: "",
              ...videoProgressPatch(0),
            });
            wx.showModal({
              title: "保存失败",
              content: userMessage(error, "无法生成 MP4 文件，请稍后重试"),
              showCancel: false,
            });
          },
        });
      },
      fail: (error) => {
        this.setData({
          saving: false,
          videoProgressTask: "",
          ...videoProgressPatch(0),
        });
        wx.showModal({
          title: "下载失败",
          content: error.errMsg || "请稍后重试",
          showCancel: false,
        });
      },
    });
    if (downloadTask && typeof downloadTask.onProgressUpdate === "function") {
      downloadTask.onProgressUpdate(({ progress }) => {
        const mapped = Math.max(
          1,
          Math.min(95, Math.round(Number(progress) || 0)),
        );
        if (mapped > this.data.videoProgress)
          this.setData(videoProgressPatch(mapped));
      });
    }
  },

  copyCaption() {
    const transcript = String(this.data.transcript || "").trim();
    if (!transcript) {
      wx.showToast({ title: "没有可复制的语音文案", icon: "none" });
      return;
    }
    wx.setClipboardData({ data: transcript });
  },

  toggleTranscript() {
    if (!this.data.transcriptCanExpand) return;
    this.setData({ transcriptExpanded: !this.data.transcriptExpanded });
  },
});
