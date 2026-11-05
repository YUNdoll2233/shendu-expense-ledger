# 深度数科中心费用台账系统（单人管理版）

这是一个纯静态网页项目，适用于 GitHub Pages。网站代码托管在公开仓库；台账 JSON 和附件保存到你自己创建的 **GitHub 私有数据仓库**。不使用传统数据库、不需要自购云服务器或域名。

> **重要安全边界**：GitHub 官方提示 GitHub Pages 不应被用于处理密码等敏感事务。当前版本需要在网页运行期间使用你粘贴的 GitHub Fine-grained PAT（个人访问令牌）。令牌只保存在当前页面 JavaScript 内存中，不写入代码、URL、LocalStorage 或数据文件，但公开网页中的脚本能够访问它。当前账本 JSON 和附件以明文保存在 GitHub 私有数据仓库，**没有客户端加密**。因此本版本首先用于虚拟演示和验证；未经公司明确批准将真实资料以明文存储在 GitHub 私有仓库，并完成公开 Pages 页面令牌处理的独立安全评估前，不要录入真实付款凭证、发票、客户资料或其他公司敏感数据。

## 功能

- 费用总览：集团余额、供金/创新/数金三个中心余额、快捷操作、近期流水。
- 支出记录：单列报销录入、付款图片多附件、发票图片/PDF多附件、搜索筛选、详情查看、作废。
- 费用增加：季度费用发放、费用退回（关联原支出选填）、其他费用增加。
- 资金流水：全部资金变动、逐笔变动后余额、日期倒序、筛选、CSV导出。
- 统计报表：月度、季度、年度、自定义日期；只显示集团和三个中心的期末余额；余额可点击下钻到对应明细。
- 系统管理：GitHub连接、演示/正式目录切换、期初余额初始化、JSON账本备份。
- 演示账本与正式账本分目录保存；演示数据为虚拟数据。

## 文件结构

```text
shendu-expense-ledger/
├── index.html
├── css/styles.css
├── js/app.js
├── assets/shendu-logo.png
├── docs/USER-GUIDE.md
├── .nojekyll
└── README.md
```

## GitHub Pages 部署

1. 在 GitHub 新建公开仓库，建议命名 `shendu-expense-ledger`。
2. 将本项目文件夹里的**所有文件和文件夹**上传到仓库根目录（不要只上传 ZIP 文件）。
3. 打开仓库 `Settings` → `Pages`。
4. 在 `Build and deployment` 中选择 `Deploy from a branch`。
5. Branch 选择 `main`，目录选择 `/(root)`，保存。
6. 等待 GitHub 发布，页面地址通常为 `https://你的用户名.github.io/shendu-expense-ledger/`。

GitHub Free 个人账号的 Pages 项目仓库需要公开；网站本身也会公开给互联网访问。不要把真实账本、令牌、付款截图、发票放进这个网站代码仓库。

## 创建私有数据仓库

1. 在 GitHub 新建另一个仓库，建议命名 `shendu-expense-data`。
2. 仓库可见性必须选择 `Private`。
3. 创建时建议勾选 `Add a README file`，确保 `main` 分支已经建立。
4. 分支建议使用 `main`。
5. 不需要把数据仓库设置为 Pages 网站，不需要启用 Pages。
6. 连接网站时，填写 GitHub 用户名、`shendu-expense-data`、`main`。

## 创建 Fine-grained PAT

1. GitHub 头像 → `Settings`。
2. `Developer settings` → `Personal access tokens` → `Fine-grained tokens`。
3. 选择 `Generate new token`。
4. Resource owner 选择你的个人 GitHub 账号。
5. Repository access 选择 `Only select repositories`，只勾选 `shendu-expense-data`。
6. Repository permissions 只设置 `Contents: Read and write`；其他权限保持 `No access`。`Metadata: Read-only` 通常由 GitHub 自动要求。
7. 设置合理有效期并生成令牌。令牌生成后只显示一次，请复制并保存在你自己的密码管理工具中。
8. **不要把令牌发给任何人，不要粘贴到聊天中，不要写入代码。**

打开网站后，在连接页填写：
- GitHub 用户名：你的 GitHub 登录名
- 私有数据仓库：`shendu-expense-data`
- 分支：`main`
- GitHub 令牌：刚创建的 Fine-grained PAT

连接成功后，进入「系统管理」或首页，点击「初始化虚拟演示数据」。系统会在私有仓库的 `demo/` 目录创建三中心演示账本。

## Token 使用规则

- Token 只保存在当前网页内存中。
- 刷新、关闭网页或点击“断开并更换令牌”后，需要重新输入。
- Token 不会保存到 LocalStorage、SessionStorage、URL 或仓库文件。
- Token 只应对指定私有数据仓库授予 Contents Read and write。
- 如需更换，先创建新 Token，在网站重新连接并验证成功，再撤销旧 Token。

## 演示账本与正式账本

- 默认进入 `demo/` 演示目录，样例姓名和金额均为虚拟数据。
- `production/` 是独立正式目录，首次启用时需填写三个中心上线时的实际剩余余额和启用日期。
- 正式目录初始化时需要勾选“我已确认公司批准将真实账目及附件以明文存储在 GitHub 私有仓库，并完成公开 Pages 页面令牌处理安全审查”。这只是产品内的操作确认，不能替代公司的正式审批。
- GitHub Pages 官方提醒 Pages 不应处理密码等敏感事务。使用 PAT 的风险需要独立评估；公司允许将资料放入 GitHub 私有仓库，并不自动代表同意在公开 Pages 页面输入 PAT。
- 在完成公司审批和安全评估前，只使用虚拟演示数据。

## 数据规则

- 期末余额 = 期初余额 + 截止日期前有效费用增加 - 截止日期前有效报销支出。
- 只记录实际打款日期，不记录消费发生日期。
- 期初余额不计入上线后的费用增加。
- 费用退回作为独立正向流水，不修改原报销金额。
- 跨季度余额自动滚动，不需要手工新增结转。
- 允许负余额。
- 错误资金记录通过作废并重新录入处理；作废记录保留在数据文件中但不参与余额计算。
- 费用报表只展示期末余额，不展示费用增加/报销支出汇总，不做同比/环比和中心支出对比。

## 文件和附件限制

- 付款凭证：多张图片。
- 发票：多张图片或 PDF。
- 单个附件在本网页中的上传上限为 10MB（低于 GitHub API 的更高限制，以减少浏览器上传失败）。
- 附件存放在私有数据仓库中，页面读取时通过 GitHub API 请求私有文件。
- JSON 备份只包含账本内容及附件路径，不打包附件二进制文件。需要完整附件备份时，应通过 GitHub 私有仓库另行下载仓库 ZIP。
- GitHub 仓库提交历史会保留文件变更痕迹；删除当前文件不代表历史提交中的内容已从 GitHub 历史中清除。

## 导出说明

页面导出为 UTF-8 BOM 的 CSV 文件，可以用 Excel 打开。它是 Excel 兼容 CSV，不是带多个工作表的原生 `.xlsx` 文件。

## 已知限制

- 单人管理、串行写入设计；不适合多人同时编辑同一份账本。
- GitHub Contents API 每次更新文件都会产生一次提交；频繁上传多个附件会产生多次提交。
- 本应用使用每个中心一个 JSON 账本文件。账目量很大时，JSON 会持续增长；请定期备份并关注仓库体积。
- 公开 GitHub Pages 页面可以被任何人打开。不要误以为“数据仓库是私有的”就等于“网页也是私有的”。
- 由于没有后端，无法提供传统意义上的服务器端登录会话、服务器端审计日志或真正不可绕过的服务端业务权限。

## 测试建议

先连接空的私有测试仓库并初始化演示数据，依次测试：新增报销、上传多张付款截图、上传图片/PDF发票、费用增加、关联退回、负余额、作废、跨季度统计、CSV导出、刷新后重新连接。确认无误后，再讨论正式账本启用。
