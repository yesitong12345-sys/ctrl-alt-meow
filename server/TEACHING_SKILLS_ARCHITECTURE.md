# 教学技能架构

```text
题目文字 / 图片识别 IR / 学生当前表达
                    │
                    ▼
       education-problem-ir/v1
     （实体、关系、目标、已知、卡点）
                    │
                    ▼
         Teaching Coach Agent
   观察 → 提示 → 操作 → 推理 → 验证 → 总结
           │         │          │
           ▼         ▼          ▼
  解析几何技能   化学反应技能   既有立体几何技能
  Canvas + SymPy 选择性 3D     Three.js + SymPy
```

## 设计约束

1. 题目 IR 是事实源；AI 推导出的辅助构造标记为 `derived-by-teaching-coach`。
2. 辅助构造带 `reason` 和 `revealAt`，画板按教学步骤增量显示。
3. 模板是执行能力，不负责决定何时调用；Teaching Coach 负责教学选择。
4. 化学 3D 不是默认输出。配平优先守恒表，氧化还原优先电子转移图，能量问题优先反应进程曲线，机理/原子去向才使用 3D。
5. 每个技能保留自己的 kernel、schema 与模板，统一层只消费稳定的 IR 和计划接口。

## 稳定接口

`POST /v1/teaching-coach/plan`

输入：

- `questionText`: 原题文字；
- `studentMessage`: 学生当前想法或卡点；
- `problemIR`: 可选，上游视觉/人工校验后的结构化题目事实。

输出：

- `problemIR`: 本轮采用的事实源；
- `skill`, `knowledgePoint`, `studentNeed`, `strategy`；
- `teachingPath`: 六阶段教学路径；
- `scoringRubric`: 当前题独立得分点；
- `visualization`: 可视化模式、调用理由、动态构造与执行补丁；
- `verification`: 确定性 kernel 与验收检查。
