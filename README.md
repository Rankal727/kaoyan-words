# 考研英语一 · 高频词记背

纯前端的考研英语一单词记背 PWA。无需安装、无需注册：浏览器打开 → 添加到主屏幕，即可像 APP 一样使用；首次打开后全部资源缓存本地，**离线可用**，学习进度存在各自手机本地（IndexedDB），多人使用互不干扰。

在线地址：https://rankal727.github.io/kaoyan-words/

## 功能

- 真题词频排序词库（2002–2024 共 22 年真题统计，5530 词），高频 Top 2000 / 全量可切换
- FSRS 智能复习调度（忘了 / 模糊 / 认识 三档自评，按记忆状态安排下次复习）
- 词形变化（复数 / 现在分词 / 过去式 / 过去分词等，含不规则变化）
- 真题原句例句（逐字摘录，标注年份与出处）
- 词库搜索、学习统计与打卡、深浅色主题切换、数据导出/导入备份
- 单词发音（在线美音，离线回退本地 TTS）

## 数据安全

学习进度（卡片记忆状态、复习日志、打卡）保存在**用户浏览器本地的 IndexedDB**（数据库名 `gwc-kaoyan`），与程序文件完全分离：应用升级只替换程序缓存，**不会清除任何学习数据**。

开发者约定（后续维护必须遵守）：

- 升级数据结构时只能用 Dexie 增量迁移（`DB.version(n+1)`），**禁止删除或重建数据库**；
- 不更换部署网址——本地数据与域名绑定，换域名等于换设备；
- 任何会触发"清空学习数据"的改动，必须由用户在界面上主动确认。

## 本地运行

```bash
python -m http.server 8137
# 打开 http://127.0.0.1:8137
```

## 数据来源与协议

| 数据 | 来源 | 协议 |
|---|---|---|
| 5530 词真题词频排序表（2002–2024） | [exam-data/NETEMVocabulary](https://github.com/exam-data/NETEMVocabulary) | 数据 CC BY-NC-SA 4.0（非商用） |
| 红宝书结构化释义 | [3056810551/2027-kaoyan-english-redbook-json](https://github.com/3056810551/2027-kaoyan-english-redbook-json) | MIT（原作者注明仅限学习交流） |
| 真题原文（例句摘录源） | [LIziak112/structured-kaoyan-english](https://github.com/LIziak112/structured-kaoyan-english) | 试题数据层无使用限制 |
| 词形变化 | [lemminflect](https://github.com/benhaney/lemminflect)（构建期离线生成） | MIT |
| 复习调度 | [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | MIT |
| 音标与发音 | [Free Dictionary API](https://dictionaryapi.dev) | CC BY-SA 3.0 |

应用内"设置 → 关于"页同样展示署名。本应用的词库文件 `data/words.json` 系对上述数据的整理与改编，依 CC BY-NC-SA 4.0 的"相同方式共享"要求，**同样以 CC BY-NC-SA 4.0 授权提供，仅限非商业用途**。

随应用分发的开源组件：ts-fsrs（MIT）、Dexie（Apache-2.0），完整许可文本见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

**本项目仅供个人学习使用，禁止商用。**
