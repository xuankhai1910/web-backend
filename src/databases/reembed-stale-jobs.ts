import mongoose from 'mongoose';
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import * as crypto from 'crypto';
import {
  EMBEDDING_DIMS,
  EMBEDDING_MODEL,
  EMBEDDING_TEXT_VERSION,
} from '../cv-analysis/cv-embedding.service';

type JobForEmbedding = {
  _id: mongoose.Types.ObjectId;
  name?: string;
  category?: string;
  specialization?: string;
  skills?: string[];
  level?: string;
  jobType?: string;
  workMode?: string;
  location?: string;
  yearsOfExperience?: { min?: number; max?: number };
  requirements?: string[];
  responsibilities?: string[];
  description?: string;
  embedding?: number[];
  embeddingHash?: string;
};

const keys = (
  process.env.GEMINI_API_KEYS ||
  process.env.GEMINI_API_KEY ||
  ''
)
  .split(',')
  .map((key) => key.trim())
  .filter(Boolean);

const clients = keys.map((apiKey) => ({ apiKey, client: new GoogleGenAI({ apiKey }) }));
let cursor = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hash(text: string) {
  return crypto
    .createHash('sha256')
    .update(
      `${EMBEDDING_MODEL}:${EMBEDDING_DIMS}:${EMBEDDING_TEXT_VERSION}\n${text}`,
    )
    .digest('hex');
}

function stripAndTruncate(html: string, maxLen: number) {
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

function compactParts(parts: string[]) {
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('. ');
}

function joinList(values?: string[]) {
  return Array.from(
    new Set((values || []).map((value) => value?.trim()).filter(Boolean)),
  ).join(', ');
}

function buildJobText(job: JobForEmbedding) {
  const yoe = job.yearsOfExperience;
  const yoeStr =
    yoe && (yoe.min !== undefined || yoe.max !== undefined)
      ? `YOE: ${yoe.min ?? 0}-${yoe.max ?? yoe.min ?? 0} years`
      : '';
  const skills = joinList(job.skills);
  const parts = [
    job.name ? `Role: ${job.name}` : '',
    skills ? `Core skills: ${skills}` : '',
    job.category ? `Category: ${job.category}` : '',
    job.specialization ? `Specialization: ${job.specialization}` : '',
    job.level ? `Seniority: ${job.level}` : '',
    job.jobType ? `JobType: ${job.jobType}` : '',
    job.workMode ? `WorkMode: ${job.workMode}` : '',
    job.location ? `Location: ${job.location}` : '',
    yoeStr,
    (job.requirements || []).length > 0
      ? `Requirements: ${(job.requirements || []).join('; ')}`
      : '',
    (job.responsibilities || []).length > 0
      ? `Responsibilities: ${(job.responsibilities || []).join('; ')}`
      : '',
    stripAndTruncate(job.description || '', 800),
  ];
  return compactParts(parts);
}

function retryDelayMs(error: unknown) {
  const message = (error as Error)?.message || String(error);
  const retry = message.match(/retry in ([\d.]+)s/i);
  if (retry) return Math.ceil(Number(retry[1]) * 1000) + 1500;
  if (
    message.includes('429') ||
    message.includes('RESOURCE_EXHAUSTED') ||
    message.includes('rate')
  ) {
    return 61_000;
  }
  if (
    message.includes('503') ||
    message.includes('UNAVAILABLE') ||
    message.includes('overloaded') ||
    message.includes('currently unavailable')
  ) {
    return 15_000;
  }
  return 0;
}

async function embedWithRetry(text: string) {
  for (let attempt = 1; attempt <= 20; attempt++) {
    const picked = clients[cursor % clients.length];
    cursor++;
    try {
      const res = await picked.client.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: [text],
        config: { outputDimensionality: EMBEDDING_DIMS },
      });
      const values = res.embeddings?.[0]?.values;
      if (!values?.length) throw new Error('empty embedding vector');
      return values;
    } catch (error) {
      const waitMs = retryDelayMs(error);
      const tail = picked.apiKey.slice(-6);
      console.warn(
        `embed attempt ${attempt} failed on key ...${tail}: ${(error as Error).message}`,
      );
      if (waitMs <= 0) throw error;
      if (attempt === 20) return [];
      console.warn(`waiting ${Math.ceil(waitMs / 1000)}s before retry`);
      await sleep(waitMs);
    }
  }
  return [];
}

async function main() {
  if (clients.length === 0) {
    throw new Error('No GEMINI_API_KEY / GEMINI_API_KEYS configured');
  }

  await mongoose.connect(process.env.MONGODB_URI as string);
  const jobs = mongoose.connection.db!.collection<JobForEmbedding>('jobs');
  const all = await jobs
    .find(
      {},
      {
        projection: {
          name: 1,
          category: 1,
          specialization: 1,
          skills: 1,
          level: 1,
          jobType: 1,
          workMode: 1,
          location: 1,
          yearsOfExperience: 1,
          requirements: 1,
          responsibilities: 1,
          description: 1,
          embedding: 1,
          embeddingHash: 1,
        },
      },
    )
    .toArray();

  const stale = all
    .map((job) => {
      const text = buildJobText(job);
      const nextHash = hash(text);
      return { job, text, nextHash };
    })
    .filter(({ job, nextHash }) => job.embeddingHash !== nextHash);

  console.log(`jobs=${all.length} stale=${stale.length}`);

  let embedded = 0;
  for (const item of stale) {
    const vector = await embedWithRetry(item.text);
    if (vector.length === 0) {
      console.warn(`skipped ${item.job._id}: embedding quota still unavailable`);
      continue;
    }
    await jobs.updateOne(
      { _id: item.job._id },
      { $set: { embedding: vector, embeddingHash: item.nextHash } },
    );
    embedded++;
    await sleep(900);
    if (embedded % 10 === 0 || embedded === stale.length) {
      console.log(`embedded=${embedded}/${stale.length}`);
    }
  }

  console.log(`done embedded=${embedded}/${stale.length}`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
