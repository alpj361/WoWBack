const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const FormData = require('form-data');
const { getSupabase } = require('../utils/supabase');

// ExtractorT API configuration
const EXTRACTOR_API_URL = process.env.EXTRACTOR_API_URL || 'https://api.standatpd.com';

// Regex to detect Instagram URLs
const INSTAGRAM_URL_REGEX = /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)\/?/gi;

/**
 * Extract Instagram URLs from text
 */
function extractInstagramUrls(text) {
  const matches = text.match(INSTAGRAM_URL_REGEX);
  return matches || [];
}

/**
 * Send a text message to user via WhatsApp
 */
async function sendWhatsAppText(to, text) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    console.error('❌ WhatsApp credentials not configured');
    return false;
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to,
          type: 'text',
          text: { body: text }
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Failed to send WhatsApp text:', error);
      return false;
    }

    console.log(`✅ Text message sent to ${to}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending WhatsApp text:', error);
    return false;
  }
}

/**
 * Send an image to user via WhatsApp (using image URL)
 */
async function sendWhatsAppImage(to, imageUrl, caption = null) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    console.error('❌ WhatsApp credentials not configured');
    return false;
  }

  try {
    const messageBody = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'image',
      image: { link: imageUrl }
    };

    if (caption) {
      messageBody.image.caption = caption;
    }

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(messageBody)
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Failed to send WhatsApp image:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('❌ Error sending WhatsApp image:', error);
    return false;
  }
}

/**
 * Process a link message - extract images and send back to user
 */
async function processLinkMessage(from, url, messageId) {
  console.log(`🔗 Processing link from ${from}: ${url}`);

  try {
    // Step 1: Call ExtractorT API
    console.log('📥 Calling ExtractorT API...');
    const extractorResponse = await fetch(`${EXTRACTOR_API_URL}/instagram/simple`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url })
    });

    if (!extractorResponse.ok) {
      throw new Error(`ExtractorT API error: ${extractorResponse.statusText}`);
    }

    const extractorData = await extractorResponse.json();

    if (!extractorData.success || !extractorData.media || extractorData.media.length === 0) {
      await sendWhatsAppText(from, '❌ No se encontraron imágenes en ese link.');
      return { success: false, error: 'No media found' };
    }

    const mediaCount = extractorData.media.length;
    console.log(`✅ ExtractorT found ${mediaCount} images`);

    // Step 2: Notify user
    await sendWhatsAppText(from, `📸 Encontré ${mediaCount} imagen${mediaCount > 1 ? 'es' : ''}, enviando...`);

    // Step 3: Send each image (with rate limiting)
    let sentCount = 0;
    const maxImages = 10; // Limit to avoid spam/rate limits

    for (let i = 0; i < Math.min(mediaCount, maxImages); i++) {
      const media = extractorData.media[i];
      if (media.type === 'image' && media.url) {
        const caption = i === 0 ? `${extractorData.author || ''} (${i + 1}/${Math.min(mediaCount, maxImages)})`.trim() : `(${i + 1}/${Math.min(mediaCount, maxImages)})`;
        const sent = await sendWhatsAppImage(from, media.url, caption);
        if (sent) sentCount++;

        // Rate limit: wait 1.5 seconds between images
        if (i < Math.min(mediaCount, maxImages) - 1) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    }

    console.log(`📤 Sent ${sentCount}/${mediaCount} images to ${from}`);

    // Step 4: Optionally save to whatsapp_flyers table
    const supabase = getSupabase();
    for (const media of extractorData.media) {
      if (media.type === 'image' && media.url) {
        await supabase
          .from('whatsapp_flyers')
          .insert({
            flyer: media.url,
            status: 'pending',
            saved: false
          });
      }
    }

    if (mediaCount > maxImages) {
      await sendWhatsAppText(from, `ℹ️ Solo envié las primeras ${maxImages} imágenes de ${mediaCount} disponibles.`);
    }

    return { success: true, sentCount, totalCount: mediaCount };

  } catch (error) {
    console.error('❌ Error processing link:', error);
    await sendWhatsAppText(from, '❌ Hubo un error procesando el link. Intenta de nuevo.');
    return { success: false, error: error.message };
  }
}

/**
 * WhatsApp Webhook - Receives messages from WhatsApp Business API
 * POST /api/whatsapp/webhook
 */
router.post('/webhook', async (req, res) => {
  try {
    console.log('📱 WhatsApp webhook received');
    console.log('Payload:', JSON.stringify(req.body, null, 2));

    const { entry } = req.body;

    // Validate payload structure
    if (!entry || !entry[0]?.changes?.[0]?.value?.messages?.[0]) {
      console.log('⚠️ Invalid WhatsApp payload structure');
      return res.status(200).json({ success: true, message: 'Ignored' });
    }

    const message = entry[0].changes[0].value.messages[0];
    const messageType = message.type;

    console.log(`📨 Message type: ${messageType}`);

    // Handle text messages with Instagram links
    if (messageType === 'text') {
      const textBody = message.text?.body || '';
      const instagramUrls = extractInstagramUrls(textBody);

      if (instagramUrls.length > 0) {
        console.log(`🔗 Found ${instagramUrls.length} Instagram URL(s) in message`);

        // Process the first Instagram URL found
        const from = message.from;
        const messageId = message.id;

        const result = await processLinkMessage(from, instagramUrls[0], messageId);

        return res.status(200).json({
          success: true,
          message: 'Link processed',
          result: result
        });
      } else {
        console.log('⏭️ Text message without Instagram links, skipping');
        return res.status(200).json({ success: true, message: 'No Instagram links found' });
      }
    }

    // Handle image messages (existing logic)
    if (messageType !== 'image') {
      console.log('⏭️ Skipping unsupported message type');
      return res.status(200).json({ success: true, message: 'Unsupported message type' });
    }

    const imageUrl = message.image.url;
    const messageId = message.id;
    const from = message.from;

    console.log(`📸 Processing image from ${from}`);
    console.log(`🔗 Image URL: ${imageUrl}`);

    // Step 1: Download image from WhatsApp
    const whatsappToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!whatsappToken) {
      throw new Error('WHATSAPP_ACCESS_TOKEN not configured');
    }

    console.log('⬇️ Downloading image from WhatsApp...');
    const imageResponse = await fetch(imageUrl, {
      headers: {
        'Authorization': `Bearer ${whatsappToken}`
      }
    });

    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.statusText}`);
    }

    const imageBuffer = await imageResponse.buffer();
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    console.log(`✅ Image downloaded (${imageBuffer.length} bytes, ${contentType})`);

    // Step 2: Upload to Supabase Storage
    const supabase = getSupabase();
    const timestamp = new Date();
    const dateFolder = timestamp.toISOString().split('T')[0]; // yyyy-MM-dd
    const fileName = `${dateFolder}/${messageId}.jpg`;

    console.log(`☁️ Uploading to Supabase Storage: ${fileName}`);

    const { data: uploadData, error: uploadError } = await supabase
      .storage
      .from('whatsapp-flyers')
      .upload(fileName, imageBuffer, {
        contentType: contentType,
        upsert: false
      });

    if (uploadError) {
      console.error('❌ Upload error:', uploadError);
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    console.log('✅ Image uploaded to storage');

    // Step 3: Get public URL
    const { data: { publicUrl } } = supabase
      .storage
      .from('whatsapp-flyers')
      .getPublicUrl(fileName);

    console.log(`🔗 Public URL: ${publicUrl}`);

    // Step 4: Insert record into whatsapp_flyers table
    const { data: dbData, error: dbError } = await supabase
      .from('whatsapp_flyers')
      .insert({
        flyer: publicUrl,
        status: 'pending',
        saved: false
      })
      .select()
      .single();

    if (dbError) {
      console.error('❌ Database insert error:', dbError);
      throw new Error(`Database insert failed: ${dbError.message}`);
    }

    console.log(`✅ Flyer record created with ID: ${dbData.id}`);
    console.log('🎉 WhatsApp flyer processing complete');

    res.status(200).json({
      success: true,
      message: 'Flyer received and saved',
      data: {
        id: dbData.id,
        flyer: publicUrl,
        status: 'pending',
        from: from,
        messageId: messageId
      }
    });

  } catch (error) {
    console.error('❌ WhatsApp webhook error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * WhatsApp Webhook Verification - Required by WhatsApp
 * GET /api/whatsapp/webhook
 */
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'wow_flyers_2026';

  console.log('🔐 WhatsApp webhook verification request');
  console.log('Query params:', { mode, token: token ? '***' : undefined, challenge: challenge != null });

  if (!mode || !token || challenge === undefined || challenge === null) {
    console.log('❌ Missing verification params (check nginx forwards query string)');
    return res.status(400).send('Missing hub params');
  }

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('✅ Webhook verified');
    res.status(200).contentType('text/plain').send(String(challenge));
  } else {
    console.log('❌ Webhook verification failed (token mismatch or wrong mode)');
    res.status(403).send('Forbidden');
  }
});

/**
 * Get pending flyers
 * GET /api/whatsapp/flyers/pending
 */
router.get('/flyers/pending', async (req, res) => {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('whatsapp_flyers')
      .select('*')
      .eq('status', 'pending')
      .eq('saved', false)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch pending flyers: ${error.message}`);
    }

    res.json({
      success: true,
      count: data.length,
      flyers: data
    });

  } catch (error) {
    console.error('❌ Error fetching pending flyers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Update flyer status
 * PATCH /api/whatsapp/flyers/:id
 */
router.patch('/flyers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, saved } = req.body;

    const supabase = getSupabase();

    const updateData = {};
    if (status) updateData.status = status;
    if (saved !== undefined) updateData.saved = saved;

    const { data, error } = await supabase
      .from('whatsapp_flyers')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update flyer: ${error.message}`);
    }

    res.json({
      success: true,
      flyer: data
    });

  } catch (error) {
    console.error('❌ Error updating flyer:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
