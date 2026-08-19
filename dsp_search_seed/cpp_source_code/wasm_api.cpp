#include "wasm_api.hpp"
#include "check_seed.hpp"
#include "data_struct.hpp"
#include "PlanetAlgorithm_stub.hpp"
#include "RandomTable.hpp"
#include "const_value.hpp"
#include <string>
#include <sstream>
#include <vector>
#include <cstring>

// 静态缓冲区，用于存储返回的字符串
static std::string resultBuffer;

// 矿脉类型名称
static const char* VEIN_NAMES[] = {
    "铁", "铜", "硅", "钛", "石", "煤", "油",
    "可燃冰", "金伯利", "分形硅", "有机晶体",
    "光栅石", "刺笋结晶", "单极磁石"
};

// 恒星类型名称
static const char* STAR_TYPES[] = {
    "红巨星", "黄巨星", "蓝巨星", "白巨星", "白矮星", "中子星", "黑洞",
    "A型恒星", "B型恒星", "F型恒星", "G型恒星", "K型恒星", "M型恒星", "O型恒星"
};

// 行星类型名称
static const char* PLANET_TYPES[] = {
    "地中海", "冰巨星", "干旱荒漠", "灰烬冻土", "海洋丛林", "熔岩", "冰原冻土",
    "贫瘠荒漠", "戈壁", "火山灰", "红石", "草原", "水世界", "黑石盐滩",
    "樱林海", "飓风石林", "猩红冰湖", "热带草原", "橙晶荒漠", "极寒冻土",
    "潘多拉沼泽", "高产气巨", "气态巨星"
};

// 资源倍率值
static const double RESOURCE_RATES[] = {
    0.1, 0.3, 0.5, 0.8, 1.0, 1.5, 2.0, 3.0, 5.0, 8.0, 1000.0
};

// 格式化数量显示
static std::string formatAmountInternal(long long number) {
    if (number >= 1000000000LL) {
        return std::to_string(number / 1000000000LL) + "." +
               std::to_string((number % 1000000000LL) / 100000000LL) + "B";
    } else if (number >= 1000000LL) {
        return std::to_string(number / 1000000LL) + "." +
               std::to_string((number % 1000000LL) / 100000LL) + "M";
    } else if (number >= 1000LL) {
        return std::to_string(number / 1000LL) + "." +
               std::to_string((number % 1000LL) / 100LL) + "K";
    } else {
        return std::to_string(number);
    }
}

// 初始化函数
void init() {
    static bool isInit = false;
    if (isInit) return;
    isInit = true;

    // 初始化行星算法
    PlanetAlgorithm::do_init();

    // 初始化随机数表
    RandomTable::GenerateSphericNormal();
}

// 序列化行星数据为JSON
static void serializePlanet(std::ostringstream& oss, const PlanetData& planet) {
    oss << "{"
        << "\"starIndex\":" << planet.star_index
        << ",\"planetIndex\":" << planet.planet_index
        << ",\"name\":\"" << planet.name << "\""
        << ",\"type\":\"" << planet.type << "\""
        << ",\"typeId\":" << planet.type_id
        << ",\"seed\":" << planet.seed
        << ",\"posM\":[" << planet.pos_m[0] << "," << planet.pos_m[1] << "," << planet.pos_m[2] << "]"
        << ",\"posLy\":[" << planet.pos_ly[0] << "," << planet.pos_ly[1] << "," << planet.pos_ly[2] << "]"
        << ",\"isGas\":" << (planet.is_gas ? "true" : "false")
        << ",\"radius\":" << planet.radius
        << ",\"landPercent\":" << planet.land_percent
        << ",\"veinsPoint\":[";

    for (int i = 0; i < 14; i++) {
        if (i > 0) oss << ",";
        oss << planet.veins_point[i];
    }
    oss << "],\"veinsAmount\":[";

    for (int i = 0; i < 14; i++) {
        if (i > 0) oss << ",";
        oss << planet.veins_amount[i];
    }
    oss << "],\"gasVeins\":[";

    for (int i = 0; i < 3; i++) {
        if (i > 0) oss << ",";
        oss << planet.gas_veins[i];
    }
    oss << "],\"liquid\":" << planet.liquid
        << ",\"singularity\":" << static_cast<int>(planet.singularity)
        << ",\"singularityStr\":[";

    for (size_t i = 0; i < planet.singularity_str.size(); i++) {
        if (i > 0) oss << ",";
        oss << "\"" << planet.singularity_str[i] << "\"";
    }

    oss << "]"
        << ",\"dspLevel\":" << planet.dsp_level
        << ",\"lumino\":" << planet.lumino
        << ",\"wind\":" << planet.wind
        << ",\"obliquity\":" << planet.obliquity
        << ",\"rawDspDegree\":" << planet.raw_dsp_degree
        << ",\"enhanceDspDegree\":" << planet.enhance_dsp_degree
        << ",\"moons\":[";

    for (size_t i = 0; i < planet.moons.size(); i++) {
        if (i > 0) oss << ",";
        serializePlanet(oss, planet.moons[i]);
    }
    oss << "]}";
}

// 序列化恒星数据为JSON
static void serializeStar(std::ostringstream& oss, const StarData& star) {
    oss << "{"
        << "\"starIndex\":" << star.star_index
        << ",\"name\":\"" << star.name << "\""
        << ",\"type\":\"" << star.type << "\""
        << ",\"typeId\":" << star.type_id
        << ",\"seed\":" << star.seed
        << ",\"dysonLumino\":" << star.dyson_lumino
        << ",\"dysonRadius\":" << star.dyson_radius
        << ",\"distance\":" << star.distance
        << ",\"posM\":[" << star.pos_m[0] << "," << star.pos_m[1] << "," << star.pos_m[2] << "]"
        << ",\"posLy\":[" << star.pos_ly[0] << "," << star.pos_ly[1] << "," << star.pos_ly[2] << "]"
        << ",\"veinsPoint\":[";

    for (int i = 0; i < 14; i++) {
        if (i > 0) oss << ",";
        oss << star.veins_point[i];
    }
    oss << "],\"veinsAmount\":[";

    for (int i = 0; i < 14; i++) {
        if (i > 0) oss << ",";
        oss << star.veins_amount[i];
    }
    oss << "],\"gasVeins\":[";

    for (int i = 0; i < 3; i++) {
        if (i > 0) oss << ",";
        oss << star.gas_veins[i];
    }
    oss << "],\"liquid\":[";

    for (int i = 0; i < 3; i++) {
        if (i > 0) oss << ",";
        oss << star.liquid[i];
    }
    oss << "],\"planets\":[";

    for (size_t i = 0; i < star.planets.size(); i++) {
        if (i > 0) oss << ",";
        serializePlanet(oss, star.planets[i]);
    }
    oss << "]}";
}

// 获取种子数据
const char* getSeedData(int seedId, int starNum, int resourceIndex) {
    // 初始化
    init();

    // 验证参数
    if (seedId <= 0 || starNum <= 0 || starNum > 128 || resourceIndex < 0 || resourceIndex > 10) {
        resultBuffer = "{\"error\":\"Invalid parameters\"}";
        return resultBuffer.c_str();
    }

    try {
        // 创建种子对象
        SeedStruct seed(seedId, starNum, resourceIndex);

        // 获取星系数据（使用完整模式，CPU版本PlanetAlgorithm）
        GalaxyData galaxyData = get_galaxy_data(seed, false);

        // 序列化为JSON
        std::ostringstream oss;
        oss << "{"
            << "\"seedId\":" << galaxyData.seed_id
            << ",\"starNum\":" << static_cast<int>(galaxyData.star_num)
            << ",\"resourceIndex\":" << static_cast<int>(galaxyData.resource_index)
            << ",\"resourceRate\":" << galaxyData.resource_rate
            << ",\"veinsPoint\":[";

        for (int i = 0; i < 14; i++) {
            if (i > 0) oss << ",";
            oss << galaxyData.veins_point[i];
        }
        oss << "],\"veinsAmount\":[";

        for (int i = 0; i < 14; i++) {
            if (i > 0) oss << ",";
            oss << galaxyData.veins_amount[i];
        }
        oss << "],\"gasVeins\":[";

        for (int i = 0; i < 3; i++) {
            if (i > 0) oss << ",";
            oss << galaxyData.gas_veins[i];
        }
        oss << "],\"liquid\":[";

        for (int i = 0; i < 3; i++) {
            if (i > 0) oss << ",";
            oss << galaxyData.liquid[i];
        }
        oss << "],\"stars\":[";

        for (size_t i = 0; i < galaxyData.stars.size(); i++) {
            if (i > 0) oss << ",";
            serializeStar(oss, galaxyData.stars[i]);
        }
        oss << "]}";

        resultBuffer = oss.str();
        return resultBuffer.c_str();
    } catch (const std::exception& e) {
        resultBuffer = std::string("{\"error\":\"") + e.what() + "\"}";
        return resultBuffer.c_str();
    }
}

// 格式化数量显示
const char* formatAmount(long long number) {
    resultBuffer = formatAmountInternal(number);
    return resultBuffer.c_str();
}

// 获取矿脉类型名称
const char* getVeinName(int index) {
    if (index < 0 || index >= 14) {
        return "未知";
    }
    return VEIN_NAMES[index];
}

// 获取恒星类型名称
const char* getStarTypeName(int typeId) {
    if (typeId < 0 || typeId >= 14) {
        return "未知";
    }
    return STAR_TYPES[typeId];
}

// 获取行星类型名称
const char* getPlanetTypeName(int typeId) {
    if (typeId < 0 || typeId >= 23) {
        return "未知";
    }
    return PLANET_TYPES[typeId];
}

// 获取资源倍率值
double getResourceRate(int index) {
    if (index < 0 || index >= 11) {
        return 1.0;
    }
    return RESOURCE_RATES[index];
}

// 检查种子数据是否有效
int isSeedDataValid(int seedId, int starNum, int resourceIndex) {
    if (seedId <= 0 || starNum <= 0 || starNum > 128 || resourceIndex < 0 || resourceIndex > 10) {
        return 0;
    }
    return 1;
}
