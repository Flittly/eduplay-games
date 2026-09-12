# 地貌人格测试（landform_quiz）

答 15 道题，用「地貌的五个属性 ↔ 人格的五个侧面」做映射，从 40 处真实地貌（国内 20 + 国外 20）
里找出与你的性格最接近的那一处；结果页左侧给出该地貌的定位、定义、特点与成因，
并用一张合规底图的微缩地图用红点标出它在哪里，右侧展示它的真实照片。

## 目录结构

```
landform-quiz/
├── public/                         ← 原样拷贝进 web/，运行时可改，不必重新构建
│   ├── data/
│   │   ├── landforms.json          地貌数据（40 条，可随意增删）
│   │   └── questions.json          题目数据（15 题）
│   ├── assets/
│   │   ├── landforms/<id>.jpg      每个地貌的真实照片，按 id 命名
│   │   └── maps/
│   │       ├── china.json          中国微缩地图（合规数据，含台湾省/港澳/南海断续线）
│   │       └── world.json          世界微缩地图（陆地掩膜 + 国家标准中国边界）
│   └── cover.svg                   商城封面
├── scripts/
│   ├── fetch_photos.py             批量采集真实照片（360 图片为主源、百度图片为备源）
│   └── prepare_maps.py             生成合规微缩地图数据（带抽稀与投影）
└── src/                            React 源码
```

## 一、数据结构

### 1. `public/data/landforms.json`

```jsonc
{
  "dimensions": [ /* 五个人格维度定义，见下 */ ],
  "landforms": [
    {
      "id": "taklamakan",                  // 唯一标识，也是照片文件名
      "name": "塔克拉玛干沙漠",
      "en": "Taklamakan Desert",
      "category": "domestic",              // domestic = 中国，international = 国外
      "type": "沙漠",                       // 地貌类型，结果页会做成徽章
      "country": "中国",
      "region": "新疆 · 塔里木盆地",
      "lat": 39.0,                         // WGS84，北正南负
      "lon": 83.0,                         // WGS84，东正西负
      "photo": "./assets/landforms/taklamakan.jpg",   // 相对路径，指向 web 根
      "photoSource": "https://…",          // 图片来源，脚本自动回写，可留空
      "summary": "中国最大的沙漠，世界第二大流动沙漠",  // 照片下面的一句话
      "intro": "这是什么（2~3 句）",
      "traits": ["特点一", "特点二", "特点三", "特点四"],
      "cause": "它是怎么形成的",
      "personality": "为什么说你像它（性格解读）",
      "profile": { "thermal": 92, "relief": 30, "hardness": 26, "dynamics": 48, "moisture": 3 }
    }
  ]
}
```

### 2. 五个人格维度（`dimensions`）

| key | 名称 | 0 端 | 100 端 | 对应的地貌属性 |
|---|---|---|---|---|
| `thermal` | 温度 | 冷静内敛 | 炽热张扬 | 气候冷暖 |
| `relief` | 起伏 | 平和低调 | 高远出众 | 海拔与高差 |
| `hardness` | 质地 | 柔韧随和 | 刚强棱角 | 岩性软硬 |
| `dynamics` | 动态 | 沉静恒定 | 激荡多变 | 地质作用的剧烈程度 |
| `moisture` | 水意 | 独立自持 | 丰富亲和 | 干湿程度 |

### 3. `public/data/questions.json`

每题绑定 1~2 个维度，选项用 `delta` 给出加减分：

```jsonc
{
  "id": "q1",
  "text": "周五放学，同学临时喊你出去玩，你的第一反应是——",
  "options": [
    { "label": "走！顺便再多叫几个人，越热闹越好", "delta": { "thermal": 2, "dynamics": 1 } },
    { "label": "先问清楚去哪儿、还有谁，再决定去不去", "delta": { "thermal": -1, "hardness": 1 } },
    { "label": "算了，我更想按原来的计划做自己的事", "delta": { "thermal": -2, "dynamics": -1 } }
  ]
}
```

**不需要手工维护权重**：程序会把「每道题在每个维度上可达到的最大绝对值」累加作为分母，
把总分归一到 0–100，所以增删题目、调整分值都不会让某个人格维度失衡。

匹配算法：把用户画像与每个地貌的 `profile` 做五维欧氏距离，最近的那个就是结果；
匹配度 = `1 − 距离 / (√5 × 100)`。

## 二、怎么加一个新地貌（不用改代码、不用重新构建）

1. 把照片裁成 16:10、宽约 900px，命名成 `<id>.jpg`，放进 `public/assets/landforms/`。
2. 在 `landforms.json` 的 `landforms` 数组里追加一条，`id` 与照片文件名一致，
   `photo` 写 `./assets/landforms/<id>.jpg`，`profile` 给五个 0–100 的整数。
3. 刷新页面即可，新地貌自动进入匹配池与图鉴。

也可以直接跑脚本自动抓图：

```bash
python scripts/fetch_photos.py                 # 补齐缺失的照片
python scripts/fetch_photos.py --force         # 全部重抓
python scripts/fetch_photos.py --only=sahara   # 只重抓指定地貌
python scripts/fetch_photos.py --sheet         # 顺便生成拼版缩略图 montage.jpg 供人工复核
```

脚本按「360 图片接口（主源，无需 cookie）→ 百度图片接口（备源，需 cookie 预热）」的顺序取候选，
用关键词表（`KEYWORDS`）过滤掉无关图片，并排除 AI 生成图、商业图库水印图、"比大小"类凑数图；
候选按「关键词命中 > 横构图 > 大尺寸」排序，统一裁 16:10、压到 900px 宽后原子写入目标目录。
`--sheet` 生成的 `montage.jpg` 请务必逐格目视复核——"下载成功"不等于"内容对"。

## 三、地图数据

```bash
python scripts/prepare_maps.py
```

* **中国图**：国界 + 省界 + 南海断续线，来自阿里云 DataV（高德地图底图数据），
  含台湾省、香港特别行政区、澳门特别行政区及南海诸岛；采用兰伯特等角圆锥投影
  （标准纬线 25°N / 47°N，中央经线 105°E），与国内标准地图一致。
* **世界图**：陆地掩膜取自 Natural Earth 110m land（公有领域，**只有海陆之分、不含任何国界**），
  再叠加按国家标准绘制的中国边界；采用等距圆柱投影，纬度裁剪到 [−58°, 84°]（不含南极洲）。

脚本会在服务端完成投影与道格拉斯-普克抽稀，只输出「投影参数 + SVG path」，
运行时不再解析 GeoJSON。前端用 `src/logic.ts` 里同样的投影公式把经纬度换算成红点位置。

## 四、构建

```bash
npm install
npm run build        # tsc --noEmit && vite build，产物在 dist/web/
```
