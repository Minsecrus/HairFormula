# 染发配色模拟器：执行总指挥
> **版本**：v0.1  
> **日期**：2026-08-09  
> **用途**：作为产品、算法、数据、实验与开发的单一执行基准（Single Source of Truth）  
> **核心定位**：不是“RGB 调色小游戏”，而是一个逐步升级为**基于真实染膏/头发实测数据的配方→发色预测系统**。

---

## 0. 一句话总纲

我们要做的是：

> **选择当前头发底色 + 选择具体染膏 + 输入红/粉/紫/蓝等配比 → 预测最终发色、Lab/sRGB、置信度与误差范围，并明确告诉用户结果是“实测覆盖 / 插值 / 外推”。**

产品可理解为：

> **“真实染膏版 Trycolors” + “头发基底模型” + “专业染发工作流”。**

第一阶段不追求“万能预测所有品牌所有染法”，而要把一个**可验证的小闭环**做准。

---

# 1. 已经确认的关键判断

## 1.1 不能用 RGB 平均作为真实染发模型

RGB/HEX 是显示颜色，不是物理染料属性。

一个类似：

```text
红 5 + 粉 3 + 紫 1 + 蓝 0.2
```

如果直接做：

```text
RGB_mix = Σ(weight × RGB) / Σweight
```

只能得到“屏幕色块的数学平均”，不能可靠预测真实染膏混合或上头效果。

**RGB 模型只允许存在于：**
- 最低保真 Demo；
- UI 快速反馈；
- 算法故障时 fallback；
- 与物理模型做对照实验。

**禁止把 RGB 平均结果称为“真实染发预测”。**

---

## 1.2 “染膏混合色”和“染到头发后的颜色”必须拆成两层

至少拆成：

```text
染膏/染料配方
    ↓
染料混合光学结果
    ↓
当前头发基底 + 吸附/沉积/穿透
    ↓
最终头发反射光谱
    ↓
XYZ → Lab/LCh → sRGB
```

相同配方：

```text
红 5 : 粉 3 : 紫 1 : 蓝 0.2
```

在：
- 10 度近白底；
- 9 度黄底；
- 8 度黄橙底；
- 6 度橙底；

上头结果不会相同。

因此**底色不是可选参数，而是模型核心输入。**

---

## 1.3 “Tinting Strength”思想是对的，但不应只依赖一个 1–100 数字

蓝、紫等颜色经常呈现很强的“抢色”现象。

可以在 UI 中显示：

```text
红 Strength 54
粉 Strength 37
紫 Strength 71
蓝 Strength 93
```

但后台最好最终使用：

```text
Strength_i(λ, concentration, substrate)
```

即：
- 随波长变化；
- 随浓度变化；
- 随头发基底/孔隙度变化。

单一 Strength 数字只做：
- 简化参数；
- 可解释 UI；
- 小数据阶段的可学习系数。

---

## 1.4 Kubelka–Munk（K-M）是目前最适合拿来做 V0 光谱混色核心的公开路线

Trycolors 2026 年公开介绍了它的 PRO 引擎：

每个波长 λ 下，颜料具有：
- `K(λ)`：吸收；
- `S(λ)`：散射。

反射率与 K/S 的经典关系：

\[
\frac{K}{S} = \frac{(1-R)^2}{2R}
\]

多种色料混合：

\[
K_{mix}(\lambda)=\sum_i c_iK_i(\lambda)
\]

\[
S_{mix}(\lambda)=\sum_i c_iS_i(\lambda)
\]

然后：

\[
q(\lambda)=\frac{K_{mix}(\lambda)}{S_{mix}(\lambda)}
\]

无限厚不透明层近似下：

\[
R_\infty(\lambda)
=
1+q-\sqrt{q^2+2q}
\]

再将反射光谱通过标准照明与观察者函数转换：

```text
Reflectance
→ XYZ
→ CIELAB / LCh
→ sRGB
```

注意：单次反射测量直接得到的是 `K/S` 比值，不足以单独确定 K 与 S；Trycolors 的公开方法说明其 K、S 指纹由**单颜料 tint ladder（梯度混白样本）**拟合，再用未参与拟合的混色样本做验证。

**对我们而言：**
- K-M 先作为“色料层”基础；
- “头发层”不能简单照搬不透明油漆模型，必须另建基底/吸附修正。

---

# 2. 竞品拆解结论

## 2.1 CalcMora — Hair Color Mixing Calculator

已确认公开输入：
- Level 1–10；
- Tone/Reflect；
- 多个 shade；
- 克数；
- Developer volume；
- 染膏:developer 比例；
- 结果 Level / Tone / Live Swatch。

公开核心规则：

\[
Level_{mix}
=
\frac{\sum_i g_i Level_i}{\sum_i g_i}
\]

Tone 使用色轮式规则：
- 相近色 → 混合/强化；
- 互补色 → 中和；
- 例如 Ash 对橙、Violet 对黄、Matte/Green 对红。

### 判断

CalcMora 更像：

> **“专业染发 Level/Tone 规则计算器 + 色块展示”**

公开输入中没有真正描述当前头发的完整光谱/底色、孔隙度、历史染色情况，因此不能把其结果理解成完整物理上头预测。

### 我们借鉴

借：
- Level/Tone 规则；
- 配方克数；
- developer 计算；
- 结果表达；
- 简洁 UI。

不借：
- 把 Level 加权平均当作真实色彩引擎；
- 把 Live Swatch 当作实验级颜色。

---

## 2.2 Blendsor

网页 Mixing Calculator 公开规则同样是：

\[
Level_{mix}
=
\frac{\sum_i w_iLevel_i}{\sum_i w_i}
\]

Tone/Reflect：
- 相似 → reinforce；
- 邻近 → blend；
- 互补 → neutralize。

Blendsor 的更完整 App 宣称会考虑：
- 当前 level；
- reflect；
- porosity；
- hair condition；
- color history；
- gray；
- thickness 等。

但 App 的具体权重/私有模型没有公开。

### 我们借鉴

- 专业美发师输入方式；
- hair history / porosity 等变量；
- 公式工作流；
- 品牌/产品线维度。

### 原则

**不需要、也不应该逆向私有后端模型。**  
我们只复现公开的通用色彩规则，然后用自己的实测数据建立独立模型。

---

## 2.3 Trycolors

### Basic

官方 API 示例显示：

```json
{
  "colors": [
    {"hex":"#FFAA16","count":1},
    {"hex":"#BA12FF","count":1}
  ],
  "mixerMode":"basic"
}
```

输出：

```text
#DD5E8B
```

该例与 RGB 各通道 1:1 平均完全一致。

因此可把 Basic 理解为至少在该示例中符合传统数字颜色混合。

### PRO

公开使用：
- Kubelka–Munk；
- 实测颜料光谱；
- K(λ)、S(λ)；
- tint ladder 标定；
- 未参与拟合的实际混色做验证；
- Lab/ΔE 验证。

官方 2026 页面称其自有实验组的预测达到约 `ΔE < 3` 的水平。  
**这是 Trycolors 自己的验证结果，不能直接视为我们系统的精度。**

### Tinting Strength

Trycolors 有 `Tinting Strength Mode`，官方 API 也有：
- `tintingStrength`
- `tintingStrengthMode`
- `tintingStrengthAlgorithm`

但目前**未发现官方公开完整的“每个颜料默认 Strength 数值表 / 神经网络权重 / 完整训练集”**。

因此：
- 学其校准思想；
- 不依赖其私有 strength 数据；
- 我们建立 `Hair Dye Strength`。

---

# 3. 已掌握的公开数据资源

---

## 3.1 RIT Artist Paint Spectral Database

来源：Rochester Institute of Technology。

已确认：
- Golden Heavy Body Acrylic；
- 使用积分球分光光度计；
- 反射率测量 `380–750 nm`；
- `10 nm` 间隔；
- 多次测量取平均；
- 数据体系包含光谱、色度、吸收、散射等信息。

其中包含非常适合作为四原色代理的颜料，例如：

```text
红   → Pyrrole Red / PR254
粉/洋红 → Quinacridone Magenta / PR122
紫   → Dioxazine Purple / PV23
蓝   → Ultramarine / PB29 或 Phthalo Blue / PB15 系
```

### 用途

**V0 不做头发实验也可以先用这些数据把完整光谱混色引擎跑通。**

目标不是声称“颜料=染发剂”，而是验证：

```text
数据加载
→ K/S 或 K/S 模型
→ 比例混合
→ 光谱
→ Lab
→ ΔE
→ UI
```

整条管线是否正确。

---

## 3.2 LBNL Pigment Database

来源：Lawrence Berkeley National Laboratory。

非常有价值，因为不只有单色。

已确认存在：
- masstone；
- 与白色 `1:4` tint；
- 与白色 `1:9` tint；
- 部分非白色颜料之间的 `1:1` 实际混合；
- 光谱数据文件。

例如 Dioxazine Purple PV23 页面就同时提供：
- 紫色原色；
- 1:4 tint；
- 1:9 tint；
- 和其他非白颜料 1:1 实混的光谱。

### 用途

这是我们验证 K-M 引擎的好数据：

```text
只用单色/tint 数据估参数
→ 预测 1:1 实际混合
→ 与 LBNL 真值光谱比较
```

这样能在还没有染发束实验时先检查算法是否实现正确。

---

## 3.3 黑加仑花青素染发实验（Rose et al., 2018）

这是目前特别接近“染料浓度→头发颜色”的公开实验。

已确认研究了：
- 漂浅真人头发；
- 黑加仑花青素；
- 多浓度染色；
- K/S 可见光谱；
- 染料吸附；
- Freundlich adsorption isotherm。

公开浓度包括：

```text
0.5% omf → 2.7 mg anthocyanin / g hair
1.0% omf → 5.5 mg/g
2.0% omf → 10.9 mg/g
4.0% omf → 21.9 mg/g
10.0% omf → 54.7 mg/g
```

最终在头发上的蓝色染色具有约 `580 nm` 的色强峰特征。

### 用途

这非常适合验证：

> **浓度并不一定与视觉颜色线性变化。**

也可作为第一版：

```text
concentration
→ adsorption
→ K/S change
```

模型参考。

---

## 3.4 Basic Brown 16 半永久染发实验（Yun & Ahn, 2023）

已确认：
- Basic Brown 16；
- 白发与漂后头发；
- 不同表面活性剂配方；
- 染后颜色与耐洗；
- CIELAB；
- K/S / color strength；
- 分光测量体系。

论文显示：
- 头发基底差异重要；
- 配方介质也会改变染色；
- pH/表活等不是可以永远忽略的变量。

### 用途

帮助我们建立一个重要原则：

> **“具体染料名称 + 比例”仍然不足以唯一预测结果；配方体系同样属于模型条件。**

所以数据库必须保存 `product / formulation / dye type`，不能只保存“红、蓝”两个字。

---

## 3.5 Leeds / Aveda 2025–2026 头发染料研究

2025 方法研究将：
- 分光测色；
- K/S；
- ΔE；
- HPLC 实际染料脱附量；

结合起来。

一个关键结果：

对不同背景头发，直接用未归一化 ΔE 或 K/S 并不能稳定代表实际染料损失；减掉头发本底后得到的 normalized color loss 与 HPLC 染料脱附量呈很强相关，报告中有：

```text
R² = 0.9783
```

2026 的工作进一步建立加速 `48-wash` 分析方法，并继续将分光色强和实际染料脱附联系起来。

### 用途

为以后增加：

```text
洗 1 次
洗 5 次
洗 10 次
...
预计褪色曲线
```

提供方法论基础。

---

# 4. 我们自己的算法路线

---

# 4.1 V0 — 光谱混色原型

目标：

> **证明我们的“色料混合引擎”不是 RGB 玩具。**

输入：

```text
红比例
粉比例
紫比例
蓝比例
```

先归一化：

\[
c_i = \frac{w_i}{\sum_j w_j}
\]

使用公开颜料代理数据：

```text
PR254 / PR122 / PV23 / PB15
```

实现 K-M 光谱混合。

输出：
- Reflectance spectrum；
- XYZ；
- Lab；
- LCh；
- sRGB；
- HEX；
- 配方比例。

### V0 禁止声称

> “这就是染到头发上的颜色。”

正确文案：

> “光谱混色模型预览 / 尚未进行头发基底校准。”

---

# 4.2 V0.5 — 加入头发底色

我们必须获得/建立每种底色的真实反射光谱：

```text
Base 6
Base 7
Base 8
Base 9
Base 10
```

不要只用：

```text
Base 9 = #F1D77B
```

正确输入应为：

```text
R_base(λ)
```

第一版头发模型建议采用**经验层 + 物理层混合**，不要强行宣称纯 K-M 就能解释纤维头发。

概念模型：

\[
R_{final}(\lambda)
=
F(
R_{base}(\lambda),
D_{mix}(\lambda),
amount,
porosity,
processing
)
\]

其中 `F` 必须由真实发束数据拟合。

### 小数据阶段可以先做

以 optical density / color strength 增量为学习目标：

```text
ΔOD(λ) 或 Δ(K/S)(λ)
```

而不是直接预测 RGB。

---

# 4.3 V1 — 单品牌真实染膏模型

不要一开始支持全世界品牌。

选择：
- 一个具体品牌；
- 一个具体产品线；
- 最好先选直接染 / 半永久 vivid colors；
- 红、粉、紫、蓝四个基础色；
- 固定操作条件。

数据库键：

```text
brand
line
sku
batch(optional)
dye_type
base_hair
ratio
total_amount
processing_time
temperature
pH(optional)
porosity
pre_history
```

输出真值：

```text
reflectance spectrum
L*
a*
b*
LCh
```

---

# 4.4 V2 — 泛化模型

后续再加入：
- 更多品牌；
- 更多色号；
- permanent / oxidative hair color；
- developer；
- gray coverage；
- lift；
- 头发历史；
- 不同发质；
- 染后洗涤。

**氧化型永久染发和直接染不能在一开始混成同一个模型。**

它们的化学过程不同，应分模型/分产品域。

---

# 5. Hair Dye Strength：我们的定义

初期定义可学习标量：

\[
w_i' = c_i \cdot s_i
\]

其中：

```text
c_i = 配方浓度
s_i = Hair Dye Strength
```

例如：

```text
red    1.00
pink   0.70
violet 1.30
blue   2.40
```

则：

```text
blue = 0.2 × 2.4 = 0.48 effective units
```

解释了为什么“小量蓝”仍可能显著抢色。

---

## 最终升级

不再用单值：

\[
s_i
\]

而使用：

\[
s_i(\lambda,c,b,p)
\]

其中：
- λ：波长；
- c：浓度；
- b：头发基底；
- p：孔隙度/处理状态。

即：

> **Hair Dye Strength Spectrum / Response Curve**

---

# 6. 实验设计：最低成本闭环

## 6.1 第一阶段不要暴力穷举全部比例

四种颜色是 mixture problem。

建议用 mixture DOE / simplex 思路选样本。

一个底色至少做：

### 顶点

```text
R 100%
P 100%
V 100%
B 100%
```

### 两两关键混合

```text
R:P
R:V
R:B
P:V
P:B
V:B
```

每组可选择：
- 1:1；
- 必要时补 3:1 / 1:3。

### 中心/复合点

例如：

```text
1:1:1:1
5:3:1:0.2
5:3:1:0.5
4:2:2:0.5
```

其中 `5:3:1:0.2` 是我们最初讨论的莓果红案例，非常适合做“项目基准配方”。

---

## 6.2 底色

第一轮优先：

```text
8度
9度
10度
```

如果预算允许补 7 度。

原因：鲜艳红/粉/紫/蓝主要应用在较浅底色，先把核心域做准。

---

## 6.3 必须严格固定

实验中统一：
- 同品牌同产品线；
- 同批次尽量一致；
- 同一类标准发束；
- 每束重量；
- 染膏总量/发束重量比；
- 染色时间；
- 温度；
- 冲洗流程；
- 洗发产品；
- 干燥时间；
- 测量环境；
- 分光仪 geometry / illuminant / observer。

否则噪声会吃掉模型。

---

## 6.4 测量优先级

### 最佳

分光光度计：

```text
R(λ)
```

建议至少覆盖可见光，例如：
- 380–750 nm，或
- 400–700 nm；
- 10 nm 间隔即可完成第一版。

### 次优

专业色度计输出：
- Lab；
- ΔE。

### 不推荐作为真值

手机照片 RGB。

手机只能用于：
- UI 预览；
- 用户输入；
- 辅助视觉数据。

不能作为实验数据库的唯一真值。

---

# 7. 训练 / 拟合目标

优先预测：

```text
reflectance spectrum
```

其次：

```text
Lab
```

最后才是：

```text
sRGB / HEX
```

原因：

```text
光谱
→ 可以计算不同照明下颜色
→ 可以算 Lab
→ 可以转换屏幕
```

反过来：

```text
RGB
→ 无法唯一恢复真实光谱
```

这是 metamerism（同色异谱）问题的直接结果。

---

# 8. 验证指标

每次模型版本必须保留未训练的真实发束做测试。

至少报告：

### 8.1 CIEDE2000

\[
\Delta E_{00}
\]

### 8.2 光谱误差

例如：

```text
RMSE_reflectance
MAE_reflectance
```

### 8.3 分量误差

```text
ΔL*
Δa*
Δb*
ΔC*
Δh
```

### 8.4 按区域分组

必须分别看：

```text
红区
粉区
紫区
蓝区
浅底
深底
低蓝比例
高蓝比例
```

因为全局平均误差可能掩盖“蓝一加就崩”的情况。

---

# 9. 内部精度目标（产品 KPI，不是科学定律）

建议：

```text
V0 颜料代理模型：
目标：证明 pipeline + LBNL/RIT 混色验证正确

V1 单品牌/限定底色：
median ΔE00 < 5

V1.5 优化：
median ΔE00 < 3~4

超出训练域：
必须显示低置信度，不能给“精准”承诺
```

不要把 `ΔE=3` 写成绝对的人眼可见性边界；感知阈值受颜色、环境、观察条件等影响。

---

# 10. 置信度系统

网站必须同时预测：

```text
颜色
+
“我们有多相信这个预测”
```

建议分三档：

### A — 实测覆盖

用户配方非常接近数据库样本：

```text
✅ 实测数据覆盖
```

### B — 插值

处于多个实测样本之间：

```text
🟡 模型插值
```

### C — 外推

超出：
- 底色；
- 品牌；
- 配比；
- 浓度；
- 发质；

覆盖范围：

```text
⚠️ 超出实验范围，仅供参考
```

这一机制是产品可信度的核心，不是装饰。

---

# 11. 数据库 Schema

建议最小结构：

```text
experiment_id

# Hair
hair_source
hair_type
natural_color
bleach_level
base_L
base_a
base_b
base_reflectance[]

porosity
previous_treatment

# Dye
brand
line
product_type

red_sku
red_g
pink_sku
pink_g
violet_sku
violet_g
blue_sku
blue_g

developer_product
developer_volume
developer_g

# Process
hair_mass_g
total_dye_g
processing_time_min
temperature_c
pH
rinse_protocol
dry_protocol

# Output
final_L
final_a
final_b
final_reflectance[]

deltaE_from_base

# Metadata
operator
instrument
instrument_geometry
illuminant
observer
replicate
date
notes
```

所有光谱必须同时保存 wavelength 数组或统一固定波长规范。

---

# 12. 网站 MVP

首页只做一件事：

> **“我这样调，会是什么颜色？”**

---

## 左侧：头发

```text
当前底色
○ 7
○ 8
● 9
○ 10
```

高级选项：

```text
偏黄 / 偏橙 / 中性
孔隙度
染色历史
```

---

## 中间：配方

例如：

```text
🔴 红    50 g
🩷 粉    30 g
🟣 紫    10 g
🔵 蓝     2 g
```

自动显示：

```text
5 : 3 : 1 : 0.2
```

支持：
- slider；
- 克数；
- 百分比；
- 锁定某个颜色；
- 总量自动换算。

---

## 右侧：结果

必须同时显示：

```text
预计色名：冷莓果红

Lab
LCh
HEX

预测类型：模型插值
数据覆盖度：★★★★☆

最近实测配方：
红 5 / 粉 3 / 紫 1 / 蓝 0.25
底色：9
```

再显示：
- 纯色 swatch；
- 头发纹理预览。

---

# 13. UI 中必须出现的科学免责声明

建议固定：

> **颜色预览为模型估计，不等于实体染发保证。实际结果受头发底色、残留色素、孔隙度、品牌配方、用量、处理时间、氧化体系和显示设备影响。首次使用配方请进行发束测试，并遵循产品说明。**

屏幕方面：

> **显示统一以 sRGB 输出；设备色彩模式、护眼模式、亮度和屏幕校准仍可能造成视觉差异。**

---

# 14. 技术架构建议

## Frontend

```text
Next.js / React
TypeScript
Canvas/WebGL 可选（头发预览）
```

## Color Engine

建议独立 package：

```text
/packages/color-science
```

负责：
- spectrum；
- KM；
- XYZ；
- Lab；
- LCh；
- sRGB；
- ΔE00。

禁止把数学散落在 React component 内。

---

## Model API

Python：

```text
FastAPI
NumPy
SciPy
scikit-learn
PyTorch（到数据量足够再用）
```

早期数据小，不需要一上来神经网络。

优先：
- 可解释拟合；
- nonlinear least squares；
- Gaussian Process；
- spline / mixture regression；
- physics-informed residual model。

---

# 15. 模型推荐结构

长期建议：

\[
Prediction
=
PhysicsModel
+
LearnedResidual
\]

即：

```text
K-M / 光谱基础模型
      ↓
得到理论预测
      ↓
ML 学习“真实头发与理论模型之间的残差”
      ↓
最终光谱
```

比直接：

```text
四个比例 → 黑盒神经网络 → RGB
```

更稳。

优点：
- 小数据可用；
- 可解释；
- 外推不那么离谱；
- 容易诊断；
- 后续增加品牌更容易。

---

# 16. 第一版工程目录

```text
hair-color-sim/
├── apps/
│   └── web/
├── packages/
│   ├── color-science/
│   │   ├── spectrum.ts
│   │   ├── kubelkaMunk.ts
│   │   ├── xyz.ts
│   │   ├── lab.ts
│   │   ├── deltaE2000.ts
│   │   └── srgb.ts
│   └── shared/
├── model/
│   ├── datasets/
│   │   ├── raw/
│   │   ├── processed/
│   │   └── README.md
│   ├── src/
│   │   ├── pigment_proxy.py
│   │   ├── hair_substrate.py
│   │   ├── fit_strength.py
│   │   └── validate.py
│   └── notebooks/
├── experiments/
│   ├── protocol.md
│   └── data-template.csv
└── docs/
    ├── MASTER_PLAN.md
    ├── DATA_SOURCES.md
    └── MODEL_CARD.md
```

本文件建议直接作为：

```text
docs/MASTER_PLAN.md
```

---

# 17. 开发顺序：严格按这个来

## Step 1 — Color Science 单元测试

先实现：
- spectrum representation；
- spectrum → XYZ；
- XYZ → Lab；
- Lab → sRGB；
- ΔE00。

**没有测试通过，不做 UI。**

---

## Step 2 — K-M 引擎

实现：
- K/S；
- K、S mixture；
- opaque reflectance；
- proportions。

---

## Step 3 — RIT/LBNL 数据导入

做统一格式：

```text
pigment_id
wavelength
reflectance
K
S
```

---

## Step 4 — 外部真值验证

使用 LBNL：

```text
单色/tint 拟合
→ 预测公开 1:1 mixture
→ 算 spectral error / ΔE00
```

如果这一关不准：

**不要进入染发模型。先修光谱引擎。**

---

## Step 5 — 做 Web V0

四滑杆：

```text
红 / 粉 / 紫 / 蓝
```

第一版明确标：

```text
“颜料代理光谱模型”
```

---

## Step 6 — 建立头发底色光谱库

先做：

```text
8 / 9 / 10 度
```

---

## Step 7 — 第一批真实发束实验

固定一个品牌/产品线。

优先采：
- 单色；
- binary；
- 关键复合点。

---

## Step 8 — 拟合 Hair Dye Strength / substrate response

比较：

```text
scalar strength
vs
spectral strength
vs
physics + residual
```

选择验证集 ΔE00 最优且最稳定的模型。

---

## Step 9 — 加置信度

任何结果都返回：

```json
{
  "prediction": {},
  "confidence": {},
  "domain_status": "measured|interpolated|extrapolated"
}
```

---

## Step 10 — 才开始扩品牌

前一个品牌没有达到目标误差，不扩张。

---

# 18. 决策矩阵

| 问题 | 当前决定 |
|---|---|
| RGB 能不能做核心？ | **不能** |
| 是否使用光谱？ | **是** |
| V0 是否采用 K-M？ | **是** |
| K-M 能否直接等于头发模型？ | **不能，需 substrate/adsorption 层** |
| 是否复制 Trycolors 私有 Strength？ | **不需要** |
| 是否复制 Blendsor 私有模型？ | **不做** |
| 是否先全品牌？ | **不做** |
| 是否先做一个品牌？ | **是** |
| 是否区分 direct 与 oxidative？ | **必须** |
| 是否保存 Lab 即可？ | **不够，优先保存光谱** |
| 手机照片能否当实验真值？ | **不能** |
| 用户能否看到置信度？ | **必须** |

---

# 19. 当前“已确认 / 推断 / 待验证”清单

## 已确认

- CalcMora/Blendsor 网页计算器都公开使用 Level 加权平均 + 色轮 Tone 规则。
- Trycolors PRO 明确采用 Kubelka–Munk 光谱路线。
- Trycolors 公开描述了 tint ladder → K/S/K/S 指纹 → 实混验证的流程。
- RIT 有公开颜料光谱数据库，包含红、洋红、紫、蓝代理颜料。
- LBNL 数据库有 masstone、1:4、1:9 tint 和部分 1:1 非白色实混光谱。
- 公开头发研究确实存在 K/S、Lab、浓度、吸附、脱附等可利用数据。
- 头发本底必须从染后色强变化中被正确处理；Leeds/Aveda 数据对此有直接证据。

---

## 强推断 / 工程假设

- “红粉紫蓝”直接染体系可通过 `光谱物理模型 + 少量真实发束 residual` 达到实用精度。
- Hair Dye Strength 可以先用单一可学习参数，之后升级到光谱/浓度响应。
- 8–10 度底色足够作为第一阶段核心域。
- 单品牌 V1 会比“全品牌低精度”更有产品价值。

---

## 待验证

- 哪个商业 vivid hair dye 品牌最适合第一批实验。
- 商业直接染的 K/S 是否能稳定使用经典 opaque K-M 形式描述。
- 最合适的头发 substrate 方程。
- 孔隙度需要离散变量还是连续可测参数。
- 需要多少 mixture DOE 样本才能将中位 ΔE00 压到 <5。
- 用户手机拍照能否在加入色卡/白平衡校准后作为弱监督输入。
- 红/粉/紫/蓝的真实 Hair Dye Strength 是否随底色显著变化。

---

# 20. 不允许犯的错误

### 错误 1
“网站出来是这个 HEX，所以你染出来就是这个颜色。”

**禁止。**

---

### 错误 2
把 Trycolors 对油漆的精度直接继承给染发。

**禁止。**

---

### 错误 3
只拍几张手机照片就说建立了实验数据库。

**禁止。**

---

### 错误 4
混不同品牌/不同产品体系的数据却不记录品牌和配方。

**禁止。**

---

### 错误 5
训练集与测试集随机打散导致几乎相同配方同时出现在两边，造成虚假高精度。

验证集应按：
- 配方区域；
- 底色；
- 批次；
- 甚至实验日期；

做更严格 holdout。

---

### 错误 6
模型超出训练域还给高置信度。

**必须做 out-of-domain detection。**

---

# 21. 最终产品壁垒

真正的壁垒不是网页 UI，也不是 K-M 公式。

K-M 是公开知识。

真正的数据资产是：

```text
具体染膏 SKU
×
具体配比
×
具体头发底色光谱
×
具体处理条件
→
真实最终反射光谱
```

随着实验积累：

```text
几十组
→ 可用原型

几百组
→ 单品牌强模型

几千组
→ 多品牌 / 多发质 / 泛化模型
```

这份真实数据集，才是竞争对手最难复制的部分。

---

# 22. 产品北极星

最终用户不需要懂 K/S、Kubelka–Munk、CIELAB。

她只需要看到：

```text
当前底色：9 度偏黄

红     50g
粉     30g
紫     10g
蓝      2g

比例：
5 : 3 : 1 : 0.2

预计：
冷莓果红

数据状态：
🟡 实测范围内插值

可信度：
高

提示：
蓝增加到 4g 后会明显向紫莓色偏移
```

底下系统默默完成：

```text
光谱
→ 染料强度
→ 基底
→ 吸附/沉积
→ 模型残差
→ Lab
→ ΔE
→ sRGB
→ 置信度
```

这就是我们的目标。

---

# 23. 资料来源与用途

## Trycolors

- How Trycolors Works — Kubelka–Munk、K/S、tint ladder、实混验证、ΔE  
  https://trycolors.com/how-it-works

- Pro Mixer Mode  
  https://docs.trycolors.com/mixer/pro-mixer-mode

- API Endpoints — `tintingStrength`, `mixerMode`, API 示例  
  https://docs.trycolors.com/api-reference/endpoints

- Tinting Strength / Mixer docs  
  https://docs.trycolors.com/

---

## RIT

- Artist Paint Spectral Database  
  https://www.rit.edu/science/sites/rit.edu.science/files/2019-03/ArtistSpectralDatabase.pdf

用途：
- 光谱数据；
- 380–750 nm；
- Golden acrylic；
- 颜料代理；
- K-M 实现验证。

---

## LBNL

- Pigment Database — Dioxazine Purple 示例  
  https://coolcolors.lbl.gov/LBNL-Pigment-Database/paints/U14.html

用途：
- masstone；
- 1:4 / 1:9 tint；
- 1:1 非白混色；
- 光谱验证。

---

## Hair dye papers

### Rose et al., 2018
Application of Anthocyanins from Blackcurrant Fruit Waste as Renewable Hair Dyes

https://pubs.acs.org/doi/10.1021/acs.jafc.8b01044

Open repository:
https://eprints.whiterose.ac.uk/id/eprint/130478/

用途：
- 浓度；
- adsorption；
- K/S；
- hair dye strength 非线性；
- Freundlich model。

### Yun & Ahn, 2023
Effect of surfactant type on the dyeability and color resistance of semi-permanent basic hair dye

https://link.springer.com/article/10.1186/s40691-022-00326-4

用途：
- Basic Brown 16；
- 白发/漂后头发；
- CIELAB / K/S；
- 配方变量；
- wash resistance。

### Hetherington et al., 2025
Method to analyse and quantify the propensity of hair dyes to desorb from human hair fibre

https://eprints.whiterose.ac.uk/id/eprint/228156/

用途：
- HPLC；
- K/S；
- ΔE；
- hair background normalization；
- dye loss 定量。

### Hetherington et al., 2026
Analysis and quantification ... using an accelerated 48-wash method

https://eprints.whiterose.ac.uk/id/eprint/235854/

用途：
- wash-fastness；
- 48 wash；
- oxidative dye；
- 长期褪色模块。

---

## Hair calculator competitors

### CalcMora
https://calcmora.com/everyday-life/hair-color-mixing-calculator/

用途：
- Level weighted average；
- Tone rules；
- developer calculator；
- UI。

### Blendsor
https://blendsor.com/en/tools/hair-color-mixing-calculator/

用途：
- professional workflow；
- Level/Tone；
- hair history / porosity 产品思路。

---

# 24. 下一条执行命令

**不要继续讨论抽象概念。**

下一步直接做：

> **建立 `color-science` 原型，用 RIT/LBNL 数据跑通“红/洋红/紫/蓝 → K-M 光谱混合 → Lab/sRGB → 与公开实混光谱比较”的验证脚本。**

验收条件：

```text
[ ] 能加载至少 4 个代理颜料
[ ] 任意输入比例可生成完整反射光谱
[ ] 可输出 XYZ/Lab/LCh/sRGB
[ ] 实现 ΔE00
[ ] 可拿公开实混样本算预测误差
[ ] 所有公式有 unit test
[ ] 不使用 RGB 加权结果冒充物理模型
```

完成这一关之后，再进入：

> **Hair Substrate Model + 第一批真实发束实验。**

---

# END — 执行原则

> **先可验证，再智能；先一个品牌做准，再扩张；先光谱，再 RGB；永远区分实测、插值与外推。**
