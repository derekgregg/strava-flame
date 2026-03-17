import { getSupabase } from './lib/supabase.mjs';
import { parseActivityFile } from './lib/file-parser.mjs';
import { processActivity } from './lib/activity.mjs';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { uploadId, userId } = JSON.parse(event.body);
  if (!uploadId || !userId) {
    return { statusCode: 400, body: 'Missing uploadId or userId' };
  }

  const db = getSupabase();

  // Update status to processing
  await db.from('uploads').update({ status: 'processing' }).eq('id', uploadId);

  try {
    // Get upload record
    const { data: upload } = await db
      .from('uploads')
      .select('*')
      .eq('id', uploadId)
      .single();

    if (!upload) throw new Error('Upload record not found');

    // Fetch file from Supabase Storage
    const storagePath = `${userId}/${uploadId}.${upload.file_format}`;
    const { data: fileData, error: dlError } = await db.storage
      .from('uploads')
      .download(storagePath);

    if (dlError) throw new Error(`Storage download failed: ${dlError.message}`);

    const buffer = Buffer.from(await fileData.arrayBuffer());

    // Parse the file
    const activity = await parseActivityFile(buffer, upload.filename);

    // Use user-provided name if available, fall back to parsed name, or generic
    activity.name = upload.activity_name || activity.name || (activity.sport_type || 'Activity');
    if (upload.activity_description) {
      activity.description = upload.activity_description;
    }

    // Get user
    const { data: user } = await db
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (!user) throw new Error('User not found');

    // Process through the unified pipeline (dedup + commentary)
    const result = await processActivity({
      userId,
      platform: 'upload',
      platformActivityId: `upload:${uploadId}`,
      activity,
      user,
    });

    // Update upload record
    await db.from('uploads').update({
      status: 'complete',
      activity_id: result.activityDbId || null,
      completed_at: new Date().toISOString(),
    }).eq('id', uploadId);

    // Raw file kept in storage for 30 days in case we need to reprocess.
    // Cleanup handled by purge-old-activities.mjs.

    console.log(`Upload ${uploadId} processed: ${result.reason}`);
  } catch (err) {
    console.error(`Upload ${uploadId} failed:`, err);
    await db.from('uploads').update({
      status: 'error',
      error_message: err.message,
      completed_at: new Date().toISOString(),
    }).eq('id', uploadId);
  }

  return { statusCode: 200, body: 'OK' };
};
