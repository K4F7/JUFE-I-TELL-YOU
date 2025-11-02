import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import * as aiplatform from '@google-cloud/aiplatform';

const projectId = process.env.PROJECT_ID || process.env.GCLOUD_PROJECT;
const location = process.env.REGION || 'us-central1';

if (!projectId) {
  throw new Error('PROJECT_ID environment variable is required');
}

const vertexAI = new (aiplatform as any).VertexAI({
  project: projectId,
  location,
});

export const firestore = new Firestore({ projectId });
export const storage = new Storage({ projectId });

export function getEmbeddingModel(model = 'text-embedding-004') {
  return vertexAI.getTextEmbeddingModel(model);
}

export function getGenerativeModel(model = process.env.GEMINI_MODEL || 'gemini-1.5-pro') {
  return vertexAI.getGenerativeModel({ model });
}
