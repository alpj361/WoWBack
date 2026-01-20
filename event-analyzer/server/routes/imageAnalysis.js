const express = require('express');
const router = express.Router();
const { analyzeEventImage, validateImageData } = require('../services/eventVision');
const { getDatabase } = require('../utils/mongodb');

/**
 * POST /api/events/analyze-image
 * Analyze event image and extract structured data
 */
router.post('/analyze-image', async (req, res) => {
  try {
    const { image, title } = req.body;

    // Validate request
    if (!image) {
      return res.status(400).json({
        success: false,
        error: 'Image data is required'
      });
    }

    // Validate image format
    const validation = validateImageData(image);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }

    console.log('[IMAGE_ANALYSIS] Processing image analysis request');

    // Analyze image with OpenAI Vision
    const result = await analyzeEventImage(image, title);

    // Save analysis to MongoDB
    try {
      const db = getDatabase();
      const analysisDoc = {
        image_url: image.startsWith('http') ? image : 'base64_data',
        analysis: result.analysis,
        metadata: result.metadata,
        created_at: new Date()
      };

      await db.collection('event_analyses').insertOne(analysisDoc);
      console.log('[IMAGE_ANALYSIS] ✅ Analysis saved to MongoDB');
    } catch (dbError) {
      console.error('[IMAGE_ANALYSIS] ⚠️ MongoDB save error:', dbError.message);
      // Continue even if DB save fails
    }

    // Return success response
    res.json({
      success: true,
      analysis: result.analysis,
      metadata: result.metadata
    });

  } catch (error) {
    console.error('[IMAGE_ANALYSIS] ❌ Error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze image',
      message: error.message
    });
  }
});

module.exports = router;
