const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getSupabase } = require('../utils/supabase');
const { analyzeEventImage } = require('../services/eventVision');

const EXTRACTOR_T_URL = process.env.EXTRACTOR_T_URL || 'https://api.standatpd.com';

/**
 * POST /api/extraction-jobs/process/:id
 * Process an extraction job - extract images from Instagram
 * Called by frontend after creating job in Supabase
 */
router.post('/process/:id', async (req, res) => {
  const { id } = req.params;
  const supabase = getSupabase();

  if (!supabase) {
    return res.status(503).json({ success: false, error: 'Database unavailable' });
  }

  // Respond immediately - processing happens async
  res.json({ success: true, message: 'Processing started' });

  try {
    // Get the job
    const { data: job, error: fetchError } = await supabase
      .from('extraction_jobs')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !job) {
      console.error(`[EXTRACTION_JOB] Job ${id} not found:`, fetchError);
      return;
    }

    if (job.status !== 'pending') {
      console.log(`[EXTRACTION_JOB] Job ${id} already processed (status: ${job.status})`);
      return;
    }

    // Update status to extracting
    await supabase
      .from('extraction_jobs')
      .update({ status: 'extracting' })
      .eq('id', id);

    console.log(`[EXTRACTION_JOB] Processing job ${id}: ${job.source_url}`);

    // Call ExtractorT
    const extractorResponse = await axios.post(
      `${EXTRACTOR_T_URL}/instagram/simple`,
      { url: job.source_url },
      { timeout: 120000 }
    );

    const mediaItems = extractorResponse.data.media || [];
    const extractedImages = mediaItems
      .filter(m => m?.url && m.type === 'image')
      .map(m => m.url);

    if (extractedImages.length === 0) {
      // No images found - mark as failed
      await supabase
        .from('extraction_jobs')
        .update({
          status: 'failed',
          error_message: 'No se encontraron imágenes en el post de Instagram.'
        })
        .eq('id', id);
      console.log(`[EXTRACTION_JOB] Job ${id} failed: no images found`);
      return;
    }

    // Update with extracted images
    await supabase
      .from('extraction_jobs')
      .update({
        status: 'ready',
        extracted_images: extractedImages
      })
      .eq('id', id);

    console.log(`[EXTRACTION_JOB] Job ${id} ready: ${extractedImages.length} images`);

  } catch (error) {
    console.error(`[EXTRACTION_JOB] Error processing job ${id}:`, error.message);

    // Update job with error
    try {
      await supabase
        .from('extraction_jobs')
        .update({
          status: 'failed',
          error_message: error.code === 'ECONNABORTED' || error.message.includes('timeout')
            ? 'Tiempo de espera agotado. Intenta de nuevo.'
            : error.message || 'Error de extracción'
        })
        .eq('id', id);
    } catch (updateError) {
      console.error(`[EXTRACTION_JOB] Failed to update error status:`, updateError);
    }
  }
});

/**
 * POST /api/extraction-jobs/analyze/:id
 * Analyze selected image for an extraction job
 * Called by frontend after user selects an image
 */
router.post('/analyze/:id', async (req, res) => {
  const { id } = req.params;
  const { image_url } = req.body;
  const supabase = getSupabase();

  if (!supabase) {
    return res.status(503).json({ success: false, error: 'Database unavailable' });
  }

  if (!image_url) {
    return res.status(400).json({ success: false, error: 'image_url is required' });
  }

  // Respond immediately - analysis happens async
  res.json({ success: true, message: 'Analysis started' });

  try {
    // Get the job
    const { data: job, error: fetchError } = await supabase
      .from('extraction_jobs')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !job) {
      console.error(`[EXTRACTION_JOB] Job ${id} not found:`, fetchError);
      return;
    }

    if (job.status !== 'ready') {
      console.log(`[EXTRACTION_JOB] Job ${id} not ready for analysis (status: ${job.status})`);
      return;
    }

    // Update status to analyzing with selected image
    await supabase
      .from('extraction_jobs')
      .update({
        status: 'analyzing',
        selected_image_url: image_url
      })
      .eq('id', id);

    console.log(`[EXTRACTION_JOB] Analyzing job ${id}: ${image_url}`);

    // Download image and convert to base64
    const imageResponse = await axios.get(image_url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
      }
    });

    const base64Image = Buffer.from(imageResponse.data, 'binary').toString('base64');
    const mimeType = imageResponse.headers['content-type'] || 'image/jpeg';
    const base64DataUrl = `data:${mimeType};base64,${base64Image}`;

    // Analyze with Vision API
    const analysisResult = await analyzeEventImage(base64DataUrl, 'Event Post');

    // Update job with analysis result
    await supabase
      .from('extraction_jobs')
      .update({
        status: 'completed',
        analysis_result: analysisResult.analysis
      })
      .eq('id', id);

    console.log(`[EXTRACTION_JOB] Job ${id} completed: "${analysisResult.analysis.event_name}"`);

  } catch (error) {
    console.error(`[EXTRACTION_JOB] Error analyzing job ${id}:`, error.message);

    // Update job with error
    try {
      await supabase
        .from('extraction_jobs')
        .update({
          status: 'failed',
          error_message: error.message || 'Error de análisis'
        })
        .eq('id', id);
    } catch (updateError) {
      console.error(`[EXTRACTION_JOB] Failed to update error status:`, updateError);
    }
  }
});

/**
 * GET /api/extraction-jobs/pending
 * Get all pending jobs (for worker polling - internal use)
 */
router.get('/pending', async (req, res) => {
  const supabase = getSupabase();

  if (!supabase) {
    return res.status(503).json({ success: false, error: 'Database unavailable' });
  }

  try {
    const { data: jobs, error } = await supabase
      .from('extraction_jobs')
      .select('id, source_url, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(10);

    if (error) {
      throw error;
    }

    res.json({ success: true, jobs: jobs || [] });

  } catch (error) {
    console.error('[EXTRACTION_JOB] Error fetching pending jobs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
