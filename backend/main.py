"""
戴森球计划种子查看器 - 后端API服务
使用FastAPI提供种子数据查询接口
"""

import sys
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# 添加项目内置的种子生成依赖路径
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

# 导入原项目的C API
from dsp_search_seed.CApi.search_seed import (
    do_init_c,
    get_galaxy_data_c,
    Seed,
)

app = FastAPI(title="戴森球计划种子查看器API")

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 开发时允许所有来源
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 初始化C库
do_init_c()

# 集成统计API
from stats_api import router as stats_router
app.include_router(stats_router)


class SeedRequest(BaseModel):
    seed_id: int
    star_num: int = 64
    resource_index: int = 0


def convert_planet(planet) -> dict:
    """转换行星数据为字典"""
    return {
        "star_index": planet.star_index,
        "planet_index": planet.planet_index,
        "name": planet.name,
        "type": planet.type,
        "type_id": planet.type_id,
        "singularity": planet.singularity,
        "singularity_str": planet.singularity_str,
        "pos_m": planet.pos_m,
        "pos_ly": planet.pos_ly,
        "seed": planet.seed,
        "lumino": planet.lumino,
        "wind": planet.wind,
        "radius": planet.radius,
        "liquid": planet.liquid,
        "is_gas": planet.is_gas,
        "dsp_level": planet.dsp_level,
        "raw_dsp_degree": planet.raw_dsp_degree,
        "enhance_dsp_degree": planet.enhance_dsp_degree,
        "obliquity": planet.obliquity,
        "land_percent": planet.land_percent,
        "veins_point": planet.veins_point,
        "veins_amount": planet.veins_amount,
        "gas_veins": planet.gas_veins,
        "moons": [convert_planet(moon) for moon in planet.moons]
    }


def convert_galaxy(galaxy) -> dict:
    """转换星系数据为字典"""
    return {
        "seed_id": galaxy.seed_id,
        "star_num": galaxy.star_num,
        "resource_index": galaxy.resource_index,
        "resource_rate": galaxy.resource_rate,
        "stars": [{
            "star_index": star.star_index,
            "name": star.name,
            "type": star.type,
            "type_id": star.type_id,
            "seed": star.seed,
            "dyson_lumino": star.dyson_lumino,
            "dyson_radius": star.dyson_radius,
            "distance": star.distance,
            "pos_m": star.pos_m,
            "pos_ly": star.pos_ly,
            "planets": [convert_planet(p) for p in star.planets],
            "veins_point": star.veins_point,
            "veins_amount": star.veins_amount,
            "gas_veins": star.gas_veins,
            "liquid": star.liquid
        } for star in galaxy.stars],
        "veins_point": galaxy.veins_point,
        "veins_amount": galaxy.veins_amount,
        "gas_veins": galaxy.gas_veins,
        "liquid": galaxy.liquid
    }


@app.post("/api/seed")
async def get_seed_data(request: SeedRequest):
    """
    获取种子数据（完整计算，包含矿脉）
    """
    try:
        seed = Seed(request.seed_id, request.star_num, request.resource_index)
        galaxy_data = get_galaxy_data_c(seed, False)  # False = 完整计算
        return convert_galaxy(galaxy_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/health")
async def health_check():
    """健康检查"""
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
