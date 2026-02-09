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

        const {
            title, description, category, image, date, time, location, user_id,
            price, registration_form_url, bank_account_number, bank_name,
            requires_attendance_check
        } = req.body;

        if (!title || !title.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Title is required'
            });
        }

        // Validar que si hay precio, debe haber información bancaria
        // Validar que si hay precio, debe haber información bancaria
        // SOLO si el evento es creado por un usuario específico (host event)
        if (price && price > 0 && user_id) {
            if (!bank_account_number || !bank_name) {
                return res.status(400).json({
                    success: false,
                    error: 'Bank account information is required for paid events hosted by users'
                });
            }
        }

        const supabase = getSupabase();

        const eventData = {
            title: title.trim(),
            description: description?.trim() || null,
            category: category || 'general',
            image: image || null,
            date: date || null,
            time: time || null,
            location: location?.trim() || null,
            user_id: user_id || null,
            price: price || null,
            registration_form_url: registration_form_url?.trim() || null,
            bank_account_number: bank_account_number?.trim() || null,
            bank_name: bank_name?.trim() || null,
            requires_attendance_check: requires_attendance_check || false
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
 * Only shows events that haven't passed yet (future events or events without date)
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

        // Get today's date in YYYY-MM-DD format (Guatemala timezone UTC-6)
        const today = new Date();
        today.setHours(today.getHours() - 6); // Adjust for Guatemala timezone
        const todayStr = today.toISOString().split('T')[0];

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

        // Filter out past events on the backend
        // Keep events that:
        // 1. Have no date (date is null)
        // 2. Have a date >= today
        const filteredData = data.filter(event => {
            if (!event.date) return true; // Keep events without date
            return event.date >= todayStr; // Keep future or today's events
        });

        console.log(`[EVENTS] Filtered ${data.length - filteredData.length} past events`);

        res.json({
            success: true,
            events: filteredData
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
 * GET /api/events/hosted/:userId
 * List events hosted by a specific user with attendee counts
 */
router.get('/hosted/:userId', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { userId } = req.params;
        const supabase = getSupabase();

        // Get events where user_id matches
        const { data: events, error } = await supabase
            .from('events')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        // For each event, get the attendee count from saved_events
        const eventsWithAttendees = await Promise.all(
            events.map(async (event) => {
                const { count } = await supabase
                    .from('saved_events')
                    .select('*', { count: 'exact', head: true })
                    .eq('event_id', event.id);

                return { ...event, attendee_count: count || 0 };
            })
        );

        res.json({ success: true, events: eventsWithAttendees });

    } catch (error) {
        console.error('[EVENTS] ❌ Hosted events error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch hosted events'
        });
    }
});

/**
 * GET /api/events/:eventId/attendees
 * List users who saved a specific event
 */
router.get('/:eventId/attendees', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { eventId } = req.params;
        const supabase = getSupabase();

        // First, get all saved_events for this event
        const { data: savedEvents, error: savedError } = await supabase
            .from('saved_events')
            .select('id, saved_at, user_id')
            .eq('event_id', eventId)
            .order('saved_at', { ascending: false });

        if (savedError) {
            console.error('[EVENTS] ❌ Saved events query error:', savedError.message);
            throw savedError;
        }

        // If no saved events, return empty array
        if (!savedEvents || savedEvents.length === 0) {
            return res.json({ success: true, attendees: [] });
        }

        // Get user IDs
        const userIds = savedEvents.map(se => se.user_id);

        // Fetch profiles for these users
        const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, full_name, email, avatar_url')
            .in('id', userIds);

        if (profilesError) {
            console.error('[EVENTS] ❌ Profiles query error:', profilesError.message);
            throw profilesError;
        }

        // Combine the data
        const attendees = savedEvents.map(savedEvent => {
            const profile = profiles?.find(p => p.id === savedEvent.user_id);
            return {
                id: savedEvent.id,
                saved_at: savedEvent.saved_at,
                profiles: profile || null
            };
        });

        res.json({ success: true, attendees });

    } catch (error) {
        console.error('[EVENTS] ❌ Attendees error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch attendees',
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



/**
 * POST /api/events/:eventId/register
 * Create a registration request for an event
 */
router.post('/:eventId/register', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { eventId } = req.params;
        const { user_id, payment_receipt_url, registration_form_completed } = req.body;

        if (!user_id) {
            return res.status(400).json({
                success: false,
                error: 'User ID is required'
            });
        }

        const supabase = getSupabase();

        // Check if registration already exists
        const { data: existing } = await supabase
            .from('event_registrations')
            .select('*')
            .eq('event_id', eventId)
            .eq('user_id', user_id)
            .single();

        if (existing) {
            return res.status(400).json({
                success: false,
                error: 'Registration already exists for this event'
            });
        }

        const registrationData = {
            event_id: eventId,
            user_id: user_id,
            status: 'pending',
            payment_receipt_url: payment_receipt_url || null,
            registration_form_completed: registration_form_completed || false
        };

        console.log('[EVENTS] Creating registration for event:', eventId);

        const { data, error } = await supabase
            .from('event_registrations')
            .insert([registrationData])
            .select()
            .single();

        if (error) {
            console.error('[EVENTS] ❌ Registration error:', error.message);
            throw error;
        }

        console.log('[EVENTS] ✅ Registration created:', data.id);

        res.status(201).json({
            success: true,
            registration: data
        });

    } catch (error) {
        console.error('[EVENTS] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to create registration',
            message: error.message
        });
    }
});

/**
 * GET /api/events/:eventId/registrations
 * List all registrations for an event (host only)
 */
router.get('/:eventId/registrations', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { eventId } = req.params;
        const supabase = getSupabase();

        // Get all registrations for this event
        const { data: registrations, error } = await supabase
            .from('event_registrations')
            .select('*')
            .eq('event_id', eventId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('[EVENTS] ❌ Registrations query error:', error.message);
            throw error;
        }

        if (!registrations || registrations.length === 0) {
            return res.json({ success: true, registrations: [] });
        }

        // Get user profiles for each registration
        const userIds = registrations.map(r => r.user_id);
        const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, full_name, email, avatar_url')
            .in('id', userIds);

        if (profilesError) {
            console.error('[EVENTS] ❌ Profiles query error:', profilesError.message);
            throw profilesError;
        }

        // Combine registration data with user profiles
        const registrationsWithProfiles = registrations.map(reg => {
            const profile = profiles?.find(p => p.id === reg.user_id);
            return {
                ...reg,
                user: profile || null
            };
        });

        res.json({
            success: true,
            registrations: registrationsWithProfiles
        });

    } catch (error) {
        console.error('[EVENTS] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch registrations',
            message: error.message
        });
    }
});

/**
 * PATCH /api/events/registrations/:registrationId/approve
 * Approve a registration request
 */
router.patch('/registrations/:registrationId/approve', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { registrationId } = req.params;
        const supabase = getSupabase();

        // Get the registration
        const { data: registration, error: fetchError } = await supabase
            .from('event_registrations')
            .select('*')
            .eq('id', registrationId)
            .single();

        if (fetchError || !registration) {
            return res.status(404).json({
                success: false,
                error: 'Registration not found'
            });
        }

        // Update status to approved
        const { data, error } = await supabase
            .from('event_registrations')
            .update({ status: 'approved' })
            .eq('id', registrationId)
            .select()
            .single();

        if (error) {
            console.error('[EVENTS] ❌ Approve error:', error.message);
            throw error;
        }

        // Add to saved_events if approved
        const { error: savedError } = await supabase
            .from('saved_events')
            .insert([{
                user_id: registration.user_id,
                event_id: registration.event_id
            }]);

        if (savedError && savedError.code !== '23505') { // Ignore duplicate errors
            console.error('[EVENTS] ❌ Saved events error:', savedError.message);
        }

        console.log('[EVENTS] ✅ Registration approved:', registrationId);

        res.json({
            success: true,
            registration: data
        });

    } catch (error) {
        console.error('[EVENTS] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to approve registration',
            message: error.message
        });
    }
});

/**
 * PATCH /api/events/registrations/:registrationId/reject
 * Reject a registration request with optional reason
 */
router.patch('/registrations/:registrationId/reject', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { registrationId } = req.params;
        const { rejection_reason } = req.body;
        const supabase = getSupabase();

        const updateData = {
            status: 'rejected',
            rejection_reason: rejection_reason?.trim() || null
        };

        const { data, error } = await supabase
            .from('event_registrations')
            .update(updateData)
            .eq('id', registrationId)
            .select()
            .single();

        if (error) {
            console.error('[EVENTS] ❌ Reject error:', error.message);
            throw error;
        }

        console.log('[EVENTS] ✅ Registration rejected:', registrationId);

        res.json({
            success: true,
            registration: data
        });

    } catch (error) {
        console.error('[EVENTS] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to reject registration',
            message: error.message
        });
    }
});

/**
 * GET /api/events/registrations/user/:userId
 * Get all registrations for a specific user
 */
router.get('/registrations/user/:userId', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { userId } = req.params;
        const supabase = getSupabase();

        const { data: registrations, error } = await supabase
            .from('event_registrations')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('[EVENTS] ❌ User registrations error:', error.message);
            throw error;
        }

        res.json({
            success: true,
            registrations: registrations || []
        });

    } catch (error) {
        console.error('[EVENTS] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch user registrations',
            message: error.message
        });
    }
});

/**
 * POST /api/events/:eventId/scan-attendance
 * Scan a user's QR code to mark attendance at an event
 * 
 * Requirements:
 * - Authenticated user must be the event host
 * - scannedUserId must be confirmed for the event (saved_event or approved registration)
 * - Event must have requires_attendance_check = true
 */
router.post('/:eventId/scan-attendance', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { eventId } = req.params;
        const { scanned_user_id } = req.body;

        // For now, we'll get host_user_id from body (in production, use auth middleware)
        const { host_user_id } = req.body;

        if (!scanned_user_id) {
            return res.status(400).json({
                success: false,
                error: 'Scanned user ID is required'
            });
        }

        if (!host_user_id) {
            return res.status(400).json({
                success: false,
                error: 'Host user ID is required'
            });
        }

        const supabase = getSupabase();

        // 1. Verify the authenticated user is the host of this event
        const { data: event, error: eventError } = await supabase
            .from('events')
            .select('*')
            .eq('id', eventId)
            .single();

        if (eventError || !event) {
            return res.status(404).json({
                success: false,
                error: 'Event not found'
            });
        }

        if (event.user_id !== host_user_id) {
            return res.status(403).json({
                success: false,
                error: 'Only the event host can scan attendance'
            });
        }

        // 2. Verify the event requires attendance check
        if (!event.requires_attendance_check) {
            return res.status(400).json({
                success: false,
                error: 'This event does not require attendance tracking'
            });
        }

        // 3. Check if user is in the system for this event
        const { data: savedEvent } = await supabase
            .from('saved_events')
            .select('*')
            .eq('event_id', eventId)
            .eq('user_id', scanned_user_id)
            .maybeSingle();

        const { data: registration } = await supabase
            .from('event_registrations')
            .select('*')
            .eq('event_id', eventId)
            .eq('user_id', scanned_user_id)
            .maybeSingle();

        // Case 1: User doesn't exist in saved_events or registrations
        if (!savedEvent && !registration) {
            return res.status(400).json({
                success: false,
                error: 'Usuario no existe'
            });
        }

        // Case 2: User has registration but not approved (not paid)
        if (registration && registration.status !== 'approved' && !savedEvent) {
            return res.status(400).json({
                success: false,
                error: 'No pagado'
            });
        }

        // Case 3: User is confirmed (saved or approved)
        const isConfirmed = savedEvent || (registration && registration.status === 'approved');

        if (!isConfirmed) {
            return res.status(400).json({
                success: false,
                error: 'Usuario no confirmado'
            });
        }

        // 4. Check if already attended
        const { data: existingAttendance } = await supabase
            .from('attended_events')
            .select('*')
            .eq('event_id', eventId)
            .eq('user_id', scanned_user_id)
            .maybeSingle();

        if (existingAttendance) {
            // Update existing attendance record
            const { data, error } = await supabase
                .from('attended_events')
                .update({
                    scanned_by_host: true,
                    scanned_at: new Date().toISOString(),
                    scanned_by_user_id: host_user_id
                })
                .eq('id', existingAttendance.id)
                .select()
                .single();

            if (error) {
                console.error('[EVENTS] ❌ Update attendance error:', error.message);
                throw error;
            }

            console.log('[EVENTS] ✅ Attendance updated for user:', scanned_user_id);

            return res.json({
                success: true,
                message: 'Attendance updated successfully',
                attendance: data
            });
        } else {
            // Create new attendance record
            const { data, error } = await supabase
                .from('attended_events')
                .insert([{
                    event_id: eventId,
                    user_id: scanned_user_id,
                    scanned_by_host: true,
                    scanned_at: new Date().toISOString(),
                    scanned_by_user_id: host_user_id
                }])
                .select()
                .single();

            if (error) {
                console.error('[EVENTS] ❌ Insert attendance error:', error.message);
                throw error;
            }

            console.log('[EVENTS] ✅ Attendance created for user:', scanned_user_id);

            return res.status(201).json({
                success: true,
                message: 'Attendance recorded successfully',
                attendance: data
            });
        }

    } catch (error) {
        console.error('[EVENTS] ❌ Scan attendance error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to record attendance',
            message: error.message
        });
    }
});

/**
 * GET /api/events/:eventId/attendance-list
 * Get attendance list for an event (host only)
 * 
 * Returns list of all users who are confirmed for the event with their attendance status
 */
router.get('/:eventId/attendance-list', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { eventId } = req.params;
        const supabase = getSupabase();

        // Get event to check if it has payments/registration
        const { data: event, error: eventError } = await supabase
            .from('events')
            .select('price, registration_form_url')
            .eq('id', eventId)
            .single();

        if (eventError) {
            console.error('[EVENTS] ❌ Event error:', eventError.message);
            throw eventError;
        }

        const hasPayments = (event.price && parseFloat(event.price) > 0) || !!event.registration_form_url;

        // Get all users who saved the event
        const { data: savedEvents, error: savedError } = await supabase
            .from('saved_events')
            .select('user_id')
            .eq('event_id', eventId);

        if (savedError) {
            console.error('[EVENTS] ❌ Saved events error:', savedError.message);
            throw savedError;
        }

        // Get all registrations (approved and pending) with payment receipts
        const { data: registrations, error: regError } = await supabase
            .from('event_registrations')
            .select('user_id, status, payment_receipt_url')
            .eq('event_id', eventId);

        if (regError) {
            console.error('[EVENTS] ❌ Registrations error:', regError.message);
            throw regError;
        }

        // If event has payments, ONLY consider approved registrations as confirmed
        // If event is free, consider saved_events as confirmed
        const savedUserIds = savedEvents?.map(se => se.user_id) || [];
        const approvedRegUserIds = registrations?.filter(r => r.status === 'approved').map(r => r.user_id) || [];
        
        // For events with payments: only approved registrations
        // For free events: saved users + approved registrations
        const confirmedUserIds = hasPayments 
            ? approvedRegUserIds 
            : [...new Set([...savedUserIds, ...approvedRegUserIds])];

        // Include all users who have any interaction (for showing pending/rejected in UI if needed)
        const allUserIds = [...new Set([...savedUserIds, ...registrations?.map(r => r.user_id) || []])];

        if (allUserIds.length === 0) {
            return res.json({
                success: true,
                attendees: []
            });
        }

        // Get user profiles
        const { data: profiles, error: profileError } = await supabase
            .from('profiles')
            .select('id, full_name, email, avatar_url')
            .in('id', allUserIds);

        if (profileError) {
            console.error('[EVENTS] ❌ Profiles error:', profileError.message);
            throw profileError;
        }

        // Get attendance records
        const { data: attendedEvents, error: attendedError } = await supabase
            .from('attended_events')
            .select('user_id, scanned_by_host, scanned_at')
            .eq('event_id', eventId)
            .in('user_id', allUserIds);

        if (attendedError) {
            console.error('[EVENTS] ❌ Attended events error:', attendedError.message);
            throw attendedError;
        }

        // Build attendance list - only include confirmed users
        const attendees = confirmedUserIds.map(userId => {
            const profile = profiles?.find(p => p.id === userId);
            const attendance = attendedEvents?.find(ae => ae.user_id === userId);
            const registration = registrations?.find(r => r.user_id === userId);

            return {
                user_id: userId,
                user_name: profile?.full_name || null,
                user_email: profile?.email || null,
                user_avatar: profile?.avatar_url || null,
                confirmed: true, // All users in this list are confirmed
                attended: !!attendance,
                scanned_by_host: attendance?.scanned_by_host || false,
                scanned_at: attendance?.scanned_at || null,
                registration_status: registration?.status || null
            };
        });

        res.json({
            success: true,
            attendees
        });

    } catch (error) {
        console.error('[EVENTS] ❌ Attendance list error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch attendance list',
            message: error.message
        });
    }
});

/**
 * PATCH /api/events/:eventId/attendance-requirement
 * Update attendance requirement for an event (host only)
 */
router.patch('/:eventId/attendance-requirement', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { eventId } = req.params;
        const { requires_attendance_check, user_id } = req.body;

        if (typeof requires_attendance_check !== 'boolean') {
            return res.status(400).json({
                success: false,
                error: 'requires_attendance_check must be a boolean'
            });
        }

        if (!user_id) {
            return res.status(400).json({
                success: false,
                error: 'User ID is required'
            });
        }

        const supabase = getSupabase();

        // Verify user is the host
        const { data: event, error: eventError } = await supabase
            .from('events')
            .select('user_id')
            .eq('id', eventId)
            .single();

        if (eventError || !event) {
            return res.status(404).json({
                success: false,
                error: 'Event not found'
            });
        }

        if (event.user_id !== user_id) {
            return res.status(403).json({
                success: false,
                error: 'Only the event host can update attendance requirements'
            });
        }

        // Update the event
        const { data, error } = await supabase
            .from('events')
            .update({ requires_attendance_check })
            .eq('id', eventId)
            .select()
            .single();

        if (error) {
            console.error('[EVENTS] ❌ Update error:', error.message);
            throw error;
        }

        console.log('[EVENTS] ✅ Attendance requirement updated for event:', eventId);

        res.json({
            success: true,
            event: data
        });

    } catch (error) {
        console.error('[EVENTS] ❌ Update attendance requirement error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to update attendance requirement',
            message: error.message
        });
    }
});

module.exports = router;
