const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const FormData = require('form-data');
const { getSupabase } = require('../utils/supabase');

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

    // Only process image messages
    if (messageType !== 'image') {
      console.log('⏭️ Skipping non-image message');
      return res.status(200).json({ success: true, message: 'Not an image' });
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
  console.log(`Mode: ${mode}, Token: ${token}`);

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('✅ Webhook verified');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Webhook verification failed');
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
