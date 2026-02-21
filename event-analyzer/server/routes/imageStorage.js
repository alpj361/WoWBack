const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getSupabase, isConfigured } = require('../utils/supabase');

const BUCKET_NAME = 'event-images';

/**
 * Ensure the storage bucket exists (creates it if missing).
 * Called lazily on first use.
 */
async function ensureBucket(supabase) {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw error;

  const exists = buckets.some((b) => b.name === BUCKET_NAME);
  if (!exists) {
    const { error: createError } = await supabase.storage.createBucket(BUCKET_NAME, {
      public: true,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      fileSizeLimit: 10 * 1024 * 1024, // 10 MB
    });
    if (createError) throw createError;
    console.log(`[IMAGE_STORAGE] ✅ Bucket "${BUCKET_NAME}" created`);
  }
}

/**
 * Download an image from a URL and return its Buffer + content-type.
 */
async function downloadImage(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 15000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; WoWEventBot/1.0; +https://standatpd.com)',
    },
    maxRedirects: 5,
  });

  const contentType = response.headers['content-type'] || 'image/jpeg';
  const buffer = Buffer.from(response.data);
  return { buffer, contentType };
}

/**
 * Upload a buffer to Supabase Storage and return the public URL.
 */
async function uploadToStorage(supabase, buffer, contentType, filename) {
  await ensureBucket(supabase);

  const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg';
  const path = `events/${filename}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(path, buffer, {
      contentType,
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(path);
  return data.publicUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/storage/upload-image-url
// Body: { url: string, event_id?: string, filename?: string }
// Downloads the image from `url` and saves it to Supabase Storage.
// If `event_id` is provided, also updates the event's image column.
// Returns: { success, publicUrl }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/upload-image-url', async (req, res) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ success: false, error: 'Database not configured' });
    }

    const { url, event_id, filename } = req.body;

    if (!url) {
      return res.status(400).json({ success: false, error: 'url is required' });
    }

    console.log(`[IMAGE_STORAGE] Downloading image from ${url}`);
    const { buffer, contentType } = await downloadImage(url);

    const safeFilename =
      filename ||
      (event_id ? `event_${event_id}_${Date.now()}` : `img_${Date.now()}`);

    const supabase = getSupabase();
    const publicUrl = await uploadToStorage(supabase, buffer, contentType, safeFilename);

    console.log(`[IMAGE_STORAGE] ✅ Uploaded → ${publicUrl}`);

    // Optionally update the event record
    if (event_id) {
      const { error: updateError } = await supabase
        .from('events')
        .update({ image: publicUrl })
        .eq('id', event_id);

      if (updateError) {
        console.error('[IMAGE_STORAGE] ⚠️  Event update failed:', updateError.message);
      } else {
        console.log(`[IMAGE_STORAGE] ✅ Event ${event_id} image updated`);
      }
    }

    return res.json({ success: true, publicUrl });
  } catch (err) {
    console.error('[IMAGE_STORAGE] ❌ Error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload image',
      message: err.message,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/storage/upload-image-base64
// Body: { base64: string (data URI or raw), event_id?: string, filename?: string }
// Uploads a base64 image directly to Supabase Storage.
// Returns: { success, publicUrl }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/upload-image-base64', async (req, res) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ success: false, error: 'Database not configured' });
    }

    const { base64, event_id, filename } = req.body;

    if (!base64) {
      return res.status(400).json({ success: false, error: 'base64 is required' });
    }

    // Parse data URI if present: "data:image/jpeg;base64,<data>"
    let contentType = 'image/jpeg';
    let rawBase64 = base64;

    if (base64.startsWith('data:')) {
      const match = base64.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ success: false, error: 'Invalid base64 data URI' });
      }
      contentType = match[1];
      rawBase64 = match[2];
    }

    const buffer = Buffer.from(rawBase64, 'base64');

    const safeFilename =
      filename ||
      (event_id ? `event_${event_id}_${Date.now()}` : `img_${Date.now()}`);

    const supabase = getSupabase();
    const publicUrl = await uploadToStorage(supabase, buffer, contentType, safeFilename);

    console.log(`[IMAGE_STORAGE] ✅ Base64 uploaded → ${publicUrl}`);

    if (event_id) {
      const { error: updateError } = await supabase
        .from('events')
        .update({ image: publicUrl })
        .eq('id', event_id);

      if (updateError) {
        console.error('[IMAGE_STORAGE] ⚠️  Event update failed:', updateError.message);
      } else {
        console.log(`[IMAGE_STORAGE] ✅ Event ${event_id} image updated`);
      }
    }

    return res.json({ success: true, publicUrl });
  } catch (err) {
    console.error('[IMAGE_STORAGE] ❌ Error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload base64 image',
      message: err.message,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/storage/migrate-event-images
// Body: { limit?: number }   (default: process all events with external image URLs)
// Iterates over events whose `image` field is NOT already a Supabase Storage URL,
// downloads + re-uploads each one, and patches the event record.
// Returns: { success, migrated, failed, results[] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/migrate-event-images', async (req, res) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ success: false, error: 'Database not configured' });
    }

    const limit = parseInt(req.body.limit) || 50;
    const supabase = getSupabase();
    const supabaseUrl = process.env.SUPABASE_URL || '';

    // Fetch events that have an image but it is NOT already stored in Supabase Storage
    const { data: events, error } = await supabase
      .from('events')
      .select('id, title, image')
      .not('image', 'is', null)
      .limit(limit);

    if (error) throw error;

    const toMigrate = (events || []).filter(
      (e) => e.image && !e.image.includes(supabaseUrl) && !e.image.includes('supabase.co/storage')
    );

    console.log(`[IMAGE_STORAGE] Found ${toMigrate.length} events to migrate`);

    const results = [];
    let migrated = 0;
    let failed = 0;

    for (const event of toMigrate) {
      try {
        const { buffer, contentType } = await downloadImage(event.image);
        const filename = `event_${event.id}_${Date.now()}`;
        const publicUrl = await uploadToStorage(supabase, buffer, contentType, filename);

        // Update the event record
        await supabase.from('events').update({ image: publicUrl }).eq('id', event.id);

        migrated++;
        results.push({ id: event.id, title: event.title, status: 'migrated', publicUrl });
        console.log(`[IMAGE_STORAGE] ✅ Migrated event "${event.title}"`);

        // Small delay to avoid rate limits
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        failed++;
        results.push({ id: event.id, title: event.title, status: 'failed', error: err.message });
        console.error(`[IMAGE_STORAGE] ❌ Failed for event "${event.title}":`, err.message);
      }
    }

    return res.json({ success: true, migrated, failed, total: toMigrate.length, results });
  } catch (err) {
    console.error('[IMAGE_STORAGE] ❌ Migration error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Migration failed',
      message: err.message,
    });
  }
});

module.exports = router;
