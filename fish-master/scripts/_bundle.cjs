Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/data.ts
/**
* ① 重点层：教材「按顺序熟记四个闭合环流 + 一条环球漂流」。
* ⚠️ 西风漂流在三个环流里都出现，但它是**同一条流**，所以此处只列一次。
*/
const CORE_CURRENTS = [
	"北赤道暖流",
	"日本暖流",
	"北太平洋暖流",
	"加利福尼亚寒流",
	"南赤道暖流",
	"东澳大利亚暖流",
	"西风漂流",
	"秘鲁寒流",
	"墨西哥湾暖流",
	"北大西洋暖流",
	"加那利寒流",
	"巴西暖流",
	"本格拉寒流",
	"厄加勒斯暖流",
	"西澳大利亚寒流",
	"北印度洋季风洋流",
	"千岛寒流",
	"拉布拉多寒流"
];
/**
* ② 拓展层：教材体系外、但图 4-24 上标了箭头的真实洋流。
* **只认名称，不判方向**（判定深度差异是分层最关键的一条）。
*/
const EXTENSION_CURRENTS = [
	"阿拉斯加暖流",
	"赤道逆流",
	"东格陵兰寒流",
	"索马里寒流",
	"莫桑比克暖流",
	"北冰洋南下冷水"
];
/**
* ③ 了解层：教材「影响」部分点名过的**用法**。
*
* ⚠️ 重要：这些洋流**本体已经在重点层**（北大西洋暖流 / 秘鲁寒流 / 西澳大利亚寒流）。
* 本层登记的是它们作为「影响例证」的那一面——比如"北大西洋暖流使摩尔曼斯克终年不冻"。
* 所以：
*   - 它**不与重点层互斥**，是"同一条流的另一个知识侧面"；
*   - 不设独立捕捞区、不作判定，只进解释卡文字。
* `assertTiering` 的互斥规则会**豁免本层**（见函数内注释）。
*/
const REFERENCE_CURRENTS = [
	"北大西洋暖流",
	"秘鲁寒流",
	"西澳大利亚寒流"
];
/** 品质由成因决定。这张表是**规则**，不是配置，改它要有教材依据。 */
const QUALITY_RULES = {
	/** 上升补偿流：离岸风把表层水吹走，深层冷水上涌，营养盐极丰富。 */
	upwelling: 5,
	/** 寒暖流交汇：海水受扰动上泛，饵料丰富。 */
	convergence: 4,
	/** 大陆架宽广 / 中低纬：光照充足、饵料一般。 */
	shelf: 3,
	/** 大洋环流中部：饵料稀少。 */
	gyre: 2,
	/** 无鱼：环流中心"海洋荒漠"、冰封海域。 */
	barren: 1
};
/**
* 洋流总表。排列顺序＝图鉴顺序＝地理上由北向南、由西向东的直觉顺序。
*
* ⚠️ 每条都必须出现在上面三份名单之一，且**只出现一次**——`assertTiering()` 会查。
*/
const CURRENTS = [
	{
		id: "kuroshio",
		name: "日本暖流",
		tier: "core",
		kind: "warm",
		hemisphere: "N",
		ocean: "pacific",
		flowText: "自南向北 · 沿日本列岛东侧北上",
		direction: "pole-ward",
		quality: 4,
		fish: [
			{
				name: "鲭鱼",
				icon: "mackerel"
			},
			{
				name: "金枪鱼",
				icon: "tuna"
			},
			{
				name: "秋刀鱼",
				icon: "saury"
			}
		],
		reason: "与千岛寒流在北海道附近交汇：冷暖水相遇使海水受扰动上泛，饵料丰富，形成北海道渔场。",
		anchor: {
			lon: 138,
			lat: 28
		},
		arrow: {
			lon1: 130,
			lat1: 22,
			lon2: 148,
			lat2: 36
		},
		note: "① 重点层 · 教材图 4-24 北太平洋环流成员，别名「黑潮」。"
	},
	{
		id: "oyashio",
		name: "千岛寒流",
		tier: "core",
		kind: "cold",
		hemisphere: "N",
		ocean: "pacific",
		flowText: "自北向南 · 由千岛群岛南下",
		direction: "equator-ward",
		quality: 4,
		fish: [{
			name: "鲑鱼",
			icon: "salmon"
		}, {
			name: "鳕鱼",
			icon: "cod"
		}],
		reason: "与日本暖流交汇形成北海道渔场——本游戏里它只作为「交汇的另一方」出现，学生看图时应与日本暖流一起记。",
		anchor: {
			lon: 152,
			lat: 44
		},
		arrow: {
			lon1: 160,
			lat1: 50,
			lon2: 147,
			lat2: 39
		},
		note: "① 重点层 · 教材在「渔场成因」里点名（『日本暖流及千岛寒流交汇』），别名「亲潮」。"
	},
	{
		id: "north-pacific",
		name: "北太平洋暖流",
		tier: "core",
		kind: "warm",
		hemisphere: "N",
		ocean: "pacific",
		flowText: "自西向东 · 北纬 40° 附近横渡太平洋",
		direction: "west-to-east",
		quality: 3,
		fish: [{
			name: "金枪鱼",
			icon: "tuna"
		}, {
			name: "剑鱼",
			icon: "swordfish"
		}],
		reason: "中纬西风带推动，饵料一般；它把暖水从日本一带输送到北美西岸。",
		anchor: {
			lon: -170,
			lat: 40
		},
		arrow: {
			lon1: 150,
			lat1: 40,
			lon2: -130,
			lat2: 44
		},
		note: "① 重点层 · 教材图 4-24 北太平洋环流成员。"
	},
	{
		id: "california",
		name: "加利福尼亚寒流",
		tier: "core",
		kind: "cold",
		hemisphere: "N",
		ocean: "pacific",
		flowText: "自北向南 · 沿北美西岸南下",
		direction: "equator-ward",
		quality: 3,
		fish: [{
			name: "沙丁鱼",
			icon: "sardine"
		}, {
			name: "鲱鱼",
			icon: "herring"
		}],
		reason: "北美西岸有上升流，但规模明显小于秘鲁寒流，所以品质是 3 星而不是 5 星。",
		anchor: {
			lon: -128,
			lat: 34
		},
		arrow: {
			lon1: -125,
			lat1: 44,
			lon2: -133,
			lat2: 26
		},
		note: "① 重点层 · 教材图 4-24 北太平洋环流成员。"
	},
	{
		id: "east-australia",
		name: "东澳大利亚暖流",
		tier: "core",
		kind: "warm",
		hemisphere: "S",
		ocean: "pacific",
		flowText: "自北向南 · 沿澳大利亚东岸南下",
		direction: "pole-ward",
		quality: 3,
		fish: [{
			name: "鲭鱼",
			icon: "mackerel"
		}, {
			name: "金枪鱼",
			icon: "tuna"
		}],
		reason: "暖流，没有寒暖流交汇条件，也不在显著上升流区，所以品质中等。",
		anchor: {
			lon: 154,
			lat: -30
		},
		arrow: {
			lon1: 150,
			lat1: -20,
			lon2: 155,
			lat2: -38
		},
		note: "① 重点层 · 教材图 4-24 南太平洋环流成员。"
	},
	{
		id: "peru",
		name: "秘鲁寒流",
		tier: "core",
		kind: "cold",
		hemisphere: "S",
		ocean: "pacific",
		flowText: "自南向北 · 沿南美西岸北上",
		direction: "equator-ward",
		quality: 5,
		fish: [{
			name: "鳀鱼",
			icon: "anchovy"
		}, {
			name: "鲣鱼",
			icon: "bonito"
		}],
		reason: "上升补偿流：东南信风把表层海水吹离海岸，深层冷水带着营养盐上涌，饵料极丰富，形成秘鲁渔场。注意它是寒流却渔获最高。",
		anchor: {
			lon: -80,
			lat: -18
		},
		arrow: {
			lon1: -76,
			lat1: -38,
			lon2: -82,
			lat2: -8
		},
		note: "① 重点层 · 教材图 4-24 南太平洋环流成员；也是全游戏品质天花板（★×5）。"
	},
	{
		id: "gulf-stream",
		name: "墨西哥湾暖流",
		tier: "core",
		kind: "warm",
		hemisphere: "N",
		ocean: "atlantic",
		flowText: "自南向北 · 沿北美东岸北上",
		direction: "pole-ward",
		quality: 4,
		fish: [{
			name: "鳕鱼",
			icon: "cod"
		}, {
			name: "鲱鱼",
			icon: "herring"
		}],
		reason: "与拉布拉多寒流交汇形成纽芬兰渔场——冷暖水相遇使海水受扰动上泛，饵料丰富。",
		anchor: {
			lon: -72,
			lat: 33
		},
		arrow: {
			lon1: -80,
			lat1: 26,
			lon2: -62,
			lat2: 40
		},
		note: "① 重点层 · 教材图 4-24 北大西洋环流成员。"
	},
	{
		id: "labrador",
		name: "拉布拉多寒流",
		tier: "core",
		kind: "cold",
		hemisphere: "N",
		ocean: "atlantic",
		flowText: "自北向南 · 由拉布拉多半岛南下",
		direction: "equator-ward",
		quality: 4,
		fish: [{
			name: "鳕鱼",
			icon: "cod"
		}, {
			name: "比目鱼",
			icon: "halibut"
		}],
		reason: "与墨西哥湾暖流交汇形成纽芬兰渔场，本游戏里只作「交汇的另一方」出现。",
		anchor: {
			lon: -54,
			lat: 53
		},
		arrow: {
			lon1: -58,
			lat1: 62,
			lon2: -52,
			lat2: 44
		},
		note: "① 重点层 · 教材在「渔场成因」里点名（『拉布拉多寒流及墨西哥湾暖流交汇』）。"
	},
	{
		id: "north-atlantic",
		name: "北大西洋暖流",
		tier: "core",
		kind: "warm",
		hemisphere: "N",
		ocean: "atlantic",
		flowText: "自西向东 · 由北美东岸流向欧洲西北岸",
		direction: "west-to-east",
		quality: 4,
		fish: [{
			name: "鲱鱼",
			icon: "herring"
		}, {
			name: "鲭鱼",
			icon: "mackerel"
		}],
		reason: "与北冰洋南下冷水交汇形成北海渔场；同时它增温增湿，使西欧形成温带海洋性气候。",
		anchor: {
			lon: -28,
			lat: 47
		},
		arrow: {
			lon1: -50,
			lat1: 42,
			lon2: 5,
			lat2: 60
		},
		note: "① 重点层 · 教材图 4-24 北大西洋环流成员，也是「洋流影响」一节的原文例证。"
	},
	{
		id: "canary",
		name: "加那利寒流",
		tier: "core",
		kind: "cold",
		hemisphere: "N",
		ocean: "atlantic",
		flowText: "自北向南 · 沿非洲西北岸南下",
		direction: "equator-ward",
		quality: 3,
		fish: [{
			name: "沙丁鱼",
			icon: "sardine"
		}, {
			name: "鲭鱼",
			icon: "mackerel"
		}],
		reason: "中低纬大洋东岸，有上升流但规模一般，饵料中等。",
		anchor: {
			lon: -19,
			lat: 26
		},
		arrow: {
			lon1: -14,
			lat1: 36,
			lon2: -21,
			lat2: 16
		},
		note: "① 重点层 · 教材图 4-24 北大西洋环流成员。"
	},
	{
		id: "brazil",
		name: "巴西暖流",
		tier: "core",
		kind: "warm",
		hemisphere: "S",
		ocean: "atlantic",
		flowText: "自北向南 · 沿南美东岸南下",
		direction: "pole-ward",
		quality: 3,
		fish: [{
			name: "鲭鱼",
			icon: "mackerel"
		}, {
			name: "鲨鱼",
			icon: "shark"
		}],
		reason: "暖流，无交汇条件、无显著上升流，品质中等。",
		anchor: {
			lon: -42,
			lat: -26
		},
		arrow: {
			lon1: -38,
			lat1: -12,
			lon2: -48,
			lat2: -38
		},
		note: "① 重点层 · 教材图 4-24 南大西洋环流成员。"
	},
	{
		id: "benguela",
		name: "本格拉寒流",
		tier: "core",
		kind: "cold",
		hemisphere: "S",
		ocean: "atlantic",
		flowText: "自南向北 · 沿非洲西南岸北上",
		direction: "equator-ward",
		quality: 3,
		fish: [{
			name: "沙丁鱼",
			icon: "sardine"
		}, {
			name: "鳀鱼",
			icon: "anchovy"
		}],
		reason: "中低纬大洋东岸，有上升流但规模小于秘鲁，饵料中等。",
		anchor: {
			lon: 11,
			lat: -26
		},
		arrow: {
			lon1: 15,
			lat1: -36,
			lon2: 9,
			lat2: -16
		},
		note: "① 重点层 · 教材图 4-24 南大西洋环流成员。"
	},
	{
		id: "agulhas",
		name: "厄加勒斯暖流",
		tier: "core",
		kind: "warm",
		hemisphere: "S",
		ocean: "indian",
		flowText: "自北向南 · 沿非洲东南岸南下",
		direction: "pole-ward",
		quality: 3,
		fish: [{
			name: "鲭鱼",
			icon: "mackerel"
		}, {
			name: "金枪鱼",
			icon: "tuna"
		}],
		reason: "暖流，无交汇条件，品质中等。",
		anchor: {
			lon: 37,
			lat: -30
		},
		arrow: {
			lon1: 33,
			lat1: -20,
			lon2: 40,
			lat2: -38
		},
		note: "① 重点层 · 教材图 4-24 南印度洋环流成员。"
	},
	{
		id: "west-australia",
		name: "西澳大利亚寒流",
		tier: "core",
		kind: "cold",
		hemisphere: "S",
		ocean: "indian",
		flowText: "自南向北 · 沿澳大利亚西岸北上",
		direction: "equator-ward",
		quality: 3,
		fish: [{
			name: "沙丁鱼",
			icon: "sardine"
		}, {
			name: "鲱鱼",
			icon: "herring"
		}],
		reason: "中低纬大洋东岸，饵料中等；教材用它沿岸的荒漠作「寒流降温减湿」例证。",
		anchor: {
			lon: 108,
			lat: -28
		},
		arrow: {
			lon1: 111,
			lat1: -36,
			lon2: 105,
			lat2: -18
		},
		note: "① 重点层 · 教材图 4-24 南印度洋环流成员。"
	},
	{
		id: "north-equatorial",
		name: "北赤道暖流",
		tier: "core",
		kind: "warm",
		hemisphere: "N",
		ocean: "pacific",
		flowText: "自东向西 · 由东北信风推动横穿太平洋与大西洋",
		direction: "east-to-west",
		quality: 2,
		fish: [{
			name: "飞鱼",
			icon: "flying-fish"
		}, {
			name: "金枪鱼",
			icon: "tuna"
		}],
		reason: "大洋环流中部海域风力微弱、饵料极少，鱼群稀疏。",
		anchor: {
			lon: -140,
			lat: 12
		},
		arrow: {
			lon1: -110,
			lat1: 12,
			lon2: 165,
			lat2: 13
		},
		note: "① 重点层 · 教材图 4-24 四大环流共有的南/北赤道暖流。"
	},
	{
		id: "south-equatorial",
		name: "南赤道暖流",
		tier: "core",
		kind: "warm",
		hemisphere: "S",
		ocean: "pacific",
		flowText: "自东向西 · 由东南信风推动横穿低纬海区",
		direction: "east-to-west",
		quality: 2,
		fish: [{
			name: "飞鱼",
			icon: "flying-fish"
		}, {
			name: "金枪鱼",
			icon: "tuna"
		}],
		reason: "同为大洋环流中部，饵料少、鱼群稀疏。",
		anchor: {
			lon: -130,
			lat: -8
		},
		arrow: {
			lon1: -95,
			lat1: -6,
			lon2: 170,
			lat2: -10
		},
		note: "① 重点层 · 教材图 4-24 四大环流共有的南/北赤道暖流。"
	},
	{
		id: "west-wind-drift",
		name: "西风漂流",
		tier: "core",
		kind: "cold",
		hemisphere: "S",
		ocean: "pacific",
		flowText: "自西向东 · 环绕南极大陆外围一周",
		direction: "west-to-east",
		quality: 2,
		fish: [{
			name: "磷虾",
			icon: "krill"
		}, {
			name: "小型鱼",
			icon: "small-fish"
		}],
		reason: "教材称为「世界最强大的寒流」。它环绕地球，水温低、风浪大，产量低；在南太平洋、南大西洋、南印度洋三个环流里出现的是同一条流。",
		anchor: {
			lon: -20,
			lat: -50
		},
		arrow: {
			lon1: 60,
			lat1: -52,
			lon2: 160,
			lat2: -50
		},
		note: "① 重点层 · 三个环流共用同一条流（数据里只建一个 id）。"
	},
	{
		id: "indian-monsoon",
		name: "北印度洋季风洋流",
		tier: "core",
		kind: "warm",
		hemisphere: "N",
		ocean: "indian",
		flowText: "北半球冬季自东向西（逆时针）／夏季自西向东（顺时针）",
		direction: "east-to-west",
		quality: 3,
		fish: [{
			name: "鲭鱼",
			icon: "mackerel"
		}, {
			name: "沙丁鱼",
			icon: "sardine"
		}],
		reason: "受季风驱动，流向随季节反向。图的标题是「北半球冬季」，所以本作按冬季记。",
		anchor: {
			lon: 66,
			lat: 12
		},
		arrow: {
			lon1: 84,
			lat1: 16,
			lon2: 50,
			lat2: 6
		},
		note: "① 重点层 · 高中版启用。⚠️ 讲它必须说明「北半球冬季」这个前提。"
	},
	{
		id: "alaska",
		name: "阿拉斯加暖流",
		tier: "extension",
		kind: "warm",
		hemisphere: "N",
		ocean: "pacific",
		flowText: "自南向北 · 沿北美西北岸北上",
		direction: "pole-ward",
		quality: 3,
		fish: [{
			name: "鲑鱼",
			icon: "salmon"
		}, {
			name: "大比目鱼",
			icon: "halibut"
		}],
		reason: "北太平洋环流在此分出的一支，属真实洋流，但不在教材熟记清单内。",
		anchor: {
			lon: -142,
			lat: 54
		},
		arrow: {
			lon1: -132,
			lat1: 48,
			lon2: -152,
			lat2: 58
		},
		note: "② 拓展层 · ⚠️ 课标未要求熟记，认得名字即可。"
	},
	{
		id: "equatorial-counter",
		name: "赤道逆流",
		tier: "extension",
		kind: "warm",
		hemisphere: "N",
		ocean: "pacific",
		flowText: "自西向东 · 在南北赤道暖流之间的赤道无风带东流",
		direction: "west-to-east",
		quality: 3,
		fish: [{
			name: "金枪鱼",
			icon: "tuna"
		}, {
			name: "旗鱼",
			icon: "swordfish"
		}],
		reason: "赤道无风带的水流，图 4-24 上有标注，但不属于熟记环流体系。",
		anchor: {
			lon: -160,
			lat: 5
		},
		arrow: {
			lon1: 140,
			lat1: 5,
			lon2: -160,
			lat2: 6
		},
		note: "② 拓展层 · ⚠️ 课标未要求熟记，认得名字即可。"
	},
	{
		id: "east-greenland",
		name: "东格陵兰寒流",
		tier: "extension",
		kind: "cold",
		hemisphere: "N",
		ocean: "arctic",
		flowText: "自北向南 · 沿格陵兰岛东岸南下",
		direction: "equator-ward",
		quality: 3,
		fish: [{
			name: "鳕鱼",
			icon: "cod"
		}, {
			name: "格陵兰大比目鱼",
			icon: "halibut"
		}],
		reason: "北冰洋边缘的冷水南下，图上画了箭头，但**不参与北大西洋环流的闭合**。",
		anchor: {
			lon: -20,
			lat: 70
		},
		arrow: {
			lon1: -8,
			lat1: 78,
			lon2: -28,
			lat2: 62
		},
		note: "② 拓展层 · ⚠️ 课标未要求熟记；注意它不参与北大西洋环流闭合。"
	},
	{
		id: "somali",
		name: "索马里寒流",
		tier: "extension",
		kind: "cold",
		hemisphere: "N",
		ocean: "indian",
		flowText: "自北向南 · 夏季沿非洲之角东岸南下",
		direction: "equator-ward",
		quality: 3,
		fish: [{
			name: "沙丁鱼",
			icon: "sardine"
		}, {
			name: "金枪鱼",
			icon: "tuna"
		}],
		reason: "北印度洋季风洋流的派生分支，夏季出现，属拓展内容。",
		anchor: {
			lon: 52,
			lat: 7
		},
		arrow: {
			lon1: 58,
			lat1: 12,
			lon2: 47,
			lat2: 2
		},
		note: "② 拓展层 · ⚠️ 课标未要求熟记，认得名字即可。"
	},
	{
		id: "mozambique",
		name: "莫桑比克暖流",
		tier: "extension",
		kind: "warm",
		hemisphere: "S",
		ocean: "indian",
		flowText: "自北向南 · 沿马达加斯加岛西侧南下",
		direction: "pole-ward",
		quality: 3,
		fish: [{
			name: "鲭鱼",
			icon: "mackerel"
		}, {
			name: "鲨鱼",
			icon: "shark"
		}],
		reason: "厄加勒斯暖流的上游段，教材图上常与它并称，本作单列为拓展条目。",
		anchor: {
			lon: 41,
			lat: -20
		},
		arrow: {
			lon1: 42,
			lat1: -12,
			lon2: 38,
			lat2: -30
		},
		note: "② 拓展层 · ⚠️ 课标未要求熟记，认得名字即可。"
	},
	{
		id: "arctic-outflow",
		name: "北冰洋南下冷水",
		tier: "extension",
		kind: "cold",
		hemisphere: "N",
		ocean: "arctic",
		flowText: "自北向南 · 由北冰洋注入北大西洋",
		direction: "equator-ward",
		quality: 4,
		fish: [{
			name: "鲱鱼",
			icon: "herring"
		}, {
			name: "鳕鱼",
			icon: "cod"
		}],
		reason: "教材在「北海渔场」成因里点到过它（与北大西洋暖流交汇），属体系边缘。",
		anchor: {
			lon: -12,
			lat: 74
		},
		arrow: {
			lon1: -20,
			lat1: 80,
			lon2: -5,
			lat2: 68
		},
		note: "② 拓展层 · 教材在北海渔场成因里提到过，但仍属拓展。"
	}
];
/**
* 四个闭合环流 + 季风洋流。成员按**流向顺序**排列——
* 游戏里的收集顺序 = 课本上的背诵顺序。
*
* ⚠️ 西风漂流出现在三个环流里，是**同一条流**：此处 members 里重复列它是
* 为了画图鉴的闭环，但数据主键始终是同一个 `west-wind-drift`。
*/
const GYRES = [
	{
		id: "north-pacific-gyre",
		name: "北太平洋环流",
		spin: "clockwise",
		members: [
			"north-equatorial",
			"kuroshio",
			"north-pacific",
			"california"
		]
	},
	{
		id: "south-pacific-gyre",
		name: "南太平洋环流",
		spin: "counter-clockwise",
		members: [
			"south-equatorial",
			"east-australia",
			"west-wind-drift",
			"peru"
		]
	},
	{
		id: "north-atlantic-gyre",
		name: "北大西洋环流",
		spin: "clockwise",
		members: [
			"north-equatorial",
			"gulf-stream",
			"north-atlantic",
			"canary"
		]
	},
	{
		id: "south-atlantic-gyre",
		name: "南大西洋环流",
		spin: "counter-clockwise",
		members: [
			"south-equatorial",
			"brazil",
			"west-wind-drift",
			"benguela"
		]
	},
	{
		id: "south-indian-gyre",
		name: "南印度洋环流",
		spin: "counter-clockwise",
		members: [
			"south-equatorial",
			"agulhas",
			"west-wind-drift",
			"west-australia"
		]
	},
	{
		id: "indian-monsoon-gyre",
		name: "北印度洋季风环流",
		spin: "counter-clockwise",
		members: ["indian-monsoon"]
	}
];
/** 通关要集齐的环流（拓展层不参与——名义拓展不能变必修）。 */
const WIN_GYRES = [
	"north-pacific-gyre",
	"south-pacific-gyre",
	"north-atlantic-gyre",
	"south-atlantic-gyre",
	"south-indian-gyre"
];
const CONFUSABLE_PAIRS = [
	{
		a: "benguela",
		b: "canary",
		why: "两条都是「非洲外海的中低纬寒流」，一南一北，学生只记「非洲西岸寒流」就分不清。"
	},
	{
		a: "peru",
		b: "california",
		why: "两条都是「大洋东岸的寒流」，分别在南北半球，都伴上升流但强度差很多。"
	},
	{
		a: "kuroshio",
		b: "gulf-stream",
		why: "两条都是「大洋西岸的强大暖流」，一条在太平洋、一条在大西洋。"
	},
	{
		a: "brazil",
		b: "east-australia",
		why: "两条都是南半球大洋西岸暖流，位置对调很容易记反。"
	},
	{
		a: "agulhas",
		b: "mozambique",
		why: "同在南印度洋西侧、同向流动，教材图上常并称，容易被当成一条。"
	},
	{
		a: "west-wind-drift",
		b: "north-pacific",
		why: "都是「自西向东」的流，但一条环绕南极、一条在北太平洋中纬，纬度完全不同。"
	}
];
const STAGES = {
	junior: {
		id: "junior",
		name: "初中版",
		tiers: ["core"],
		directionUI: "two-choice",
		showQuality: true,
		casts: 12,
		timeLimit: 20,
		blurb: "教材熟记的 16 条洋流，认名称 + 二选一判方向",
		note: "只考重点层；显示星级，看到 ★×5 就知道值得下网。"
	},
	senior: {
		id: "senior",
		name: "高中版",
		tiers: ["core", "extension"],
		directionUI: "draw-arrow",
		showQuality: false,
		casts: 10,
		timeLimit: 15,
		blurb: "重点层 + 拓展层，图上画箭头判方向",
		note: "含北印度洋季风洋流与拓展洋流；拓展层只认名称、不判方向。"
	}
};
const DEFAULT_STAGE = "junior";
const BY_ID = new Map(CURRENTS.map((c) => [c.id, c]));
/** 按 id 取洋流。取不到返回 undefined —— 调用方必须处理，不许静默兜底。 */
function currentById(id) {
	return BY_ID.get(id);
}
/** 按名称取洋流（校验用）。 */
function currentByName(name) {
	return CURRENTS.find((c) => c.name === name);
}
/**
* 这一局里真正会出现在地图上的洋流。
*
* ⚠️ 注意**千岛寒流 / 拉布拉多寒流**虽然在重点层，但它们是"交汇的另一方"，
* 不设独立捕捞区（学生在图上找不到显眼位置）。所以这里把它们排掉。
*/
const NO_SOLO_ZONE = ["oyashio", "labrador"];
function playableCurrents(stage) {
	const cfg = STAGES[stage];
	return CURRENTS.filter((c) => cfg.tiers.includes(c.tier) && !NO_SOLO_ZONE.includes(c.id));
}
/** 图鉴要展示的全部条目（不过滤，图鉴是"看得见的知识地图"）。 */
function allTiers() {
	return [
		"core",
		"extension",
		"reference"
	];
}
/**
* 校验洋流分层。三条规则，任一违反就抛错，构建期 exit(1)。
*
* 为什么不用一个白名单数组：
*   白名单只能告诉你"这个名字合不合法"，**管不住"它该有多重要"**。
*   用 `CurrentTier` 联合类型 + 这个校验，分层从"文档约定"变成"类型约束"。
*/
function assertTiering(entries = CURRENTS) {
	const errs = [];
	const lists = {
		core: CORE_CURRENTS,
		extension: EXTENSION_CURRENTS,
		reference: REFERENCE_CURRENTS
	};
	for (const e of entries) {
		const declared = lists[e.tier];
		if (!declared) {
			errs.push(`「${e.name}」的层级 "${e.tier}" 不是合法层级`);
			continue;
		}
		if (!declared.includes(e.name)) errs.push(`「${e.name}」声明层级为 ${e.tier}，但它不在 ${e.tier.toUpperCase()} 名单里`);
		if (e.tier !== "reference") {
			if ((e.tier === "core" ? EXTENSION_CURRENTS : CORE_CURRENTS).includes(e.name)) errs.push(`「${e.name}」同时出现在 core / extension 名单里，这两层必须互斥`);
		}
		const sameId = entries.filter((x) => x.id === e.id);
		if (sameId.length > 1) {
			errs.push(`id「${e.id}」重复出现 ${sameId.length} 次`);
			break;
		}
		if (e.tier === "extension" && !e.note.includes("拓展层")) errs.push(`「${e.name}」是拓展层，note 里必须标出「拓展层」以便界面显示角标`);
	}
	for (const tier of Object.keys(lists)) for (const name of lists[tier]) if (!entries.some((e) => e.name === name)) errs.push(`名单里的「${name}」（${tier}）在 CURRENTS 里找不到对应条目`);
	for (const g of GYRES) for (const id of g.members) {
		const c = BY_ID.get(id);
		if (!c) errs.push(`环流「${g.name}」引用了不存在的 id「${id}」`);
		else if (c.tier !== "core") errs.push(`环流「${g.name}」引用了非重点层的「${c.name}」—— 通关闭环只能在重点层内成立`);
	}
	if (errs.length) throw new Error("洋流分层校验失败：\n  - " + errs.join("\n  - "));
}
/** 允许的洋流名称全集（供测试断言用，不要用它替代 assertTiering）。 */
function allowedCurrentNames() {
	return [
		...CORE_CURRENTS,
		...EXTENSION_CURRENTS,
		...REFERENCE_CURRENTS
	];
}
//#endregion
//#region src/proj.ts
/**
* 经纬度 ⇄ 画布 投影层
* =====================
*
* ## 为什么要有这一层（这是本项目最重要的一次修正）
*
* 上一版的洋流坐标是**手工摆在手绘底图上的**（`anchor: {x, y}` 直接写 0~1 归一化值）。
* 当时底图是 7 个"画得像地球"的多边形，没有真正的经纬网，于是那一版坐标
* 和真实地理位置**没有任何对应关系**——实测偏差：
*
*   · 加利福尼亚寒流  → 画到了大西洋东岸（偏差 169°）
*   · 阿拉斯加暖流    → 画到了欧洲北部  （偏差 181°）
*   · 南赤道暖流      → 画到了印度洋    （偏差 215°）
*   · 北赤道暖流      → 画到了印度洋    （偏差  70°）
*   · 整个太平洋的洋流全部横向错位
*
* 学生看图时要建立的是"**这条洋流在真实地球上位于哪里**"的空间认知。
* 坐标只要不是从真实经纬度来的，这个认知就是错的——而且错得毫无规律，
* 不是"整体偏一点"，是"这条在大西洋、那条跑到印度洋"。
*
* 所以现在改口径：**经纬度是唯一真相源（single source of truth）**。
* `data.ts` 里每条洋流存的是真实经纬度，画布像素由本文件算出来。
* 这样：
*   ① 位置永远可复核（拿一个真实经纬度就能验，不用"看图感觉对不对"）；
*   ② 加新洋流只需查经纬度，不用手工试坐标；
*   ③ 底图换成真实影像后，洋流能**真正对齐**在影像的海域上。
*
* ## 为什么选等距圆柱（equirectangular）而不是 Mercator
*
* 两个候选：
*   · **Mercator**   海图常用，但高纬面积急剧放大（格陵兰比非洲还大），
*                    不适合"给学生看全球"；而且它不是等距的，
*                    洋流长度会被纬度严重拉伸。
*   · **等距圆柱**   lon/lat 线性映射到 x/y，**公式只有一条乘法**，
*                    且绝大多数卫星影像图（含 NASA Blue Marble）的原生格式
*                    就是等距圆柱 ⇒ **贴图零重采样**。
*
* 教学底图要的是"无变形地看清楚每条洋流在哪"，等距圆柱的纬度方向
* 线性拉伸反而**更好**（不像 Mercator 把高纬挤成一团）。
*
* ## ⚠️ 一个必守的细节：横向要乘 cos(中纬) 吗？——不要
*
* 等距圆柱的固有变形是"高纬东西向被拉长"，修正办法是横向乘 cos(φ)。
* 但**这里不能乘**，原因有两个：
*   ① 一旦乘了，投影就不是"lon/lat 线性映射"了 ⇒ **影像贴图无法零重采样**，
*      得逐像素重投影（就是 china-relief 那一整套 matrix3d 的复杂度）；
*   ② 底图是真实影像图，**影像本身已经是等距圆柱格式**。
*      如果洋流单独乘 cos、影像不乘，两者就**对不上**——洋流会偏离海岸线。
*
* 所以口径统一为："画布 = 等距圆柱"，影像和洋流**都用同一套**，
* 谁都不额外修正，于是它们天然对齐。代价是高纬东西向拉长（格陵兰变宽），
* 这在教学上可以接受——**"洋流对得上大陆"比"格陵兰比例正确"重要得多**。
*/
/** 画布尺寸（viewBox）。全项目共用这一份，别在别处再写死。 */
const MAP_W = 1e3;
const MAP_H = 560;
/**
* 画布覆盖的经纬范围。
*
* 经度取满全球 −180~180：洋流里有西风漂流（绕南极一圈）、
* 北赤道暖流（跨 160°E~130°W）这类横跨半个地球的流，
* 裁掉任何一段都会把它们切断。
*
* 纬度取 −90~90 也是满范围，但**实际观感上两极附近是空的**
* （北冰洋有冰盖、南极是大陆），所以下方视觉重心在中低纬。
* 之所以不裁：底图是影像图，裁掉会在图边出现"影像断口"。
*/
const LON_MIN = -180;
const LON_MAX = 180;
const LAT_MIN = -90;
const LAT_MAX = 90;
const LON_SPAN = 360;
const LAT_SPAN = 180;
/** 经度 → 画布 x。 */
function lonToX(lon) {
	return (lon - LON_MIN) / LON_SPAN * MAP_W;
}
/** 纬度 → 画布 y。⚠️ 北在上 ⇒ 纬度越大 y 越小（这个负号是唯一容易写反的地方）。 */
function latToY(lat) {
	return (90 - lat) / LAT_SPAN * 560;
}
/** 画布 x → 经度。 */
function xToLon(x) {
	return LON_MIN + x / MAP_W * LON_SPAN;
}
/** 画布 y → 纬度。 */
function yToLat(y) {
	return 90 - y / 560 * LAT_SPAN;
}
/** 经纬度 → 画布点。 */
function llToXY(lon, lat) {
	return {
		x: lonToX(lon),
		y: latToY(lat)
	};
}
/**
* 画布点 → 归一化坐标（0~1）。
*
* 只有"画箭头"那条交互路径还需要归一化值：玩家在屏幕上拖出的是像素，
* 归一化后存起来，渲染时再乘回画布尺寸。**洋流数据本身不再用归一化坐标。**
*/
function xyToNorm(x, y) {
	return {
		x: x / MAP_W,
		y: y / 560
	};
}
/** 归一化坐标 → 画布点（画箭头渲染用）。 */
function normToXY(n) {
	return {
		x: n.x * MAP_W,
		y: n.y * 560
	};
}
/**
* 两条经纬度箭头的方位角（度，正东为 0，逆时针为正）。
*
* 用**经纬度**算而不是用画布像素算：等距圆柱下高纬的东西向被拉长，
* 拿像素算会把"沿 60°N 向东流"算成比实际更偏东的角度。
* 经纬度口径下 `atan2(Δlat, Δlon · cos(中纬))` 才是地球上的真实方位。
*
* 判定第二问（画箭头）时用的是"±45° 内算对"（见 game.ts 的 `judgeArrow`），
* 容差够宽，所以这个修正不修正都不会改变判定结果——但**换算口径要统一**，
* 否则以后收紧容差就会出错。
*/
function bearing(lon1, lat1, lon2, lat2) {
	const midLat = (lat1 + lat2) / 2 * (Math.PI / 180);
	const dx = (lon2 - lon1) * Math.cos(midLat);
	const dy = lat2 - lat1;
	return Math.atan2(dy, dx) * 180 / Math.PI;
}
/**
* 经度差，按**最短路径**归一到 −180~180。
*
* 为什么必须有这个函数：洋流里有一批是**跨 ±180° 日界线**的
* （北太平洋暖流、南北赤道暖流、赤道逆流）。如果直接 `lon2 - lon1`：
*   · 判定层：150°E → 130°W 会算成 Δ = −280°，看着像"方向反了"，
*     于是"向西流"被判成"向东流"——**结论直接错**；
*   · 渲染层：画布上 x 从 916 拉到 138，"向东流 80°" 会被画成
*     **横穿整张图往回拉 280°**，一条箭头盖死半张地图。
* 这两处都是**看着不报错、但结论全错**的类型，所以归一放在公共层做一次。
*/
function dLonShort(lon1, lon2) {
	let d = lon2 - lon1;
	while (d > 180) d -= 360;
	while (d < -180) d += 360;
	return d;
}
/**
* 把一个可能跨日界线的经纬度线段，拆成若干**不跨日界线**的子段。
*
* 等距圆柱投影把 −180° 映射到 x=0、180° 映射到 x=W，于是"跨日界线"
* 在画布上表现为"顶点跑到图外"或"横穿全图"。拆段的规则是：
*   从起点出发，按最短路径逐步走，每走到 ±180 就断开，剩余部分
*   从另一端（∓180）继续。
*
* 返回的每一段都是 `[{lon, lat}, {lon, lat}]`，渲染层逐段画即可。
* 跨界的洋流会有 2 段（起段 + 续段），不跨界的**原样返回 1 段**。
*
* 之所以做成通用函数而不是手工把 4 条洋流写成两段：
* 以后加洋流时，只要它跨日界线就自动正确，**不需要有人记得去手工拆**。
* （这正是上一版"手工摆坐标"踩过的坑——靠人记得，就一定会漏。）
*/
function splitAtAntimeridian(lon1, lat1, lon2, lat2) {
	const d = dLonShort(lon1, lon2);
	if (Math.abs(lon2 - lon1) <= 180 + 1e-9) return [[{
		lon: lon1,
		lat: lat1
	}, {
		lon: lon2,
		lat: lat2
	}]];
	const dir = d > 0 ? 1 : -1;
	const endLon = dir > 0 ? 180 : -180;
	const startLon = dir > 0 ? -180 : 180;
	const span = Math.abs(d);
	const t = Math.abs(endLon - lon1) / span;
	const latMid = lat1 + (lat2 - lat1) * t;
	return [[{
		lon: lon1,
		lat: lat1
	}, {
		lon: endLon,
		lat: latMid
	}], [{
		lon: startLon,
		lat: latMid
	}, {
		lon: lon2,
		lat: lat2
	}]];
}
//#endregion
//#region src/game.ts
/**
* 《捕鱼达人 · 洋流版》纯逻辑引擎
* ================================
*
* 这个文件**不 import React、不碰 DOM**，所以可以直接被 Node 单测
* （照 china-relief/src/game.ts 的范式）。
*
* 它负责四件事：
*   1. 出题：给一个海域，生成「这是什么洋流」的四个选项（含强制干扰项）
*   2. 判定：第一问（认名称）+ 第二问（判方向），两层全对才起网
*   3. 计分：按洋流品质结算渔获，叠加连击
*   4. 进度：环流集齐、下网次数、通关判定
*/
/**
* mulberry32：小而稳的种子随机数。
* 合成/出题这类"可复现"的场景必须用它，不能用 Math.random。
*/
function rng(seed) {
	let a = seed >>> 0;
	return function next() {
		a = a + 1831565813 >>> 0;
		let t = a;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
/** 洗牌（不改原数组）。 */
function shuffle(list, random) {
	const out = list.slice();
	for (let i = out.length - 1; i > 0; i -= 1) {
		const j = Math.floor(random() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}
/**
* 生成「这是什么洋流」的选项。
*
* 防作弊的两条硬约束（**不能放宽**）：
*   1. **同性质至少一个**——否则学生看到红色就选暖流，根本不读名称；
*   2. **同半球至少一个**——否则学生靠"南北半球"就能蒙对一半。
*
* 剩下的位置优先从**真实易混对**里抽——错的选项越像，这一题越有价值。
*/
function buildOptions(target, pool, random, optionCount = 4) {
	const others = pool.filter((c) => c.id !== target.id);
	const confusableIds = CONFUSABLE_PAIRS.filter((p) => p.a === target.id || p.b === target.id).map((p) => p.a === target.id ? p.b : p.a);
	const confusable = others.filter((c) => confusableIds.includes(c.id));
	const sameBoth = others.filter((c) => c.kind === target.kind && c.hemisphere === target.hemisphere && !confusable.some((x) => x.id === c.id));
	const sameKind = others.filter((c) => c.kind === target.kind && !confusable.some((x) => x.id === c.id) && !sameBoth.some((x) => x.id === c.id));
	const sameHemi = others.filter((c) => c.hemisphere === target.hemisphere && !confusable.some((x) => x.id === c.id) && !sameBoth.some((x) => x.id === c.id) && !sameKind.some((x) => x.id === c.id));
	const rest = others.filter((c) => !confusable.some((x) => x.id === c.id) && !sameBoth.some((x) => x.id === c.id) && !sameKind.some((x) => x.id === c.id) && !sameHemi.some((x) => x.id === c.id));
	const picked = [];
	const take = (from, n) => {
		const shuffled = shuffle(from, random);
		for (const c of shuffled) {
			if (picked.length >= optionCount - 1 || n <= 0) break;
			if (!picked.some((p) => p.id === c.id)) {
				picked.push(c);
				n -= 1;
			}
		}
	};
	const need = optionCount - 1;
	take(confusable, 1);
	take(sameBoth, need - picked.length);
	take(sameKind, need - picked.length);
	take(sameHemi, need - picked.length);
	take(rest, need - picked.length);
	const hasSameKind = picked.some((c) => c.kind === target.kind);
	const hasSameHemi = picked.some((c) => c.hemisphere === target.hemisphere);
	if (!hasSameKind || !hasSameHemi) for (const c of others) {
		if (picked.length >= need) break;
		if (picked.some((p) => p.id === c.id)) continue;
		const fillsKind = !hasSameKind && c.kind === target.kind;
		const fillsHemi = !hasSameHemi && c.hemisphere === target.hemisphere;
		if (fillsKind || fillsHemi) picked.push(c);
	}
	return shuffle([{
		id: target.id,
		name: target.name,
		kind: target.kind,
		correct: true
	}, ...picked.slice(0, optionCount - 1).map((c) => ({
		id: c.id,
		name: c.name,
		kind: c.kind,
		correct: false
	}))], random);
}
/**
* 第二问的选项（初中版）。
* ⚠️ 措辞按半球换：北半球暖流是"向高纬（向北）"，不能用统一说法。
* ⚠️ 两个选项**必须都算出标签**（下面漏掉这一条就会渲染出一个空白按钮，
*    而且它比另一个矮一半，看着像"排版坏了"）：
*    高纬在北半球叫"向北"、在南半球叫"向南"；低纬反之。
*/
function directionChoice(current) {
	const south = current.hemisphere === "S";
	return {
		options: [{
			value: "pole-ward",
			label: south ? "向高纬（向南）" : "向高纬（向北）"
		}, {
			value: "equator-ward",
			label: south ? "向低纬（向北）" : "向低纬（向南）"
		}],
		answer: current.direction
	};
}
/** 第一问判定。 */
function judgeName(current, chosenId) {
	return current.id === chosenId;
}
/**
* 第二问判定（初中版：二选一）。
* 只有 `pole-ward` / `equator-ward` 参与；东西向的流在初中版按"向高纬/向低纬"近似问。
*/
function judgeDirection(current, chosen) {
	return current.direction === chosen;
}
/**
* 第二问判定（高中版：在图上画箭头）。
* 允许 ±45° 误差——学生手抖不该算错，方向对不对才是考点。
*
* ## 口径统一（v0.1.0 起必须走画布像素，不能混用经纬度）
*
* `drawn` 是玩家在屏幕上拖出来的，已经由 CurrentMap 归一化成 0~1 的**画布比例**；
* 而 `current.arrow` 现在是**真实经纬度**。两者不是同一套坐标，直接相减没有意义。
* 所以先把标准答案的经纬度端点用 `llToXY` 投到画布（1000×560），
* 再把玩家那条乘上同一尺寸，两边都变成"画布像素方向"再比角度。
*
* ⚠️ 反过来（把玩家的画布坐标反投影成经纬度再比）**也能算对角度**，
* 但要在纬度方向乘 cos 修正，容易写错、也不直观；
* 统一到画布像素就不存在这个坑。
*/
function judgeArrow(current, drawn) {
	const a1 = llToXY(current.arrow.lon1, current.arrow.lat1);
	const a2 = llToXY(current.arrow.lon2, current.arrow.lat2);
	const ax = a2.x - a1.x;
	const ay = a2.y - a1.y;
	const b1 = normToXY({
		x: drawn.x1,
		y: drawn.y1
	});
	const b2 = normToXY({
		x: drawn.x2,
		y: drawn.y2
	});
	const bx = b2.x - b1.x;
	const by = b2.y - b1.y;
	const la = Math.hypot(ax, ay);
	const lb = Math.hypot(bx, by);
	if (la === 0 || lb === 0) return false;
	return (ax * bx + ay * by) / (la * lb) >= Math.SQRT1_2;
}
/** 单条鱼的价值。品质越高越贵——顶级区单网价值约为普通区的 20 倍。 */
const UNIT_PRICE = {
	5: 8,
	4: 6,
	3: 4,
	2: 2,
	1: 1
};
/** 单网鱼数范围（下界含、上界含）。 */
const CATCH_RANGE = {
	5: [10, 14],
	4: [7, 10],
	3: [5, 7],
	2: [2, 4],
	1: [0, 1]
};
/**
* 结算一网。
* 连击规则：连续成功每多一次 +10% 加成，上限 +50%（第 5 次封顶）。
* 为什么要有上限：否则一路顺下去后段分值爆表，前面的积累就没意义了。
*/
function settleCatch(current, comboBefore, random) {
	const [lo, hi] = CATCH_RANGE[current.quality] ?? [1, 1];
	const fishCount = lo + Math.floor(random() * (hi - lo + 1));
	const unitPrice = UNIT_PRICE[current.quality] ?? 1;
	const base = fishCount * unitPrice;
	const combo = comboBefore + 1;
	const bonus = Math.min(.1 * comboBefore, .5);
	return {
		fishCount,
		unitPrice,
		base,
		total: Math.round(base * (1 + bonus)),
		combo
	};
}
/** 无鱼区（环流中心"海洋荒漠"）。 */
function settleBarren(random) {
	const fishCount = Math.floor(random() * 2);
	return {
		fishCount,
		unitPrice: 1,
		base: fishCount,
		total: fishCount,
		combo: 0
	};
}
/** 开局。 */
function createSession(stage, seed) {
	return {
		stage,
		seed,
		castsLeft: STAGES[stage].casts,
		castsUsed: 0,
		score: 0,
		combo: 0,
		maxCombo: 0,
		recognized: [],
		mistakes: {},
		completedGyres: [],
		metExtension: [],
		won: false,
		over: false
	};
}
/**
* 这一局的**可捕捞海域池**。
* 排掉"交汇的另一方"（千岛寒流 / 拉布拉多寒流）——它们不设独立捕捞区。
*/
function zonePool(stage) {
	return playableCurrents(stage);
}
/** 开局第一网：随机挑一个可捕捞海域。 */
function pickZone(stage, random) {
	const pool = zonePool(stage);
	return pool[Math.floor(random() * pool.length)];
}
/** 玩家点了一处海域，开一道题。 */
function startCast(current, stage, random) {
	const isExtension = current.tier === "extension";
	return {
		currentId: current.id,
		nameChoices: buildOptions(current, zonePool(stage), random),
		namePassed: false,
		directionPassed: isExtension,
		failed: false,
		failReason: null,
		wrongPickId: null
	};
}
/** 这一步是否需要追问方向。 */
function needsDirection(current) {
	return current.tier !== "extension";
}
/** 应用会话变更（纯函数，返回新状态）。 */
function applySession(state, patch) {
	return {
		...state,
		...patch
	};
}
/**
* 记下一条洋流被认对。
* 顺带检查环流是否因此闭合——**这是通关的唯一入口**（拓展层不参与）。
*/
function recordRecognized(state, currentId) {
	const recognized = state.recognized.includes(currentId) ? state.recognized : [...state.recognized, currentId];
	const metExtension = CURRENTS.find((c) => c.id === currentId)?.tier === "extension" && !state.metExtension.includes(currentId) ? [...state.metExtension, currentId] : state.metExtension;
	const completedGyres = [...state.completedGyres];
	for (const g of GYRES) {
		if (completedGyres.includes(g.id)) continue;
		if (!g.members.every((id) => {
			return CURRENTS.find((x) => x.id === id)?.tier === "core";
		})) continue;
		if (g.members.every((id) => recognized.includes(id))) completedGyres.push(g.id);
	}
	const won = WIN_GYRES.every((id) => completedGyres.includes(id));
	return {
		...state,
		recognized,
		metExtension,
		completedGyres,
		won,
		over: state.over
	};
}
/** 记一次认错。 */
function recordMistake(state, currentId) {
	return {
		...state,
		mistakes: {
			...state.mistakes,
			[currentId]: (state.mistakes[currentId] ?? 0) + 1
		},
		combo: 0
	};
}
/**
* 结算页的「最常认错」。
* 只报**真实易混对**里的组合——否则会报出一堆毫无关系的随机错。
*/
function topConfusions(mistakes, limit = 3) {
	return CONFUSABLE_PAIRS.map((p) => ({
		pair: p,
		hits: (mistakes[p.a] ?? 0) + (mistakes[p.b] ?? 0)
	})).filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits).slice(0, limit).map((x) => x.pair);
}
/** 通关判定（供 UI 与测试共用同一个口径）。 */
function isWon(state) {
	return WIN_GYRES.every((id) => state.completedGyres.includes(id));
}
/** 剩余可认的洋流数（重点层内、排除无独立捕捞区的）。 */
function remainingCore(stage, state) {
	return zonePool(stage).filter((c) => !state.recognized.includes(c.id)).length;
}
/** 品质 → 星级字符串。 */
function stars(quality) {
	return "★".repeat(quality) + "☆".repeat(5 - quality);
}
/** 品质 → 文字档位。 */
function qualityLabel(quality) {
	return {
		5: "顶级渔场",
		4: "高品渔场",
		3: "中品渔场",
		2: "普通海域",
		1: "无鱼区"
	}[quality] ?? "未知";
}
/** 成因档位（解释卡标题用）。 */
function reasonTier(quality) {
	return {
		5: "upwelling",
		4: "convergence",
		3: "shelf",
		2: "gyre",
		1: "barren"
	}[quality] ?? "shelf";
}
/** 排除"交汇搭档"的判定（UI 里画图要用到）。 */
function isSoloZone(current) {
	return !NO_SOLO_ZONE.includes(current.id);
}
//#endregion
//#region src/basemap.ts
/**
* 地球真实影像底图（合规图源：天地图）
* =====================================
*
* ## 为什么底图必须用「天地图」而不是随便找个卫星图
*
* 这是一份**要发给学校、随包跑的全球地图产品**。卫星影像底图的取用不是
* "哪家图好看"的问题：地图产品的影像底图有明确的合规要求，境外图源
* （Google / Bing 海外版 / OSM / Mapbox 之类）一律不能用。
* 「国家地理信息公共服务平台（天地图）」由自然资源部主管，属于可用的官方图源。
*
* ⚠️ 而且全球图比中国图**多一个合规点**：图上必须正确处理国界线与
* 中国领土（台湾、南海诸岛）的表示，不能出现与国家标准不符的画法。
* 天地图底图的国界与中国领土表示已符合国家标准，所以直接用它最稳。
*
* ## 密钥为什么不能写死在代码里
*
* 天地图要 tk 密钥。而**密钥不能进随包发布的代码**——明文密钥会被抓包、
* 会被盗用、也没法给不同学校分别配。所以：
*   代码里只有占位符 `{tk}`，密钥由老师在界面上填一次，存在浏览器本地。
* 没密钥 / 没网时自动回退到内置的矢量海岸线底图，游戏照常能玩。
*
* ## 瓦片怎么落到等距圆柱画布上（比 china-relief 简单得多，但也有坑）
*
* 天地图 `img_w` 是标准 **Web Mercator** 瓦片（256px，行列号与 OSM 一致）；
* 我们的画布是**等距圆柱**。两者的纬度映射不同：
*   · 等距圆柱： y ∝ (90 − lat)，纬度线性；
*   · Mercator：  y ∝ ln(tan(π/4 + lat/2))，高纬被拉伸。
*
* 解法：**一次映射，逐瓦片算它的纬度范围，再把整块瓦片沿纬度切成
* `ROWS_PER_TILE` 条**，每条子块在画布上就是一个轴对齐矩形——
* 因为等距圆柱的经线和纬线**都是直线**，所以每个子块的四边形
* 退化成矩形（这是相比 Albers 的巨大简化：那边纬线是圆弧，
* 必须上 matrix3d 做单应变换，这里完全不用）。
*
* ⚠️ 两个曾经的坑（china-relief 的注释里也有，这里同样适用）：
*   ① **不能把整块 Mercator 瓦片按均匀高度贴上去**。同一块 z=3 瓦片，
*      上边在 66°N、下边在 40°N，Mercator 下高度均匀 ⇒ 越往上误差越大，
*      画面上海岸线与洋流箭头会错开十几公里。所以必须按纬度切条。
*   ② **纬度方向不是均匀的，切条要按 Mercator y 等分**（不是按纬度等分），
*      否则切出来的每个子块内部仍有非均匀拉伸。
*      按 Mercator y 等分后，每条内部的最大误差 = 该条纬度跨度下的
*      Mercator 曲率 —— ROWS_PER_TILE=8 时已远小于 1px。
*
* ## 子块之间的接缝
*
* 切条时相邻两条必须"上一条的下边 = 下一条的上边"，用 `floor`/`ceil` 会留缝
* 或重叠。这里统一由"同一条纬度边界"算出来，所以天然相接。
* 另外给每条子块在画布上多加 0.5px 高度，吃掉浏览器亚像素渲染时
* 偶发的一像素白线（`BLEED_PX`）。
*/
/** 天地图影像底图（Web Mercator 矩阵集 `w`）。`{s}` 子域、`{tk}` 密钥占位 */
const TIANDITU_TILE = "https://t{s}.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={tk}";
/** 申请密钥的入口（界面上要原样给老师） */
const TIANDITU_KEY_PAGE = "https://console.tianditu.gov.cn/api/key";
/** 影像底图必须标注来源 —— 合规要求，也免得有人以为是我们自己拍的 */
const TIANDITU_ATTRIBUTION = "影像底图：天地图（国家地理信息公共服务平台）";
const SUBDOMAINS = [
	0,
	1,
	2,
	3,
	4,
	5,
	6,
	7
];
/** 拼一个瓦片 URL。子域按行列号轮转，避免全站压到 t0。 */
function tiandituTileUrl(z, x, y, tk) {
	const sub = SUBDOMAINS[(x + y) % SUBDOMAINS.length];
	return TIANDITU_TILE.replace("{s}", String(sub)).replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)).replace("{tk}", tk);
}
/** 归一化 Mercator y（0 = 北极、1 = 南极）→ 纬度 */
function mercYToLat(ty) {
	return Math.atan(Math.sinh(Math.PI * (1 - 2 * ty))) * 180 / Math.PI;
}
/** 纬度 → 归一化 Mercator y */
function latToMercY(lat) {
	const rad = lat * Math.PI / 180;
	return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}
/** 接缝补偿：每条子块上下各多铺 0.5px，吃掉亚像素渲染产生的白线 */
const BLEED_PX = .5;
/** 每块瓦片沿纬度切成几条。8 条时单条内部误差远小于 1px（见文件头）。 */
const ROWS_PER_TILE = 8;
/**
* 挑一个合适的缩放级别。
*
* 判据：**源瓦片的分辨率刚好不比画布粗**。画布宽 `MAP_W` 像素覆盖 360°
* ⇒ 画布每像素 `360/1000 = 0.36°`。z 级时全世界 `256·2^z` 像素宽
* ⇒ 源每像素 `360/(256·2^z)` 度。
*
* 实测各级别（画布 1000px）：
*
*   z  瓦片数  子块数  源每像素  相对画布
*   1     4      32    0.7031°   粗 1.95 倍  ← 会糊
*   2    16     128    0.3516°   细 1.02 倍  ← 刚好（选它）
*   3    64     512    0.1758°   细 2.05 倍  ← 带宽翻 4 倍，肉眼无差
*   4   256    2048    0.0879°   细 4.10 倍  ← 明显浪费
*
* **z=2 是拐点**：源比画布细 1.02 倍，即"几乎一个源像素对应一个画布像素"，
* 再加细只会下载 4 倍的字节、缩回来丢掉。所以判据写成
* "源的度数 ≤ 画布需求的一半就再上一级"是**错的**（那会选到 z=3）；
* 正解是"**源的度数刚好处在接近 1 倍的位置**"，即下面的循环。
*
* ⚠️ 别为了"更清楚"盲目调高：等距圆柱下整幅世界图的横向分辨率是固定的
* （360° / MAP_W），源再细也只被缩回来，徒增请求数。
*/
function pickZoom() {
	const degPerPxNeed = 360 / MAP_W;
	let best = 1;
	let bestErr = Infinity;
	for (let z = 1; z <= 6; z++) {
		const degPerPxSrc = 360 / (256 * 2 ** z);
		if (degPerPxSrc > degPerPxNeed * 1.2) continue;
		const err = Math.abs(Math.log2(degPerPxNeed / degPerPxSrc));
		if (err < bestErr) {
			bestErr = err;
			best = z;
		}
	}
	return best;
}
/** 默认缩放级别（构建期算一次，见 `pickZoom`）。 */
const DEFAULT_ZOOM = pickZoom();
/**
* 算出铺满画布所需的全部瓦片子块。
*
* 等距圆柱下横向是均匀的：一块瓦片在画布上的宽度恒为 `MAP_W / n`。
* 纵向不均匀（Mercator → 等距圆柱），所以逐瓦片算上下边界、再切成
* `ROWS_PER_TILE` 条。
*
* ## 极地补边（必修，否则上下各留一条 ~15px 的空白带）
*
* Mercator 矩阵集只覆盖到 **±85.0511°**（再往上 y 趋于无穷）。
* 而画布是满 −90~90，于是：
*   · 顶部 90°~85.05° 共 14.9px；
*   · 底部 −85.05°~−90° 共 14.9px
* 没有任何瓦片，**画面上就是两条横贯全图的空白带**。
*
* 处理办法：把最靠边的两条子块的边界**外扩到画布边缘**。
* 这么做的依据是"那里本来就是均匀的"——北端是北冰洋海冰、南端是南极冰盖，
* 影像本身就接近纯白，外扩几个像素与真实影像几乎无法分辨；
* 反过来若不补，两条突兀的空白带是**一眼可见的缺陷**。
*/
function buildTiles(z) {
	const out = [];
	const n = 2 ** z;
	const tileCanvasW = MAP_W / n;
	for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) {
		const latTop = mercYToLat(y / n);
		const latBottom = mercYToLat((y + 1) / n);
		if (latBottom > 90 || latTop < -90) continue;
		const tileTopY = latToY(Math.min(latTop, 90));
		const fullHeight = latToY(Math.max(latBottom, -90)) - tileTopY;
		if (fullHeight <= 0) continue;
		for (let row = 0; row < 8; row++) {
			const tyA = (y + row / 8) / n;
			const tyB = (y + (row + 1) / 8) / n;
			const latA = mercYToLat(tyA);
			const latB = mercYToLat(tyB);
			let segTopY = latToY(Math.min(latA, 90));
			let segBottomY = latToY(Math.max(latB, -90));
			if (y === 0 && row === 0) segTopY = 0;
			if (y === n - 1 && row === 7) segBottomY = 560;
			const rawH = segBottomY - segTopY;
			if (rawH <= 0) continue;
			out.push({
				z,
				x,
				y,
				row,
				left: lonToX(-180) + x * tileCanvasW,
				top: segTopY - BLEED_PX,
				width: tileCanvasW + .5,
				height: rawH + BLEED_PX * 2,
				fullHeight,
				offsetY: segTopY - tileTopY
			});
		}
	}
	return out;
}
/** 画布可视窗口（全球）。 */
const VIEW = {
	z: 3,
	lonMin: -180,
	lonMax: 180,
	latMin: -90,
	latMax: 90
};
//#endregion
exports.CATCH_RANGE = CATCH_RANGE;
exports.CONFUSABLE_PAIRS = CONFUSABLE_PAIRS;
exports.CORE_CURRENTS = CORE_CURRENTS;
exports.CURRENTS = CURRENTS;
exports.DEFAULT_STAGE = DEFAULT_STAGE;
exports.DEFAULT_ZOOM = DEFAULT_ZOOM;
exports.EXTENSION_CURRENTS = EXTENSION_CURRENTS;
exports.GYRES = GYRES;
exports.LAT_MAX = LAT_MAX;
exports.LAT_MIN = LAT_MIN;
exports.LON_MAX = LON_MAX;
exports.LON_MIN = LON_MIN;
exports.MAP_H = MAP_H;
exports.MAP_W = MAP_W;
exports.NO_SOLO_ZONE = NO_SOLO_ZONE;
exports.QUALITY_RULES = QUALITY_RULES;
exports.REFERENCE_CURRENTS = REFERENCE_CURRENTS;
exports.ROWS_PER_TILE = ROWS_PER_TILE;
exports.STAGES = STAGES;
exports.TIANDITU_ATTRIBUTION = TIANDITU_ATTRIBUTION;
exports.TIANDITU_KEY_PAGE = TIANDITU_KEY_PAGE;
exports.TIANDITU_TILE = TIANDITU_TILE;
exports.UNIT_PRICE = UNIT_PRICE;
exports.VIEW = VIEW;
exports.WIN_GYRES = WIN_GYRES;
exports.allTiers = allTiers;
exports.allowedCurrentNames = allowedCurrentNames;
exports.applySession = applySession;
exports.assertTiering = assertTiering;
exports.bearing = bearing;
exports.buildOptions = buildOptions;
exports.buildTiles = buildTiles;
exports.createSession = createSession;
exports.currentById = currentById;
exports.currentByName = currentByName;
exports.dLonShort = dLonShort;
exports.directionChoice = directionChoice;
exports.isSoloZone = isSoloZone;
exports.isWon = isWon;
exports.judgeArrow = judgeArrow;
exports.judgeDirection = judgeDirection;
exports.judgeName = judgeName;
exports.latToMercY = latToMercY;
exports.latToY = latToY;
exports.llToXY = llToXY;
exports.lonToX = lonToX;
exports.mercYToLat = mercYToLat;
exports.needsDirection = needsDirection;
exports.normToXY = normToXY;
exports.pickZone = pickZone;
exports.pickZoom = pickZoom;
exports.playableCurrents = playableCurrents;
exports.qualityLabel = qualityLabel;
exports.reasonTier = reasonTier;
exports.recordMistake = recordMistake;
exports.recordRecognized = recordRecognized;
exports.remainingCore = remainingCore;
exports.rng = rng;
exports.settleBarren = settleBarren;
exports.settleCatch = settleCatch;
exports.shuffle = shuffle;
exports.splitAtAntimeridian = splitAtAntimeridian;
exports.stars = stars;
exports.startCast = startCast;
exports.tiandituTileUrl = tiandituTileUrl;
exports.topConfusions = topConfusions;
exports.xToLon = xToLon;
exports.xyToNorm = xyToNorm;
exports.yToLat = yToLat;
exports.zonePool = zonePool;
