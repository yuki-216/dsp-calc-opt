"""
运行均值算法验证脚本

对指定种子范围，用两条独立路径计算统计：
  方法A 简单平均：累加全部原始字段，最后除以种子数  （sum/N）
  方法B 运行均值：系统实际使用的 RunningAverageCalculator（增量更新 avg += (x-avg)/count）
对比每个恒星数量组、每个恒星位置、每个字段的误差，判定是否 < 0.01%。

用法：
    python verify_stats.py [--start 1] [--end 100] [--batch 20] [--data-dir ...]
输出报告写入 <data-dir>/verification/ 目录。

注意：走真实源项目 GetDataManager 精确计算，1-100 种子 × 33 恒星数 ≈ 3300 次 galaxy
生成，约需 15-25 分钟。
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Tuple

BACKEND_DIR = Path(__file__).resolve().parent
os.chdir(BACKEND_DIR)
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
SEED_VIEWER_PATH = r"D:\编程\种子查看器"
if SEED_VIEWER_PATH not in sys.path:
    sys.path.insert(0, SEED_VIEWER_PATH)

from batch_calculator import RESOURCE_INDEX  # 1倍资源
from stats_calculator import RunningAverageCalculator
from dsp_search_seed.CApi.search_seed import do_init_c, GetDataManager, Seed

STAR_NUMS = list(range(32, 65))
VEIN_COUNT = 14
GAS_COUNT = 3
LIQUID_COUNT = 2

# 参与对比的字段清单
SCALAR_FIELDS = ["avg_distance", "avg_dyson_radius", "avg_dyson_lumino"]
ARRAY_FIELDS = [
    ("avg_veins_point", VEIN_COUNT),
    ("avg_veins_amount", VEIN_COUNT),
    ("avg_gas_veins", GAS_COUNT),
    ("avg_liquid", LIQUID_COUNT),
]


class SimpleAverageAccumulator:
    """方法A：简单平均累加器。按恒星位置（距离升序）累加全部原始字段，最后除以 N。"""

    def __init__(self, star_num: int):
        self.star_num = star_num
        self.count = 0
        self.stars: List[Dict] = []
        for _ in range(star_num):
            self.stars.append({
                "avg_distance": 0.0,
                "avg_dyson_radius": 0.0,
                "avg_dyson_lumino": 0.0,
                "avg_veins_point": [0.0] * VEIN_COUNT,
                "avg_veins_amount": [0.0] * VEIN_COUNT,
                "avg_gas_veins": [0.0] * GAS_COUNT,
                "avg_liquid": [0.0] * LIQUID_COUNT,
            })

    def add(self, galaxy) -> None:
        stars = sorted(galaxy.stars, key=lambda s: s.distance)
        for i, st in enumerate(stars):
            if i >= self.star_num:
                break
            slot = self.stars[i]
            slot["avg_distance"] += st.distance
            slot["avg_dyson_radius"] += st.dyson_radius
            slot["avg_dyson_lumino"] += st.dyson_lumino
            for k in range(VEIN_COUNT):
                slot["avg_veins_point"][k] += st.veins_point[k]
                slot["avg_veins_amount"][k] += st.veins_amount[k]
            for k in range(GAS_COUNT):
                slot["avg_gas_veins"][k] += st.gas_veins[k]
            for k in range(LIQUID_COUNT):
                slot["avg_liquid"][k] += st.liquid[k]
        self.count += 1

    def finalize(self) -> List[Dict]:
        """除以种子数得到均值"""
        if self.count == 0:
            return self.stars
        result = []
        for slot in self.stars:
            result.append({
                "avg_distance": slot["avg_distance"] / self.count,
                "avg_dyson_radius": slot["avg_dyson_radius"] / self.count,
                "avg_dyson_lumino": slot["avg_dyson_lumino"] / self.count,
                "avg_veins_point": [v / self.count for v in slot["avg_veins_point"]],
                "avg_veins_amount": [v / self.count for v in slot["avg_veins_amount"]],
                "avg_gas_veins": [v / self.count for v in slot["avg_gas_veins"]],
                "avg_liquid": [v / self.count for v in slot["avg_liquid"]],
            })
        return result


def relative_error(a: float, b: float) -> float:
    """相对误差：|a-b| / max(|a|,|b|)；两者皆 0 记 0"""
    num = abs(a - b)
    den = max(abs(a), abs(b))
    if den == 0:
        return 0.0 if num == 0 else float("inf")
    return num / den


def collect_errors(running: RunningAverageCalculator,
                   simple: Dict[int, List[Dict]],
                   counts: Dict[int, int]) -> Tuple[List[Dict], float]:
    """对比运行均值与简单平均，返回问题清单与最大相对误差"""
    issues: List[Dict] = []
    max_err = 0.0
    for n in STAR_NUMS:
        if n not in simple or counts.get(n, 0) == 0:
            continue
        c = running.stats[n].stars_stats
        s = simple[n]
        for i in range(n):
            r_star, s_star = c[i], s[i]
            for field in SCALAR_FIELDS:
                err = relative_error(getattr(r_star, field), s_star[field])
                max_err = max(max_err, err)
                if err > 1e-4:
                    issues.append({"star_num": n, "star_idx": i, "field": field,
                                   "running": getattr(r_star, field), "simple": s_star[field],
                                   "rel_err": err})
            for field, count in ARRAY_FIELDS:
                r_arr = getattr(r_star, field)
                s_arr = s_star[field]
                for k in range(count):
                    err = relative_error(r_arr[k], s_arr[k])
                    max_err = max(max_err, err)
                    if err > 1e-4:
                        issues.append({"star_num": n, "star_idx": i, "field": f"{field}[{k}]",
                                       "running": r_arr[k], "simple": s_arr[k], "rel_err": err})
    return issues, max_err


def run_verification(start_seed: int, end_seed: int, batch_size: int, data_dir: str) -> int:
    do_init_c()
    t0 = time.time()

    running = RunningAverageCalculator()
    simple: Dict[int, SimpleAverageAccumulator] = {n: SimpleAverageAccumulator(n) for n in STAR_NUMS}
    counts = {n: 0 for n in STAR_NUMS}

    manager = GetDataManager(max(1, (os.cpu_count() or 4) - 1), False, 128)
    total = 0
    for sid in range(start_seed, end_seed + 1):
        for n in STAR_NUMS:
            manager.add_task(Seed(sid, n, RESOURCE_INDEX))
            total += 1
    try:
        done = 0
        while done < total:
            results = manager.get_results()
            if not results:
                time.sleep(0.05)
                continue
            for g in results:
                running.process_galaxy(g)
                if g.star_num in simple:
                    simple[g.star_num].add(g)
                    counts[g.star_num] += 1
                done += 1
    finally:
        manager.shutdown()

    # 转为简单平均结果
    simple_final = {n: acc.finalize() for n, acc in simple.items()}

    issues, max_err = collect_errors(running, simple_final, counts)

    elapsed = time.time() - t0
    result = {
        "start_seed": start_seed,
        "end_seed": end_seed,
        "resource_index": RESOURCE_INDEX,
        "elapsed_seconds": round(elapsed, 1),
        "galaxies_computed": total,
        "seed_counts": counts,
        "max_relative_error": max_err,
        "pass_threshold": 1e-4,
        "passed": max_err <= 1e-4,
        "issue_count": len(issues),
        "sample_issues": issues[:20],
    }

    # 写报告
    ver_dir = os.path.join(data_dir, "verification")
    os.makedirs(ver_dir, exist_ok=True)
    with open(os.path.join(ver_dir, "comparison.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    # 简单平均结果（结构化存档，便于人工核查）
    with open(os.path.join(ver_dir, "simple_avg.json"), "w", encoding="utf-8") as f:
        json.dump({"star_nums": {
            str(n): {"seed_count": counts[n], "stars_stats": simple_final[n]}
            for n in STAR_NUMS if counts.get(n, 0) > 0
        }}, f, ensure_ascii=False, indent=2)

    print("=" * 56)
    print(f"验证范围: seed {start_seed}-{end_seed} | 计算 galaxy: {total} | 耗时: {elapsed:.1f}s")
    print(f"各恒星数种子计数: {counts}")
    print(f"最大相对误差: {max_err:.2e}  (通过阈值: 1.00e-4 = 0.01%)")
    print(f"超限字段数: {len(issues)}")
    if issues:
        for it in issues[:10]:
            print(f"  [star_num={it['star_num']} 星位={it['star_idx']} 字段={it['field']}] "
                  f"运行={it['running']:.6f} vs 简单={it['simple']:.6f} err={it['rel_err']:.2e}")
    print("conclusion: " + ("PASS" if result["passed"] else "FAIL"))
    print("=" * 56, flush=True)
    return 0 if result["passed"] else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="运行均值算法验证")
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--end", type=int, default=100)
    parser.add_argument("--batch", type=int, default=20, help="GetDataManager 并发任务批次（控制占比，非进度粒度）")
    parser.add_argument("--data-dir", default=str(BACKEND_DIR / "data" / "seed_stats"))
    args = parser.parse_args()
    return run_verification(args.start, args.end, args.batch, args.data_dir)


if __name__ == "__main__":
    sys.exit(main())