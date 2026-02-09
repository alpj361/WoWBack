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

    // Extract images via ExtractorT (120s timeout - Instagram extraction can be slow)
    const extractorResponse = await axios.post(
      `${EXTRACTOR_T_URL}/instagram/simple`,
      { url },
      { timeout: 120000 }
    );

    // Get all media items (supports carousels)
    const mediaItems = extractorResponse.data.media || [];
    if (mediaItems.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No se encontró imagen en el post de Instagram.'
      });
    }

    const postMetadata = {
      author: extractorResponse.data.author,
      description: extractorResponse.data.description
    };

    console.log(`[URL_EXTRACTION] Found ${mediaItems.length} image(s) in post`);

    // Process all images in carousel
    const events = [];

    for (let i = 0; i < mediaItems.length; i++) {
      const media = mediaItems[i];
      if (!media?.url) continue;

      try {
        console.log(`[URL_EXTRACTION] Processing image ${i + 1}/${mediaItems.length}: ${media.url}`);

        // Download image and convert to base64
        const imageResponse = await axios.get(media.url, {
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

        console.log(`[URL_EXTRACTION] Image ${i + 1} downloaded (${(base64Image.length / 1024).toFixed(2)} KB)`);

        // Analyze image with Vision API
        const analysisResult = await analyzeEventImage(
          base64DataUrl,
          postMetadata?.description || 'Event Post'
        );

        // Check if this image contains valid event data
        const analysis = analysisResult.analysis;
        const hasEventData = analysis.event_name &&
          analysis.event_name !== 'No especificado' &&
          analysis.event_name !== 'N/A' &&
          !analysis.event_name.toLowerCase().includes('portada') &&
          !analysis.event_name.toLowerCase().includes('título') &&
          !analysis.event_name.toLowerCase().includes('cover');

        if (hasEventData) {
          events.push({
            analysis: analysis,
            metadata: {
              ...analysisResult.metadata,
              image_index: i,
              extracted_image_url: media.url
            }
          });
          console.log(`[URL_EXTRACTION] ✅ Image ${i + 1} contains valid event data: "${analysis.event_name}"`);
        } else {
          console.log(`[URL_EXTRACTION] ⏭️  Image ${i + 1} skipped (no event data or cover/title)`);
        }

      } catch (imageError) {
        console.error(`[URL_EXTRACTION] Error processing image ${i + 1}:`, imageError.message);
        // Continue with next image
      }
    }

    // Get all image URLs for carousel selector
    const allImageUrls = mediaItems
      .filter(m => m?.url && m.type === 'image')
      .map(m => m.url);

    // Return results
    if (events.length === 0) {
      // Even if no events detected, return images for user to select
      // This allows users to pick an image even if analysis failed
      if (allImageUrls.length > 0) {
        return res.json({
          success: true,
          source_url: url,
          platform: 'instagram',
          extracted_image_url: allImageUrls[0],
          extracted_images: allImageUrls.length > 1 ? allImageUrls : undefined,
          is_reel: extractorResponse.data.is_reel || false,
          analysis: null, // No analysis available
          post_metadata: postMetadata
        });
      }

      return res.status(400).json({
        success: false,
        error: 'No se encontraron eventos válidos en las imágenes.'
      });
    }

    // Return response with first valid event and all images
    const bestEvent = events[0];
    res.json({
      success: true,
      source_url: url,
      platform: 'instagram',
      extracted_image_url: bestEvent.metadata.extracted_image_url,
      extracted_images: allImageUrls.length > 1 ? allImageUrls : undefined,
      is_reel: extractorResponse.data.is_reel || false,
      analysis: bestEvent.analysis,
      post_metadata: postMetadata
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
