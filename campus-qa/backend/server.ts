import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { storage, firestore } from './gcloud.js';
import { chunkText, embedText, embedTexts, searchTopK, buildPrompt, fetchAllChunks, generateAnswer } from './rag.js';
import { AskRequestBody, AskResponseBody, DocumentChunk, IngestRequestBody } from './types.js';

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '4mb' }));

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const COLLECTION = process.env.FIRESTORE_COLLECTION || 'chunks';
const DEFAULT_BUCKET = (process.env.GCS_BUCKET || '').replace('gs://', '');

if (!DEFAULT_BUCKET) {
  console.warn('Warning: GCS_BUCKET environment variable is not set. Ingest endpoint will fail until configured.');
}

interface IngestResult {
  file: string;
  chunks: number;
  error?: string;
}

function parseGcsUri(uri: string): { bucket: string; prefix: string } {
  if (!uri.startsWith('gs://')) {
    if (!DEFAULT_BUCKET) {
      throw new Error('GCS bucket is not configured');
    }
    return { bucket: DEFAULT_BUCKET, prefix: uri.replace(/^\//, '') };
  }
  const [, , bucketAndPath] = uri.split('/');
  const [bucket, ...pathParts] = bucketAndPath.split('/');
  const prefix = pathParts.join('/');
  return { bucket, prefix };
}

async function ingestFile(bucketName: string, objectName: string, tags: string[] = []): Promise<IngestResult> {
  const file = storage.bucket(bucketName).file(objectName);
  const [contents] = await file.download();
  const text = contents.toString('utf8');
  const chunks = chunkText(text);
  const embeddings = await embedTexts(chunks);
  const baseId = objectName.replace(/[^a-zA-Z0-9_-]+/g, '_');
  const now = new Date().toISOString();
  const title = objectName.split('/').pop() || objectName;
  const sourceUrl = `https://storage.googleapis.com/${bucketName}/${encodeURIComponent(objectName)}`;

  const batch = firestore.batch();
  chunks.forEach((chunk, index) => {
    const id = `${baseId}_${index}`;
    const docRef = firestore.collection(COLLECTION).doc(id);
    const payload: DocumentChunk = {
      id,
      title,
      chunk_text: chunk,
      source_url: sourceUrl,
      updated_at: now,
      embedding: embeddings[index] || [],
      tags,
    };
    batch.set(docRef, payload, { merge: true });
  });
  await batch.commit();
  return { file: objectName, chunks: chunks.length };
}

app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).send('ok');
});

app.post('/api/ask', async (req: Request<unknown, unknown, AskRequestBody>, res: Response<AskResponseBody | { error: string }>) => {
  try {
    const question = req.body?.question?.trim();
    if (!question) {
      res.status(400).json({ error: 'question is required' } as any);
      return;
    }
    const [questionEmbedding, chunks] = await Promise.all([
      embedText(question),
      fetchAllChunks(),
    ]);

    if (chunks.length === 0) {
      res.status(200).json({
        answer: '当前还没有可用的资料，请联系管理员先导入文档。',
        sources: [],
      });
      return;
    }

    const topChunks = searchTopK(questionEmbedding, chunks);
    const prompt = buildPrompt(question, topChunks);
    const answer = await generateAnswer(prompt);

    const response: AskResponseBody = {
      answer,
      sources: topChunks.map((chunk) => ({
        title: chunk.title,
        source_url: chunk.source_url,
        updated_at: chunk.updated_at,
        score: chunk.score,
      })),
    };
    res.json(response);
  } catch (error) {
    console.error('Error in /api/ask', error);
    res.status(500).json({ error: 'internal_error' } as any);
  }
});

app.post('/admin/ingest', async (req: Request<unknown, unknown, IngestRequestBody>, res: Response) => {
  try {
    if (!ADMIN_TOKEN) {
      res.status(500).json({ error: 'ADMIN_TOKEN not configured' });
      return;
    }
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ') || authHeader.slice('Bearer '.length) !== ADMIN_TOKEN) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const prefixInput = req.body?.prefix || `${process.env.GCS_BUCKET || ''}/seed/`;
    const { bucket, prefix } = parseGcsUri(prefixInput);
    const [files] = await storage.bucket(bucket).getFiles({ prefix });

    if (!files.length) {
      res.json({ message: 'no files found', processed: [], failed: [] });
      return;
    }

    const results: IngestResult[] = [];
    const failed: IngestResult[] = [];

    for (const file of files) {
      if (file.name.endsWith('/')) continue;
      try {
        const tags: string[] = [];
        const result = await ingestFile(bucket, file.name, tags);
        results.push(result);
      } catch (err: any) {
        console.error(`Failed to ingest ${file.name}`, err);
        failed.push({ file: file.name, chunks: 0, error: err.message });
      }
    }

    res.json({
      message: 'ingest completed',
      processed: results,
      failed,
    });
  } catch (error) {
    console.error('Error in /admin/ingest', error);
    res.status(500).json({ error: 'internal_error' });
  }
});

const PORT = Number.parseInt(process.env.PORT || '8080', 10);

if (process.argv[1] === new URL(import.meta.url).pathname) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

export default app;
