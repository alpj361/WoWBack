const express = require('express');
const router = express.Router();
const { getSupabase, isConfigured } = require('../utils/supabase');

/**
 * POST /api/events
 * Create a new event
 */
router.post('/', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { title, description, category, image, date, time, location } = req.body;

        if (!title || !title.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Title is required'
            });
        }

        const supabase = getSupabase();

        const eventData = {
            title: title.trim(),
            description: description?.trim() || null,
            category: category || 'general',
            image: image || null,
            date: date || null,
            time: time || null,
            location: location?.trim() || null
        };

        console.log('[EVENTS] Creating event:', eventData.title);

        const { data, error } = await supabase
            .from('events')
            .insert([eventData])
            .select()
            .single();

        if (error) {
            console.error('[EVENTS] ❌ Insert error:', error.message);
            throw error;
        }

        console.log('[EVENTS] ✅ Event created:', data.id);

        res.status(201).json({
            success: true,
            event: data
        });

    } catch (error) {
        console.error('[EVENTS] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to create event',
            message: error.message
        });
    }
});

/**
 * GET /api/events
 * List all events with optional category filter
 */
router.get('/', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { category } = req.query;
        const supabase = getSupabase();

        let query = supabase
            .from('events')
            .select('*')
            .order('created_at', { ascending: false });

        if (category && category !== 'all') {
            query = query.eq('category', category);
        }

        const { data, error } = await query;

        if (error) {
            console.error('[EVENTS] ❌ Query error:', error.message);
            throw error;
        }

        res.json({
            success: true,
            events: data
        });

    } catch (error) {
        console.error('[EVENTS] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch events',
            message: error.message
        });
    }
});

/**
 * GET /api/events/:id
 * Get single event by ID
 */
router.get('/:id', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { id } = req.params;
        const supabase = getSupabase();

        const { data, error } = await supabase
            .from('events')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({
                    success: false,
                    error: 'Event not found'
                });
            }
            throw error;
        }

        res.json({
            success: true,
            event: data
        });

    } catch (error) {
        console.error('[EVENTS] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch event',
            message: error.message
        });
    }
});

module.exports = router;
