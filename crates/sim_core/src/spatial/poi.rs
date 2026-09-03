use serde::{Deserialize, Serialize};
use super::vec3::Vec3;
use super::agent::AgentId;

pub type PoiId = u32;

/// 未接入播撒种子的 POI 兜底默认储量上限（实际仿真由 seed_primitive_ecology 覆盖为 config.stock_max_*）
pub const POI_FALLBACK_STOCK_MAX: f32 = 60.0;
/// 兜底初始储量占上限比例（seed 时实际为 config.stock_max_* * 0.75）
pub const POI_FALLBACK_INITIAL_RATIO: f32 = 0.75;
/// 兜底各类型再生速率（实际仿真由 config.regen_base_* 覆盖）
pub const POI_FALLBACK_REGEN_WATER: f32 = 2.00;
pub const POI_FALLBACK_REGEN_BERRY: f32 = 2.00;
pub const POI_FALLBACK_REGEN_WOOD: f32 = 2.00;
pub const POI_FALLBACK_REGEN_STONE: f32 = 1.50;
pub const POI_FALLBACK_REGEN_GOLD: f32 = 1.20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PoiType {
    Camp,        // 🏕️ 避风营地 (无限储量与无限庇护，休眠恢复体力、饱暖受孕与分娩)
    WaterSource, // 💧 低洼清泉 (储量上限与产速由 config.stock_max_water / config.regen_base_water 控制)
    BerryBush,   // 🍒 缓坡浆果 (储量上限与产速由 config.stock_max_berry / config.regen_base_berry 控制)
    WoodForest,  // 🌲 茂密林木 (储量上限与产速由 config.stock_max_wood / config.regen_base_wood 控制)
    StoneQuarry, // 🪨 嶙峋石矿 (储量上限与产速由 config.stock_max_stone / config.regen_base_stone 控制)
    GoldMine,    // 🪙 璀璨金矿 (储量上限与产速由 config.stock_max_gold / config.regen_base_gold 控制)
}

/// 全国县级行政区地名库 (240+ 处真实古雅县级行政区地名，营地生成时随机挑选)
pub const COUNTY_NAMES: &[&str] = &[
    // 华东 / 江南 (浙、闽、赣、苏、皖)
    "桃源", "江宁", "安吉", "淳安", "诸暨", "临海", "仙居", "长兴", "富阳", "余杭",
    "德清", "婺源", "缙云", "青田", "遂昌", "松阳", "庆元", "泰顺", "兰溪", "义乌",
    "东阳", "永康", "奉化", "宁海", "象山", "桐庐", "建德", "海盐", "嘉善", "平湖",
    "嵊州", "新昌", "江山", "常山", "开化", "龙游", "玉环", "三门", "天台", "苍南",
    "平阳", "文成", "武义", "磐安", "宜兴", "溧阳", "句容", "太仓", "昆山", "吴江",
    "常熟", "江阴", "靖江", "泰兴", "如皋", "海安", "东台", "大丰", "建湖", "射阳",
    "阜宁", "滨海", "响水", "涟水", "盱眙", "金湖", "宝应", "仪征", "高邮", "新安",
    "休宁", "徽州", "祁门", "绩溪", "旌德", "泾川", "宁国", "广德", "郎溪", "青阳",
    "石台", "东至", "怀宁", "潜山", "太湖", "宿松", "望江", "岳西", "桐城", "南陵",
    // 华北 / 中原 (冀、鲁、晋、豫、京、津)
    "平遥", "正定", "遵化", "迁安", "井陉", "磁州", "武安", "沙河", "清河", "宁晋",
    "巨鹿", "隆尧", "柏乡", "临城", "广宗", "威州", "平乡", "临漳", "曲周", "馆陶",
    "肥乡", "广平", "大名", "延庆", "密云", "怀柔", "昌平", "蓟州", "玉田", "乐亭",
    "滦州", "昌黎", "卢龙", "抚宁", "青龙", "固安", "永清", "香河", "大城", "文安",
    "曲阜", "兖州", "邹城", "微山", "鱼台", "金乡", "嘉祥", "汶上", "泗水", "梁山",
    "青州", "诸城", "寿光", "安丘", "高密", "昌邑", "临朐", "昌乐", "蓬莱", "龙口",
    "招远", "莱州", "栖霞", "海阳", "莱阳", "牟平", "荣成", "乳山", "文登", "广饶",
    "新郑", "登封", "新密", "巩义", "荥阳", "中牟", "陈留", "通许", "尉氏", "兰考",
    "朝歌", "栾川", "嵩阳", "汝阳", "宜阳", "洛宁", "伊川", "修武", "博爱", "武陟", "河内",
    // 西南 / 荆楚巴蜀云贵 (川、渝、鄂、湘、滇、黔)
    "阳朔", "腾冲", "敦煌", "玉龙", "凤凰", "武隆", "绥阳", "江津", "合川", "永川",
    "綦江", "大足", "璧山", "铜梁", "潼南", "荣昌", "开州", "梁平", "城口", "丰都",
    "垫江", "忠州", "云阳", "奉节", "巫山", "巫溪", "石柱", "秀山", "酉阳", "彭水",
    "青城", "彭州", "邛崃", "崇州", "金堂", "大邑", "蒲江", "新津", "简阳", "广汉",
    "什邡", "绵竹", "中江", "江油", "三台", "盐亭", "梓潼", "剑阁", "青川", "旺苍",
    "大理", "丽江", "中甸", "剑川", "鹤庆", "洱源", "宾川", "祥云", "巍山", "弥渡",
    "南涧", "漾濞", "建水", "石屏", "蒙自", "个旧", "开远", "弥勒", "泸西", "元阳",
    // 华南 / 岭南 (粤、桂、琼)
    "安溪", "德化", "永春", "南安", "晋江", "石狮", "惠安", "同安", "长泰", "华安",
    "平和", "诏安", "云霄", "漳浦", "东山", "崇安", "建阳", "建瓯", "邵武", "顺昌",
    "光泽", "松溪", "政和", "浦城", "顺德", "南海", "三水", "高明", "增城", "从化",
    "番禺", "花都", "博罗", "惠东", "龙门", "台山", "开平", "鹤山", "恩平", "阳春",
    "信宜", "高州", "化州", "廉江", "雷州", "吴川", "乐昌", "南雄", "仁化", "始兴",
    // 西北 (陕、甘、宁、青、新)
    "华阴", "韩城", "兴平", "彬州", "旬邑", "淳化", "永寿", "礼泉", "乾州", "泾阳",
    "三原", "武功", "凤翔", "岐山", "扶风", "郿坞", "陇州", "千阳", "麟游", "太白",
    "蓝田", "周至", "鄠邑", "高陵", "临潼", "略阳", "沔阳", "洋州", "城固", "西乡",
    "镇安", "柞水", "商南", "山阳", "丹凤", "洛南", "旬阳", "白河", "平利", "镇坪"
];

/// 非有限浮点（Infinity / NaN）的保真序列化助手
///
/// serde_json 默认把 `f32::INFINITY` / `NaN` 写成 JSON `null`，而 `f32` 字段反序列化
/// 遇到 `null` 会直接报错——营地 POI 的储量上限与当前储量恒为 `INFINITY`，
/// 不加处理会导致「存档能写、读不回来」。这里对非有限值改用字符串哨兵编码，
/// 有限值仍输出原生 JSON 数字，兼顾体积与语义保真（INFINITY 不能降级为 f32::MAX，
/// 因为 `observe_poi_stock` 用 `is_finite()` 分支判定无限储量营地）。
pub(crate) mod finite_f32 {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer>(v: &f32, s: S) -> Result<S::Ok, S::Error> {
        if v.is_finite() {
            v.serialize(s)
        } else if v.is_nan() {
            "NaN".serialize(s)
        } else if *v > 0.0 {
            "Infinity".serialize(s)
        } else {
            "-Infinity".serialize(s)
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<f32, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum NumOrStr {
            Num(f32),
            Str(String),
        }
        match NumOrStr::deserialize(d)? {
            NumOrStr::Num(v) => Ok(v),
            NumOrStr::Str(t) => match t.as_str() {
                "NaN" => Ok(f32::NAN),
                "Infinity" => Ok(f32::INFINITY),
                "-Infinity" => Ok(f32::NEG_INFINITY),
                other => Err(serde::de::Error::custom(format!("无法解析的非有限数值: {}", other))),
            },
        }
    }
}

/// 空置房屋登记条目（v1.10.0）：户主死亡后房屋成为无主空置房，
/// 在所属营地登记房屋 ID 与受益人列表（户主所有在世子女 + 目前的妻子）。
/// 仅登记，房屋转让/继承逻辑留待后续迭代。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VacantHouseEntry {
    pub house_id: u32,
    pub beneficiary_ids: Vec<AgentId>,
}

/// 有限生态地标实体 (清泉/浆果/林木/石矿/金矿的储量上限与产速均由 SimConfig 的 stock_max_* / regen_base_* 控制；营地无限)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrimitivePoi {
    pub id: PoiId,
    pub poi_type: PoiType,
    pub pos: Vec3,
    // 营地的储量恒为 INFINITY，必须走保真序列化（见 finite_f32 说明）
    #[serde(with = "finite_f32")]
    pub current_stock: f32, // 当前可用储量 (上限与产速由 config.stock_max_* / config.regen_base_* 控制，营地为无限)
    #[serde(with = "finite_f32")]
    pub max_stock: f32,     // 储量上限 (营地为无限)
    #[serde(with = "finite_f32")]
    pub regen_rate: f32,    // 每秒自然再生速率
    pub name: String,       // 地名库 roll 出的县级地名 (如 "桃源")
    pub level: u8,          // 聚落等级 (0=营地[0-5房], 1=村[6-11房], 2=乡[12-17房], 3=镇[18-23房], 4=县[24+房])
    pub bound_houses_count: u32, // 当前绑定的房屋总数
    /// ★ v1.10.0 空置房屋列表（仅营地有意义；户主死亡后登记，房屋坍塌后移除）
    pub vacant_houses: Vec<VacantHouseEntry>,
}

impl PrimitivePoi {
    pub fn new(id: PoiId, poi_type: PoiType, pos: Vec3) -> Self {
        let default_name = match poi_type {
            PoiType::Camp => format!("营地 #{}", id),
            PoiType::WaterSource => format!("低洼清泉 #{}", id),
            PoiType::BerryBush => format!("缓坡浆果 #{}", id),
            PoiType::WoodForest => format!("茂密林木 #{}", id),
            PoiType::StoneQuarry => format!("嶙峋石矿 #{}", id),
            PoiType::GoldMine => format!("璀璨金矿 #{}", id),
        };
        Self::new_with_name(id, poi_type, pos, default_name)
    }

    pub fn new_with_name(id: PoiId, poi_type: PoiType, pos: Vec3, name: String) -> Self {
        let (max_stock, regen_rate, initial_stock) = match poi_type {
            PoiType::Camp => (f32::INFINITY, 0.0, f32::INFINITY),
            PoiType::WaterSource => (POI_FALLBACK_STOCK_MAX, POI_FALLBACK_REGEN_WATER, POI_FALLBACK_STOCK_MAX * POI_FALLBACK_INITIAL_RATIO),
            PoiType::BerryBush => (POI_FALLBACK_STOCK_MAX, POI_FALLBACK_REGEN_BERRY, POI_FALLBACK_STOCK_MAX * POI_FALLBACK_INITIAL_RATIO),
            PoiType::WoodForest => (POI_FALLBACK_STOCK_MAX, POI_FALLBACK_REGEN_WOOD, POI_FALLBACK_STOCK_MAX * POI_FALLBACK_INITIAL_RATIO),
            PoiType::StoneQuarry => (POI_FALLBACK_STOCK_MAX, POI_FALLBACK_REGEN_STONE, POI_FALLBACK_STOCK_MAX * POI_FALLBACK_INITIAL_RATIO),
            PoiType::GoldMine => (POI_FALLBACK_STOCK_MAX, POI_FALLBACK_REGEN_GOLD, POI_FALLBACK_STOCK_MAX * POI_FALLBACK_INITIAL_RATIO),
        };

        Self {
            id,
            poi_type,
            pos,
            current_stock: initial_stock,
            max_stock,
            regen_rate,
            name,
            level: 0,
            bound_houses_count: 0,
            vacant_houses: Vec::new(),
        }
    }

    /// 聚落行政级别头衔：营地(0-5间) -> 村(6-11间) -> 乡(12-17间) -> 镇(18-23间) -> 县(24+间)
    pub fn camp_title(&self) -> String {
        if self.poi_type != PoiType::Camp {
            return self.name.clone();
        }
        let suffix = match self.level {
            0 => "营地",   // 0~5 间房 (原始营地)
            1 => "村",     // 6~11 间房 (村落聚落)
            2 => "乡",     // 12~17 间房 (乡集社区)
            3 => "镇",     // 18~23 间房 (繁盛集镇)
            _ => "县",     // 24+ 间房 (县级行政区)
        };
        format!("{}{}", self.name, suffix)
    }

    /// 根据当前绑定的有效房屋数量更新营地等级并返回升级播报
    pub fn update_camp_level(&mut self, house_count: u32) -> Option<String> {
        if self.poi_type != PoiType::Camp { return None; }
        self.bound_houses_count = house_count;
        let old_level = self.level;
        let new_level = match house_count {
            0..=5 => 0,
            6..=11 => 1,
            12..=17 => 2,
            18..=23 => 3,
            _ => 4,
        };
        self.level = new_level;
        if new_level > old_level {
            let old_title = match old_level { 0 => "营地", 1 => "村", 2 => "乡", 3 => "镇", _ => "县" };
            let new_title = match new_level { 0 => "营地", 1 => "村", 2 => "乡", 3 => "镇", _ => "县" };
            Some(format!("🏛️ 聚落繁盛晋升！【{}{}】辖内房屋达到 {} 间，正式升级为【{}{}】！", self.name, old_title, house_count, self.name, new_title))
        } else {
            None
        }
    }

    /// 自然周期再生 Tick
    pub fn tick_regenerate(&mut self, dt: f32) {
        if self.regen_rate > 0.0 && self.current_stock.is_finite() {
            self.current_stock = (self.current_stock + self.regen_rate * dt).min(self.max_stock);
        }
    }

    /// 提取资源
    pub fn extract(&mut self, amount: f32) -> f32 {
        if !self.current_stock.is_finite() {
            return amount;
        }
        let available = self.current_stock.min(amount);
        self.current_stock -= available;
        available
    }
}
