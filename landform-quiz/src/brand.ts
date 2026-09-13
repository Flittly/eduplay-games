/** 制作者信息 —— 唯一来源，页面页脚与「导出结果长图」都从这里取，避免两处不一致 */
export const BRAND = {
  game: "地貌人格测试",
  tagline: "15 道题，看看你的性格像地球上哪一种地貌",
  maker: "奇偶瓜肥实验室",
  /** 二维码（由用户提供的小红书名片裁切而来，见 scripts/make_qr_asset.py） */
  qr: "./assets/brand/qr.png",
  /** 小红书号，印在二维码名片上 */
  xiaohongshu: "11594871358",
  year: 2026,
  rights: "版权所有",
  /** 页脚/长图底部的数据说明 */
  notice:
    "地貌数据与照片逐条整理自公开资料（图片来源见各条目）；地图底图为合规数据源：中国边界取自阿里云 DataV，世界陆地掩膜取自 Natural Earth。仅用于教学演示。"
} as const;

export const BRAND_LINE = `© ${BRAND.year} ${BRAND.maker} ${BRAND.rights}`;
