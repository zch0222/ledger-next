# 图表原型的本地依赖

Apache ECharts 6.0.0 common 构建用于离线设计评审。脚本保持发布包原样，未修改第三方实现。

- [版本来源](https://github.com/apache/echarts/releases/tag/6.0.0)
- [下载文件](https://cdn.jsdelivr.net/npm/echarts@6.0.0/dist/echarts.common.min.js)
- 文件：echarts-6.0.0.common.min.js
- 大小：705143 字节
- SHA-256：fd958f318b139893918674790290fcd73d19d953b91175d5277250ffaa177d8e
- [许可证](ECHARTS-LICENSE.txt) / [NOTICE](ECHARTS-NOTICE.txt)

校验和用于复现本次设计依赖，不替代上游签名认证。正式 Next.js 工程采用 npm 锁文件与 echarts/core 按需导入；不要把原型 common 全量脚本直接纳入首屏包。
