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

    // Download image and convert to base64
    console.log(`[URL_EXTRACTION] Downloading image from Instagram CDN...`);
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    // Convert to base64
    const base64Image = Buffer.from(imageResponse.data, 'binary').toString('base64');
    const mimeType = imageResponse.headers['content-type'] || 'image/jpeg';
    const base64DataUrl = `data:${mimeType};base64,${base64Image}`;
    
    console.log(`[URL_EXTRACTION] Image downloaded successfully (${(base64Image.length / 1024).toFixed(2)} KB)`);

    // Analyze image with Vision API using base64
    const analysisResult = await analyzeEventImage(
      base64DataUrl,
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
