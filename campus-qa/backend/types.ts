export interface DocumentChunk {
  id: string;
  title: string;
  chunk_text: string;
  source_url: string;
  updated_at: string;
  embedding: number[];
  tags: string[];
}

export interface AskRequestBody {
  question: string;
}

export interface AskResponseBody {
  answer: string;
  sources: Array<Pick<DocumentChunk, 'title' | 'source_url' | 'updated_at'> & { score: number }>;
}

export interface IngestRequestBody {
  prefix?: string;
}
