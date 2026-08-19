#ifndef WASM_API_HPP
#define WASM_API_HPP

#include <string>
#include "data_struct.hpp"

/**
 * WebAssembly导出函数接口
 * 用于在浏览器中调用C++种子生成算法
 */

extern "C" {
    /**
     * 初始化WebAssembly模块
     * 必须在调用其他函数之前调用
     */
    void init();

    /**
     * 获取种子数据
     * @param seedId 种子ID
     * @param starNum 恒星数量（1-128）
     * @param resourceIndex 资源倍率索引（0-10）
     * @return JSON格式的种子数据字符串
     */
    const char* getSeedData(int seedId, int starNum, int resourceIndex);

    /**
     * 格式化数量显示
     * @param number 数量
     * @return 格式化后的字符串（如 "1.23B", "456M", "789K"）
     */
    const char* formatAmount(long long number);

    /**
     * 获取矿脉类型名称
     * @param index 矿脉索引（0-13）
     * @return 矿脉类型名称
     */
    const char* getVeinName(int index);

    /**
     * 获取恒星类型名称
     * @param typeId 恒星类型ID
     * @return 恒星类型名称
     */
    const char* getStarTypeName(int typeId);

    /**
     * 获取行星类型名称
     * @param typeId 行星类型ID
     * @return 行星类型名称
     */
    const char* getPlanetTypeName(int typeId);

    /**
     * 获取资源倍率值
     * @param index 资源倍率索引（0-10）
     * @return 资源倍率值
     */
    double getResourceRate(int index);

    /**
     * 检查种子数据是否有效
     * @param seedId 种子ID
     * @param starNum 恒星数量
     * @param resourceIndex 资源倍率索引
     * @return 1表示有效，0表示无效
     */
    int isSeedDataValid(int seedId, int starNum, int resourceIndex);
}

#endif // WASM_API_HPP
