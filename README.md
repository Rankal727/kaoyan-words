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

应用内"设置 → 关于"页同样展示署名。**本项目仅限个人学习使用，禁止商用。**
