# Campus QA Backend

TypeScript Express service powering the校园事务问答平台 RAG API.

## Endpoints

- `GET /healthz` – health check.
- `POST /api/ask` – body `{ "question": "..." }`, returns generated answer与引用。
- `POST /admin/ingest` – body `{ "prefix": "gs://bucket/path" }`，需 `Authorization: Bearer $ADMIN_TOKEN`。

## 环境变量

| 变量 | 说明 |
| ---- | ---- |
| `PROJECT_ID` | GCP 项目 ID |
| `REGION` | Vertex AI / Firestore 区域，例如 `asia-northeast1` |
| `GCS_BUCKET` | 形如 `gs://campus-qa-docs` |
| `FIRESTORE_COLLECTION` | Firestore 集合名，默认 `chunks` |
| `TOPK` | 检索条数，默认 `5` |
| `RAG_MAX_CONTEXT` | prompt 最大参考字数，默认 `2500` |
| `GEMINI_MODEL` | 生成模型，默认 `gemini-1.5-pro` |
| `ADMIN_TOKEN` | 保护 `/admin/ingest` 的 Bearer Token |

## 本地开发

```bash
cd backend
npm install
npm run build
npm start
```

运行前请配置 `GOOGLE_APPLICATION_CREDENTIALS` 或启用 gcloud auth application-default login。
