const express = require('express');
const router = express.Router();
const axios = require('axios');
const { analyzeEventImage } = require('../services/eventVision');

const EXTRACTOR_T_URL = process.env.EXTRACTOR_T_URL || 'https://api.standatpd.com';

/**
 * Validate if URL is from Instagram
 * @param {string} url - URL to validate
 * @returns {boolean}
 */
function isInstagramUrl(url) {
  return url.includes('instagram.com') || url.includes('instagr.am');
}

/**
 * POST /api/events/analyze-url
 * Extract images from Instagram post (no analysis - extraction only)
 */
router.post('/analyze-url', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required'
      });
    }

    // Validate Instagram URL
    if (!isInstagramUrl(url)) {
      return res.status(400).json({
        success: false,
        error: 'URL no soportada. Por ahora solo aceptamos Instagram.'
      });
    }

    console.log(`[URL_EXTRACTION] Processing Instagram URL: ${url}`);

    // Extract images via ExtractorT (120s timeout - Instagram extraction can be slow)
    console.log(`[URL_EXTRACTION] Calling ExtractorT at ${EXTRACTOR_T_URL}/instagram/simple`);
    const extractorStart = Date.now();
    const extractorResponse = await axios.post(
      `${EXTRACTOR_T_URL}/instagram/simple`,
      { url },
      { timeout: 120000 }
    );
    console.log(`[URL_EXTRACTION] ExtractorT responded in ${Date.now() - extractorStart}ms (status: ${extractorResponse.status})`);

    // Get all media items (supports carousels)
    const mediaItems = extractorResponse.data.media || [];
    if (mediaItems.length === 0) {
      console.log('[URL_EXTRACTION] No media items returned from ExtractorT');
      return res.status(400).json({
        success: false,
        error: 'No se encontró imagen en el post de Instagram.'
      });
    }

    const postMetadata = {
      author: extractorResponse.data.author,
      description: extractorResponse.data.description
    };

    // Get all image URLs
    const extractedImages = mediaItems
      .filter(m => m?.url && m.type === 'image')
      .map(m => m.url);

    console.log(`[URL_EXTRACTION] Found ${extractedImages.length} image(s) in post`);

    if (extractedImages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No se encontraron imágenes en el post de Instagram.'
      });
    }

    res.json({
      success: true,
      source_url: url,
      platform: 'instagram',
      extracted_images: extractedImages,
      is_reel: extractorResponse.data.is_reel || false,
      post_metadata: postMetadata
    });

  } catch (error) {
    console.error(`[URL_EXTRACTION] Error: ${error.message}`);
    if (error.code) console.error(`[URL_EXTRACTION] Error code: ${error.code}`);

    // Handle timeout
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      console.error('[URL_EXTRACTION] Request timed out');
      return res.status(504).json({
        success: false,
        error: 'Tiempo de espera agotado. Intenta de nuevo.'
      });
    }

    // Handle ExtractorT errors
    if (error.response?.status) {
      console.error(`[URL_EXTRACTION] ExtractorT error (HTTP ${error.response.status}):`, error.response.data);
    }

    res.status(500).json({
      success: false,
      error: error.message || 'No pudimos extraer el contenido del post.'
    });
  }
});

/**
 * POST /api/events/analyze-extracted-image
 * Analyze a single extracted image for event details (on-demand)
 */
router.post('/analyze-extracted-image', async (req, res) => {
  try {
    const { image_url, title } = req.body;

    if (!image_url) {
      return res.status(400).json({
        success: false,
        error: 'image_url is required'
      });
    }

    console.log(`[IMAGE_ANALYSIS] Analyzing image: ${image_url}`);

    // Download image and convert to base64
    const imageResponse = await axios.get(image_url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    const base64Image = Buffer.from(imageResponse.data, 'binary').toString('base64');
    const mimeType = imageResponse.headers['content-type'] || 'image/jpeg';
    const base64DataUrl = `data:${mimeType};base64,${base64Image}`;

    console.log(`[IMAGE_ANALYSIS] Image downloaded (${(base64Image.length / 1024).toFixed(2)} KB)`);

    // Analyze image with Vision API
    const analysisResult = await analyzeEventImage(
      base64DataUrl,
      title || 'Event Post'
    );

    console.log(`[IMAGE_ANALYSIS] Analysis complete: "${analysisResult.analysis.event_name}"`);

    res.json({
      success: true,
      analysis: analysisResult.analysis,
      metadata: analysisResult.metadata
    });

  } catch (error) {
    console.error(`[IMAGE_ANALYSIS] Error: ${error.message}`);

    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return res.status(504).json({
        success: false,
        error: 'Tiempo de espera agotado al descargar la imagen.'
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Error al analizar la imagen.'
    });
  }
});

module.exports = router;
