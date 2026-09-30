/**
 * 天地图密钥的本地存取
 * =====================
 *
 * ## 为什么密钥不能写死在代码里
 *
 * 影像底图来自天地图，需要一份 tk 密钥。密钥**不能随包分发**：
 *   · 明文密钥会被抓包、会被盗用；
 *   · 一个密钥给所有学校用，配额很快被跑光，也没法追责；
 *   · 各校应该用各自申请的密钥。
 *
 * 所以设计成：**代码里只有占位符**（见 `basemap.ts` 的 `{tk}`），
 * 密钥由老师在界面上填一次，存在 **localStorage**（只在本机浏览器）。
 *
 * ## 为什么不上传、不用 cookie
 *
 * 上传密钥等于把"不能写进代码"的规则绕过去了；cookie 会随请求自动带上，
 * 反而增加泄漏面。localStorage 只在同源页面可读，够用且最小。
 *
 * ## 没填 / 没网会怎样
 *
 * **不影响游戏**：底图自动回退成内置的矢量陆地轮廓（真实海岸线，
 * 来自 Natural Earth，随包离线可用），洋流照常显示。
 * 影像只是"更好看、更真实"，不是玩法必需。
 */

const TK_STORAGE = "eduplay.fish_master.tianditu_tk";

/** 读取已保存的密钥（空串 = 没有）。 */
export function loadKey(): string {
  try {
    return window.localStorage.getItem(TK_STORAGE) ?? "";
  } catch {
    // 隐私模式 / 禁用存储：静默降级，不回退成报错
    return "";
  }
}

/** 保存密钥。传空串 = 清除（回到矢量底图）。 */
export function saveKey(tk: string): void {
  try {
    const v = tk.trim();
    if (v) window.localStorage.setItem(TK_STORAGE, v);
    else window.localStorage.removeItem(TK_STORAGE);
  } catch {
    // 存不进去也不该崩（比如无痕模式）；只是这次会话用不了影像
  }
}

export { TK_STORAGE };
