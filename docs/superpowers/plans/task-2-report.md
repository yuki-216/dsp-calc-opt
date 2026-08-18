# Task 2 Report: 创建统计数据存储

## 实现内容

创建了 `StatsStorage` 类，提供以下功能：

- **初始化**：创建数据目录和默认进度文件 (`progress.json`)
- **进度管理**：`save_progress()` / `load_progress()` 保存和加载计算进度
- **统计结果管理**：`save_stats()` / `load_stats()` 保存和加载按恒星数量分组的统计结果
- **验证数据管理**：`save_verification_data()` 保存简单均值、运行均值和比较结果

存储格式为 JSON 文件，每个恒星数量组一个文件 (`stats_{star_num}.json`)，验证数据存放在 `verification/` 子目录。

## 测试内容

编写了 10 个测试用例，全部通过：

| 测试 | 描述 |
|------|------|
| `test_stats_storage_initialization` | 验证初始化创建目录和默认进度文件 |
| `test_stats_storage_save_progress` | 验证保存进度数据完整性 |
| `test_stats_storage_load_progress` | 验证加载进度数据 |
| `test_stats_storage_load_progress_not_exists` | 验证进度文件不存在时返回 None |
| `test_stats_storage_save_stats` | 验证保存统计结果（多恒星数量组） |
| `test_stats_storage_load_stats` | 验证加载统计结果数据 |
| `test_stats_storage_load_stats_not_exists` | 验证统计文件不存在时返回 None |
| `test_stats_storage_save_verification_data` | 验证保存验证数据（创建目录和文件） |
| `test_stats_storage_save_stats_skips_empty` | 验证跳过无数据的恒星数量组 |
| `test_stats_storage_verification_data_content` | 验证验证数据内容正确性 |

Task 1 的 9 个测试也全部通过，无回归。

## 变更文件

- `backend/stats_storage.py` — 新建，`StatsStorage` 类实现
- `backend/test_stats_storage.py` — 新建，10 个测试用例

## 自我审查发现

- 移除了未使用的 `from pathlib import Path` 导入
- 接口完全符合任务简报中指定的 API
- `save_stats()` 正确跳过 `seed_count == 0` 的空组

## 问题或疑虑

无。
