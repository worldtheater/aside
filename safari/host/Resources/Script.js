const copy = {
  en: {
    name: "Aside for Safari",
    on: "Aside is enabled in Safari.",
    off: "Enable Aside in Safari Settings → Extensions.",
    settings: "Open Safari Settings",
    guide:
      "Then open Aside from the Safari toolbar. On macOS 26+, choose Browser on-device for Apple translation, or connect your model service. Requires Safari 26 or later.",
    local:
      "Settings stay on this Mac. Cross-device configuration sync is not available in Safari.",
    error: "Open Safari → Settings → Extensions manually to enable Aside.",
  },
  zh: {
    name: "旁白 · Safari",
    on: "旁白已在 Safari 中启用。",
    off: "在 Safari 的「设置 → 扩展」中启用旁白。",
    settings: "打开 Safari 设置",
    guide:
      "启用后，从 Safari 工具栏打开旁白。macOS 26 及以上可选择“浏览器本地翻译”使用苹果翻译，也可添加模型连接。需要 Safari 26 或更新版本。",
    local: "配置保存在这台 Mac 上。Safari 版暂不支持跨设备同步。",
    error: "请手动打开 Safari → 设置 → 扩展，启用旁白。",
  },
};
const language = navigator.language.startsWith("zh") ? "zh" : "en";
const C = copy[language];
document.documentElement.lang = language === "zh" ? "zh-Hans" : "en";
document.querySelector("h1").textContent = C.name;
document.querySelector("#status").textContent = C.off;
document.querySelector("#settings").textContent = C.settings;
document.querySelector("#guide").textContent = C.guide;
document.querySelector("#local-only").textContent = C.local;
function show(enabled) {
  document.querySelector("#status").textContent = enabled ? C.on : C.off;
}
function showSettingsError() {
  document.querySelector("#status").textContent = C.error;
}
document.querySelector("#settings").addEventListener("click", () => {
  webkit.messageHandlers.controller.postMessage("open-preferences");
});
