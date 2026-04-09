# Web 多语言与明暗模式设计

## 背景

当前 `apps/web` 已经具备可用的工作台和分析详情页，但 UI 基础能力仍有两个明显缺口：

- 文案直接散落在 React 组件里，中英混用，无法稳定扩展到多语言
- 全局样式默认只服务于暗色视觉，缺少明暗模式切换能力

这两个问题本质上都不是“补一个按钮”可以解决的。它们要求 Web 层先建立稳定的“用户偏好 + 展示令牌”基础设施，否则后续每新增一个页面、图表或交互控件，都会继续复制硬编码文案和固定色值。

本文定义 `code-dance` Web 端第一版多语言和主题能力设计，目标是让后续页面、图表和组件都能在不重构架构的前提下接入国际化与明暗模式。

## 目标

- 支持 `zh-CN` 与 `en` 两种界面语言
- 支持 `light`、`dark`、`system` 三种主题模式
- 为 React 组件、全局 CSS 和 ECharts 图表提供统一接入方式
- 让用户偏好可持久化，并在刷新后恢复
- 让后续新增页面默认遵守统一文案与主题约束

## 非目标

- 本文不处理服务端多语言渲染，当前 Web 仍是纯客户端应用
- 本文不要求第一阶段就把 API 所有错误文案都本地化
- 本文不讨论品牌视觉全面改版，只定义主题令牌和切换机制
- 本文不引入复杂 CMS 或在线翻译平台

## 当前问题

### 1. 文案没有抽象层

当前页面标题、表单标签、按钮、空状态、图表描述、确认提示都直接写在组件内部。结果是：

- 无法统一切换语言
- 相同语义容易出现不同说法
- 文案修改需要跨多个组件搜索
- 新页面很容易继续复制硬编码字符串

### 2. 色彩令牌只有暗色版本

当前 [`apps/web/src/styles.css`](/home/zxr/work/github/code-dance/apps/web/src/styles.css) 在 `:root` 中直接定义了一组暗色 token，并让整个布局、卡片、边框、悬浮层都建立在这套 token 上。结果是：

- 没有独立的亮色 token
- 没有主题状态管理
- 图表与页面背景缺少统一的主题同步策略

### 3. 图表颜色和页面主题还未闭合

页面切成明亮主题后，若图表仍沿用暗色背景、浅色文本或过亮的 series 颜色，会出现：

- 图表与页面断层
- tooltip、axis、grid、legend 对比度失衡
- 交互态颜色在不同主题下不可读

## 设计原则

### 1. 先引入稳定的 message key，再谈翻译内容

不以中文或英文任一语言作为“代码里的默认文案”。代码中只允许引用稳定的 message key，真正显示的文案由 locale 字典决定。

### 2. 主题切换必须基于设计令牌，而不是组件内条件分支

组件不直接写“如果 dark 就用这个颜色”。组件应依赖语义化 CSS 变量，例如 `--surface`、`--text-muted`、`--chart-grid`。

### 3. 用户偏好和系统偏好分离

语言与主题都应支持：

- 用户显式选择
- 浏览器或系统默认推断
- 缓存恢复

其中显式用户选择优先级最高。

### 4. 图表主题必须和页面主题同步

ECharts 不是特殊情况。它也必须消费统一主题令牌，而不是自己维护另一套颜色表。

### 5. 第一阶段优先解决 UI chrome 和核心流程

先覆盖导航、页面标题、按钮、表单、状态反馈、概览卡片、图表标题和说明。复杂动态错误文本与高级 ICU 复数规则可后置。

## 能力范围

第一阶段支持范围：

- 顶部导航、侧栏、表单、按钮、空状态、加载状态、删除确认
- 分析详情页中的标题、描述、 badge、概览卡片、图表说明
- 数字、日期、百分比的本地化格式化
- 页面级 light/dark/system 切换
- 图表主题同步

第一阶段暂不强求：

- 后端错误消息全文翻译
- 图表内部所有业务名词的复杂复数变化
- URL 层面的语言路由，例如 `/en/...`

## 方案概览

建议在 `apps/web` 内新增两套基础设施：

```text
apps/web/src/
  app/
    preferences.tsx
  i18n/
    index.ts
    messages.ts
    locales/
      en.ts
      zh-CN.ts
  theme/
    index.ts
    chart-theme.ts
```

职责划分：

- `preferences.tsx`: 管理用户偏好状态与持久化
- `i18n/`: 负责 locale 解析、文案查找、格式化方法
- `theme/`: 负责主题模式解析、DOM 同步、图表主题令牌

## 多语言设计

### 1. 支持语言

第一阶段只支持：

- `zh-CN`
- `en`

locale 标识建议使用 BCP 47 风格，并统一归一化到以上两个值。

示例：

- `zh`
- `zh-CN`
- `zh-Hans`

都归并到 `zh-CN`。

### 2. 语言判定优先级

语言来源按以下优先级解析：

1. 用户在设置中显式选择的 locale
2. `localStorage` 中持久化的 locale
3. `navigator.languages`
4. 应用默认值

应用默认值建议为 `en`，原因是 README 主入口当前以英文为主，且 API 错误文案已有不少英文内容；但界面可以根据浏览器语言自动落到 `zh-CN`。

### 3. 文案组织方式

不建议第一阶段引入重量级 i18n 框架。当前项目体量较小、路由简单、消息数量可控，更适合使用“类型化消息字典 + React Context + 原生 Intl”方案。

建议结构：

```ts
export const messages = {
  "nav.repositories": {
    "zh-CN": "仓库工作台",
    en: "Repositories",
  },
  "action.addRepository": {
    "zh-CN": "添加仓库",
    en: "Add Repository",
  },
} as const;
```

配套接口：

- `t(key, params?)`: 返回翻译文案
- `formatNumber(value, options?)`
- `formatPercent(value, options?)`
- `formatDate(value, options?)`
- `formatRelativeTime(value, unit?)`

### 4. message key 规范

建议按领域分组，避免扁平 key 失控：

- `nav.*`
- `page.repositories.*`
- `page.analysis.*`
- `action.*`
- `label.*`
- `feedback.*`
- `chart.*`
- `metric.*`
- `sampling.*`
- `dialog.*`

要求：

- key 表示语义，不表示具体语言
- 不允许新增匿名内联字符串
- 同一语义只保留一个 key，避免近义重复

### 5. 动态文案策略

动态字符串统一使用参数插值，不在组件里手拼句子。

例如：

```ts
t("dialog.deleteRepository.confirm", { name: repository.name });
```

而不是：

```ts
`确认删除仓库“${repository.name}”吗？`
```

### 6. 数字与日期格式化

所有下列格式统一使用 locale 感知的原生 `Intl`：

- 模块数量
- Top N 合计
- 百分比
- 采样时间点
- 未来若加入的相对时间

这样可以避免文案翻译完毕后，数字分隔符、百分号、小数规则仍保留旧语言习惯。

### 7. API 错误本地化策略

第一阶段不要求把 API 返回的 `message` 全部翻译，但建议开始为错误结构补 `error.code` 或更稳定的错误分类。Web 层优先根据错误码映射本地化文案，映射失败时再回退显示服务端原文。

建议顺序：

1. 现有 API 保持兼容
2. 新增稳定 `code`
3. Web 根据 `code` 翻译常见错误
4. 未覆盖情况回退服务端 `message`

## 明暗模式设计

### 1. 主题模式定义

主题模式拆成两层：

- `themeMode`: `light | dark | system`
- `resolvedTheme`: `light | dark`

其中：

- `themeMode` 是用户选择
- `resolvedTheme` 是应用当前真正生效的主题

当 `themeMode = system` 时，通过 `matchMedia("(prefers-color-scheme: dark)")` 计算 `resolvedTheme`。

### 2. 主题判定优先级

1. 用户显式选择的 `themeMode`
2. `localStorage` 中的 `themeMode`
3. 系统主题偏好
4. 默认值 `system`

### 3. DOM 同步方式

建议把主题挂在根节点属性上，而不是通过 React 在各组件层层传颜色。

例如：

```html
<html data-theme="dark">
```

CSS 组织方式：

```css
:root {
  --bg: ...;
  --surface: ...;
}

:root[data-theme="light"] {
  --bg: ...;
  --surface: ...;
}

:root[data-theme="dark"] {
  --bg: ...;
  --surface: ...;
}
```

这样做的好处是：

- 现有组件改造成本低
- CSS 变量天然支持级联
- 图表、卡片、表单、hover 态都能共享同一套令牌

### 4. 主题令牌分层

建议把 token 分三层：

#### 基础层

- `--color-slate-0`
- `--color-slate-950`
- `--blue-500`

#### 语义层

- `--bg`
- `--surface`
- `--surface-2`
- `--border`
- `--text`
- `--text-muted`
- `--accent`
- `--success`
- `--warning`
- `--error`

#### 图表层

- `--chart-axis`
- `--chart-grid`
- `--chart-tooltip-bg`
- `--chart-tooltip-border`
- `--chart-series-1`
- `--chart-series-2`
- `--chart-positive`
- `--chart-negative`

组件和图表只消费语义层与图表层，不直接消费基础色。

### 5. 背景与层次策略

当前暗色视觉使用了较强的 radial gradient 和玻璃态质感。亮色主题不应简单反转颜色，而应保留层次感，但降低发光和阴影强度，避免：

- 高饱和蓝色在白底过于刺眼
- 半透明白叠加导致脏灰感
- card shadow 在亮色主题下过重

建议：

- 暗色保留当前“深底 + 局部蓝绿光斑”的方向
- 亮色使用“浅灰底 + 低饱和冷色光晕 + 更轻的阴影”
- 边框和分割线在亮色下更依赖灰度，不依赖透明白

### 6. 图表主题同步

ECharts 相关组件不应各自硬编码颜色。建议在 `theme/chart-theme.ts` 中提供统一方法：

- `getChartTokens(resolvedTheme)`
- `buildChartTheme(resolvedTheme)`
- `buildSeriesPalette(resolvedTheme)`

图表组件只从 hook 或 helper 获取：

- 背景色
- 文本色
- 网格线色
- tooltip 色
- series 调色板
- 正负变化色

这样才能保证主题切换时，所有图表一并重绘并保持一致可读性。

### 7. 首次加载闪烁问题

如果主题只在 React 挂载后决定，页面首屏会先显示默认暗色，再切到亮色。为避免 FOUC，建议在 `index.html` 增加一段极小的内联脚本，提前读取本地 `themeMode` 并设置 `data-theme`。

这一步很重要，尤其当前页面背景和容器色差较大，闪烁会非常明显。

## 共享偏好层设计

建议增加统一的偏好上下文，而不是把 locale 和 theme 分别散落在不同组件中。

建议状态结构：

```ts
type AppPreferences = {
  locale: "zh-CN" | "en";
  themeMode: "light" | "dark" | "system";
  resolvedTheme: "light" | "dark";
};
```

提供接口：

- `setLocale(locale)`
- `setThemeMode(mode)`
- `usePreferences()`
- `useI18n()`
- `useTheme()`

这样后续如果再加入：

- 数值单位偏好
- 时间显示偏好
- 默认采样维度

也可以继续挂在同一偏好层，而不必重做状态模型。

## 组件落地约束

### 1. React 组件

要求：

- 不直接写用户可见字符串
- 不直接写主题分支色值
- 优先使用 `t()` 与 CSS 变量

### 2. 样式文件

要求：

- 保留现有视觉语言，但把颜色从固定值迁移到语义 token
- 允许少量主题差异化背景定义
- 避免在大量局部 class 中重复写 `data-theme` 分支

### 3. 图表组件

要求：

- 标题、说明、占位文案全部走 i18n
- 颜色、边框、axis、tooltip 全部走 chart token
- 指标标签 `loc/added/deleted/churn` 不直接写死

## 推荐实施顺序

### Phase 1: 能力底座

- 新增 `preferences`、`i18n`、`theme` 基础目录
- 建立 `locale` 和 `themeMode` 状态
- 接入 `localStorage`
- 为 `html` 或 `:root` 注入 `data-theme`
- 整理第一批通用文案 key

完成标准：

- 页面刷新后能恢复用户选择
- 语言和主题切换不需要刷新页面

### Phase 2: 全局 UI 接入

- 侧栏、顶部栏、仓库列表页、模块页接入 i18n
- 全局 CSS 迁移到 light/dark 双 token
- 表单、按钮、反馈消息适配主题

完成标准：

- 主工作台在两种主题下都可读
- UI chrome 基本不再存在硬编码文案

### Phase 3: 分析详情与图表接入

- 概览卡片、badge、图表标题与说明接入 i18n
- ECharts 统一接入 chart token
- 切换主题时触发图表重绘

完成标准：

- 详情页在双语与双主题下可完整阅读
- 图表与页面视觉一致

### Phase 4: 错误与测试补齐

- 为常见 API 错误补 error code 映射
- 增加 i18n 字典完整性检查
- 增加主题切换与语言切换的 UI 测试

完成标准：

- 常见路径不再出现未翻译 key
- 主要页面切换语言和主题后无明显回归

## 风险

### 1. 先做翻译、后做 message key，会导致返工

如果直接把当前中文界面翻成英文，但不先建立 key 体系，后续所有组件仍会继续写死文案，国际化很快失控。

### 2. 只切换页面背景，不切图表主题，会造成断层

这会让图表成为视觉孤岛，也是最容易被用户感知到的“半成品”问题。

### 3. 把主题状态写到单个页面，会阻碍未来扩展

主题和语言都属于应用级偏好，不能挂在某个页面组件里。

### 4. API 错误仍返回自然语言，会限制前端翻译质量

因此错误码补齐虽然不是第一阶段阻塞项，但应该尽早进入契约设计。

## 当前结论

`code-dance` 的多语言与明暗模式不应被视为两个分散特性，而应被统一设计为 Web 展示层的基础能力升级。

落地原则很明确：

- 文案统一走 message key
- 视觉统一走语义 token
- 用户偏好统一走应用级状态
- 图表必须与页面主题同步

按这个方案推进后，后续新增页面、图表和交互控件就能默认继承国际化与主题能力，而不是继续积累硬编码成本。
