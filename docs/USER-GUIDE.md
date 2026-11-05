# 使用说明（面向非开发人员）

## 1. 第一次使用需要准备什么？

- 一个 GitHub 个人账号。
- 一个公开网站仓库：`shendu-expense-ledger`。
- 一个私有数据仓库：`shendu-expense-data`。
- 一个只对私有数据仓库开放 Contents 读取和写入的 Fine-grained PAT。

你不需要安装数据库、服务器软件或编程环境。

## 2. 如何发布网站主页？

1. 登录 GitHub，点击右上角 `+` → `New repository`。
2. 仓库名称填写 `shendu-expense-ledger`。
3. 选择 `Public`，点击创建。
4. 下载并解压本项目 ZIP。
5. 进入新仓库，点击 `Add file` → `Upload files`。
6. 打开解压后的 `shendu-expense-ledger` 文件夹，全选里面的文件和文件夹，拖到 GitHub 上传区域。
7. 确认 `index.html` 位于仓库最外层，不要多套一层目录。
8. 点击 `Commit changes`。
9. 打开仓库 `Settings` → `Pages`。
10. `Build and deployment` 选择 `Deploy from a branch`；Branch 选 `main`，目录选 `/(root)`，点击 `Save`。
11. 等待页面发布，GitHub Pages 会显示项目主页地址。

## 3. 如何创建私有数据仓库？

1. 再次新建一个 GitHub 仓库。
2. 名称填写 `shendu-expense-data`。
3. 可见性必须选择 `Private`。
4. 创建时勾选 `Add a README file`，让 GitHub 创建 `main` 分支。
5. 分支名称使用 `main`。
6. 不需要把这个仓库发布成网站。

## 4. 如何创建访问令牌？

1. 打开 GitHub 头像菜单 → `Settings`。
2. 在左侧找到 `Developer settings`。
3. 进入 `Personal access tokens` → `Fine-grained tokens`。
4. 点击 `Generate new token`。
5. Token name 可以填写 `Shendu Expense Ledger`。
6. Expiration 建议设置一个你方便定期更换的期限。
7. Resource owner 选择你的 GitHub 个人账号。
8. Repository access 选 `Only select repositories`，只勾选 `shendu-expense-data`。
9. 展开 `Repository permissions`，只把 `Contents` 设为 `Read and write`；其他权限保持 `No access`。
10. 点击生成，立即复制令牌并保管好。

令牌类似仓库钥匙。不要发给任何人，不要上传到代码仓库，也不要放在截图或文档里。

## 5. 如何连接网站？

1. 打开你发布后的 GitHub Pages 网址。
2. GitHub 用户名填写你的 GitHub 登录名。
3. 私有数据仓库填写 `shendu-expense-data`。
4. 分支填写 `main`。
5. 粘贴 Fine-grained PAT。
6. 点击“连接私有仓库”。
7. 连接成功后，页面会显示 GitHub 用户名和数据仓库。
8. 首次使用建议点击“初始化演示数据”。

令牌不会保存在网站代码或浏览器本地存储中。刷新网页或关闭网页后，需要重新输入。

## 6. 如何切换三个中心？

新增报销或费用增加时，选择供金、创新、数金中心。三个中心使用固定颜色：

- 供金中心：蓝色 `#3478F6`
- 创新中心：橙色 `#F59E0B`
- 数金中心：青绿色 `#14B8A6`

系统只扣减或增加所选中心的余额。

## 7. 如何上传附件？

- 新增报销时，付款凭证区域支持多张图片。
- 发票区域支持多张图片或 PDF。
- 单个附件不超过 10MB。
- 附件上传到私有数据仓库；查看时需要当前网页仍处于 GitHub 连接状态。

新增费用时也可以上传相关图片/PDF作为凭证。

## 8. 如何更换令牌？

1. 先去 GitHub 创建新的 Fine-grained PAT，仍然只授权 `shendu-expense-data` 的 Contents Read and write。
2. 回到网页，点击右上方“GitHub 已连接 · 重新授权”或系统管理中的“更换 GitHub 令牌”。
3. 输入新令牌并重新连接。
4. 确认能够读取账本后，再回 GitHub 撤销旧令牌。

更换令牌不会删除或修改仓库中已经保存的账目和附件。

## 9. 如何导出备份？

- 系统管理 → 下载账本 JSON 备份：备份账本字段和附件路径，不包含附件二进制文件。
- 支出记录、费用增加、资金流水：可导出当前筛选结果或全部数据的 CSV，用 Excel 打开。
- 完整附件备份：在 GitHub 私有数据仓库页面使用 `Code` → `Download ZIP` 下载仓库内容。

## 10. 重要提醒

- 当前先使用演示账本和虚拟数据。
- GitHub Pages 是公开网站。即使数据仓库是私有的，网站本身仍是公开的。
- 当前账本 JSON 和附件以明文存储在 GitHub 私有仓库，并未进行客户端加密。
- GitHub 官方提示 Pages 不应处理密码等敏感事务。本项目需要在浏览器页面中使用 GitHub PAT，因此在录入真实公司费用和附件前，必须完成代码审查及公司信息安全审批，并确认公司允许明文资料存储在 GitHub 私有仓库。
- 在未完成审批前，不要将真实付款截图、发票、客户或个人信息上传到 GitHub。
