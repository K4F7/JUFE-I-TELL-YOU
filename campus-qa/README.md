# 校园事务问答平台（Vertex AI + Cloud Run）

本仓库提供一个可部署到 Google Cloud Run 的最小可行产品（MVP），利用 Vertex AI Gemini 模型与 Firestore 构建校园事务问答 RAG（Retrieval-Augmented Generation）系统。

- **后端**：Node.js 20 + Express（TypeScript），部署到 Cloud Run
- **前端**：静态单页 HTML，Cloud Run + Nginx 托管
- **数据层**：种子文本存储于 Cloud Storage，向量存 Firestore（后续可迁移到 Vertex AI Vector Search）
- **AI 能力**：Vertex AI `text-embedding-004` 生成嵌入，`gemini-1.5-pro`（或 Flash）生成回答

## 目录结构

```
campus-qa/
├─ frontend/              # 静态前端页面
├─ backend/               # Express + RAG 服务
├─ cloudrun-frontend/     # 前端容器（Nginx）
├─ scripts/upload_seed.sh # 将种子文档上传至 GCS
├─ deploy.sh              # Cloud Run 构建部署脚本
└─ README.md
```

仓库根目录还附带 `seed/` 示例文档，可作为初始校务资料。

## 一、GCP 项目初始化

以下命令均可直接复制执行，记得替换变量：

```bash
PROJECT_ID=<my-project>
REGION=<asia-northeast1>
BUCKET=campus-qa-docs
SERVICE_ACCOUNT=campus-qa-sa

# 1. 设置项目并启用所需 API
gcloud config set project $PROJECT_ID
for api in aiplatform.googleapis.com \
           run.googleapis.com \
           cloudbuild.googleapis.com \
           artifactregistry.googleapis.com \
           firestore.googleapis.com \
           storage.googleapis.com \
           secretmanager.googleapis.com; do
  gcloud services enable $api --project $PROJECT_ID
done

# 2. 创建 GCS bucket（多区域或区域）
gsutil mb -p $PROJECT_ID -l $REGION gs://$BUCKET

# 3. Firestore 原生模式初始化
export GOOGLE_CLOUD_PROJECT=$PROJECT_ID
gcloud firestore databases create --project=$PROJECT_ID --database="(default)" --location=$REGION

# 4. 创建运行 Cloud Run 的服务账号
gcloud iam service-accounts create $SERVICE_ACCOUNT \
  --display-name "Campus QA Cloud Run"

# 5. 授权服务账号所需最小权限
for role in roles/storage.objectAdmin \
            roles/datastore.user \
            roles/aiplatform.user \
            roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="$role"
done
```

> 如需进一步限制权限，可针对 Cloud Storage 使用细粒度 IAM 或 Bucket Policy Only。

## 二、准备种子数据

1. 编辑或替换仓库根目录 `seed/` 下的 Markdown/TXT 文档。
2. 上传至 GCS：

```bash
cd campus-qa
BUCKET=gs://$BUCKET ./scripts/upload_seed.sh
```

这会把本地 `seed/` 同步到 `gs://$BUCKET/seed/`。

## 三、后端功能概览

- `/admin/ingest`：从 `gs://$BUCKET/seed/` 读取文本 → 300-600 字切块 → 调用 `text-embedding-004` 获取向量 → 写入 Firestore `chunks` 集合。需要 `Authorization: Bearer $ADMIN_TOKEN`。
- `/api/ask`：
  1. 对问题调用嵌入模型获得 768 维向量；
  2. 在 Firestore 内存读取所有 chunk，计算余弦相似度取 Top-5；
  3. 构造 prompt，将参考资料传入 Gemini；
  4. 返回答案与引用（标题、URL、更新时间、相似度分数）。
- `/healthz`：提供 Cloud Run 健康检查。

## 四、部署（Cloud Run 双服务）

部署脚本会自动：
1. 构建前后端镜像并推送到 Artifact Registry；
2. 部署 `campus-qa-api`（后端）与 `campus-qa-web`（前端）到 Cloud Run；
3. 配置必要环境变量并允许未认证访问；
4. 输出服务 URL 与 `ADMIN_TOKEN`。

使用步骤：

```bash
cd campus-qa
export PROJECT_ID=<my-project>
export REGION=<asia-northeast1>
export GCS_BUCKET=gs://campus-qa-docs
export SERVICE_ACCOUNT=campus-qa-sa@${PROJECT_ID}.iam.gserviceaccount.com
# 可选：export GEMINI_MODEL=gemini-1.5-flash
./deploy.sh
```

脚本执行结束后将打印：

- Cloud Run API URL（例如 `https://campus-qa-api-xxxxx.run.app`）
- 前端 URL（例如 `https://campus-qa-web-xxxxx.run.app`）
- 随机生成的 `ADMIN_TOKEN`

若需自定义域名或启用 IAP，可在部署后通过 `gcloud run services update` 或 Cloud Console 配置。

## 五、数据导入与验收流程

1. **执行种子数据导入**

```bash
API_URL=https://campus-qa-api-xxxxx.run.app
ADMIN_TOKEN=<deploy.sh 输出的 token>
curl -X POST "$API_URL/admin/ingest" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prefix":"gs://campus-qa-docs/seed/"}' | jq
```

2. **调用问答接口**

```bash
curl -s -X POST "$API_URL/api/ask" \
  -H "Content-Type: application/json" \
  -d '{"question":"学生证丢了怎么办？"}' | jq
```

3. **打开前端**：访问 `campus-qa-web` 的 URL，输入示例问题，确认页面展示答案与来源。

4. **监控日志与性能**：

```bash
gcloud run services logs read campus-qa-api --project $PROJECT_ID --region $REGION --limit 50
```

Cloud Run 日志应显示请求处理耗时，通常 <2s（视 Vertex AI 响应而定）。

## 六、费用与按量计费提示

- Vertex AI 按调用计费：`text-embedding-004` & `gemini-1.5` 属于在线接口，注意配额与速率限制。
- Cloud Run 采用按使用付费模式（CPU/内存/请求量）。默认最小实例数为 0，空闲不计费。
- Firestore 原生模式按存储量、读写操作计费，向量存储为 `number[]` 会占用一定空间，请控制 chunk 长度。
- Cloud Storage 收费包含存储与出口流量。仅内部访问成本极低。

建议在 Cloud Billing 中设置预算与告警，避免费用超支。

## 七、后续增强：迁移至 Vertex AI Vector Search

在 README 中说明的未来路线：

1. **创建向量索引**
   - 使用 Vertex AI Vector Search 建立 Index（基于 ScaNN），选择合适的向量维度（768）。
   - 部署 Index Endpoint，配置最少 1 个部署单元。

2. **批量导入向量**
   - 从 Firestore 导出 `chunks`（可写入 JSONL 或 BigQuery）。
   - 利用 Vertex AI 上载工具或 Cloud Storage JSON 批量 upsert 到 Vector Search。

3. **查询阶段改造**
   - 在后端新增 Vertex AI Vector Search 客户端，调用 `findNeighbors` 获取最近邻。
   - 将返回的 `neighbor` metadata（source_url、title 等）作为上下文，继续调用 Gemini 生成答案。

4. **混合检索与反馈**
   - 加入关键词过滤，将问题的关键词与标签匹配后再组合向量相似度。
   - 新增 `/feedback` 接口存储用户对答案的“有用/无用”及评论，写入 Firestore 供后续分析。

## 八、最少手动执行步骤清单

1. **初始化 GCP**：复制“GCP 项目初始化”章节命令，依次执行（替换变量）。
2. **上传种子文档**：运行 `BUCKET=gs://campus-qa-docs ./scripts/upload_seed.sh`。
3. **部署**：设置环境变量后执行 `./deploy.sh`。
4. **导入数据**：使用 `curl` 调用 `/admin/ingest`，带上脚本输出的 `ADMIN_TOKEN`。
5. **验证问答**：通过 `curl` 或前端页面调用 `/api/ask`，确认可返回答案与来源。

完成以上步骤即可交付可在线体验的校园事务问答平台。
