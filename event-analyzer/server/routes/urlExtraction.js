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
 * Extract image from Instagram post and analyze it for event details
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

    // Extract image via ExtractorT (120s timeout - Instagram extraction can be slow)
    const extractorResponse = await axios.post(
      `${EXTRACTOR_T_URL}/instagram/simple`,
      { url },
      { timeout: 120000 }
    );

    // Get first media item
    const media = extractorResponse.data.media?.[0];
    if (!media?.url) {
      return res.status(400).json({
        success: false,
        error: 'No se encontró imagen en el post de Instagram.'
      });
    }

    const imageUrl = media.url;
    const postMetadata = {
      author: extractorResponse.data.author,
      description: extractorResponse.data.description
    };

    console.log(`[URL_EXTRACTION] Extracted image: ${imageUrl}`);

    // Analyze extracted image with Vision API
    const analysisResult = await analyzeEventImage(
      imageUrl,
      postMetadata?.description || 'Event Post'
    );

    // Return response in same format as /analyze-image
    res.json({
      success: true,
      analysis: analysisResult.analysis,
      metadata: {
        ...analysisResult.metadata,
        source_url: url,
        platform: 'instagram',
        extracted_image_url: imageUrl,
        post_metadata: postMetadata
      }
    });

  } catch (error) {
    console.error('[URL_EXTRACTION] Error:', error.message);

    // Handle timeout
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return res.status(504).json({
        success: false,
        error: 'Tiempo de espera agotado. Intenta de nuevo.'
      });
    }

    // Handle ExtractorT errors
    if (error.response?.status) {
      console.error('[URL_EXTRACTION] ExtractorT error:', error.response.data);
    }

    res.status(500).json({
      success: false,
      error: error.message || 'No pudimos extraer el contenido del post.'
    });
  }
});

module.exports = router;
