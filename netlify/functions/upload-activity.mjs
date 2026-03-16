import { getSupabase } from './lib/supabase.mjs';
import { getUserIdFromRequest } from './lib/auth.mjs';
import { randomUUID } from 'crypto';

const ALLOWED_EXTENSIONS = ['fit', 'gpx', 'tcx'];
const MAX_BASE64_SIZE = 6 * 1024 * 1024; // 6MB (Netlify body limit)
const MAX_UPLOADS_PER_HOUR = 10;

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  const body = await req.json();
  const { filename, data, name, description } = body;

  if (!filename || !data) {
    return new Response(JSON.stringify({ error: 'Missing filename or data' }), { status: 400 });
  }

  const ext = filename.split('.').pop().toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return new Response(JSON.stringify({ error: `Unsupported format: .${ext}. Use .fit, .gpx, or .tcx` }), { status: 400 });
  }

  if (data.length > MAX_BASE64_SIZE) {
    return new Response(JSON.stringify({ error: 'File too large (max ~4.5MB)' }), { status: 413 });
  }

  const db = getSupabase();

  // Rate limit: max uploads per hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from('uploads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', oneHourAgo);

  if (count >= MAX_UPLOADS_PER_HOUR) {
    return new Response(JSON.stringify({ error: 'Upload limit reached (10/hour). Try again later.' }), { status: 429 });
  }

  // Decode and validate
  let fileBuffer;
  try {
    fileBuffer = Buffer.from(data, 'base64');
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid base64 data' }), { status: 400 });
  }

  if (fileBuffer.length === 0) {
    return new Response(JSON.stringify({ error: 'Empty file' }), { status: 400 });
  }

  // Validate magic bytes
  if (ext === 'fit') {
    const sig = fileBuffer.slice(8, 12).toString('ascii');
    if (sig !== '.FIT') {
      return new Response(JSON.stringify({ error: 'Invalid FIT file' }), { status: 400 });
    }
  }

  const uploadId = randomUUID();

  // Store raw file in Supabase Storage
  const storagePath = `${userId}/${uploadId}.${ext}`;
  const { error: storageError } = await db.storage
    .from('uploads')
    .upload(storagePath, fileBuffer, {
      contentType: 'application/octet-stream',
      upsert: false,
    });

  if (storageError) {
    console.error('Storage upload error:', storageError);
    return new Response(JSON.stringify({ error: 'Failed to store file' }), { status: 500 });
  }

  // Create upload record
  const { error: dbError } = await db.from('uploads').insert({
    id: uploadId,
    user_id: userId,
    filename,
    file_format: ext,
    file_size: fileBuffer.length,
    activity_name: name || null,
    activity_description: description || null,
    status: 'pending',
  });

  if (dbError) {
    console.error('Upload record error:', dbError);
    return new Response(JSON.stringify({ error: 'Failed to create upload record' }), { status: 500 });
  }

  // Dispatch background processing
  fetch(`${process.env.SITE_URL}/api/parse-upload-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, userId }),
  }).catch((err) => console.error('Parse dispatch error:', err));

  return new Response(JSON.stringify({ uploadId, status: 'processing' }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
