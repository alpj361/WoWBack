const express = require('express');
const router = express.Router();
const { supabase } = require('../utils/supabase');

/**
 * POST /api/auth/validate-code
 * Validates an invitation code
 */
router.post('/validate-code', async (req, res) => {
    try {
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({
                success: false,
                error: 'Código requerido'
            });
        }

        // Check if code exists and is valid
        const { data, error } = await supabase
            .from('invitation_codes')
            .select('id, code, description, user_type, credits, max_uses, current_uses, expires_at')
            .eq('code', code.toUpperCase())
            .single();

        if (error || !data) {
            return res.status(400).json({
                success: false,
                error: 'Código inválido'
            });
        }

        // Check if code is expired
        if (data.expires_at && new Date(data.expires_at) < new Date()) {
            return res.status(400).json({
                success: false,
                error: 'Código expirado'
            });
        }

        // Check if code has remaining uses
        if (data.max_uses && data.current_uses >= data.max_uses) {
            return res.status(400).json({
                success: false,
                error: 'Código ya utilizado'
            });
        }

        return res.json({
            success: true,
            code_data: {
                id: data.id,
                code: data.code,
                description: data.description,
                user_type: data.user_type || 'Beta',
                credits: data.credits || 100
            }
        });

    } catch (error) {
        console.error('Error validating code:', error);
        return res.status(500).json({
            success: false,
            error: 'Error del servidor'
        });
    }
});

/**
 * POST /api/auth/register
 * Creates or updates user profile after Google OAuth
 */
router.post('/register', async (req, res) => {
    try {
        const { user_id, email, full_name, avatar_url, code } = req.body;

        if (!user_id || !email) {
            return res.status(400).json({
                success: false,
                error: 'user_id y email son requeridos'
            });
        }

        // Get code data if provided
        let codeData = { user_type: 'Beta', credits: 100 };

        if (code) {
            const { data: invCode } = await supabase
                .from('invitation_codes')
                .select('id, user_type, credits')
                .eq('code', code.toUpperCase())
                .single();

            if (invCode) {
                codeData = {
                    user_type: invCode.user_type || 'Beta',
                    credits: invCode.credits || 100
                };

                // Mark code as used
                await supabase
                    .from('invitation_codes')
                    .update({
                        used: true,
                        used_by: user_id,
                        used_at: new Date().toISOString(),
                        current_uses: supabase.rpc ? 1 : 1
                    })
                    .eq('id', invCode.id);
            }
        }

        // Upsert profile
        const { data: profile, error } = await supabase
            .from('profiles')
            .upsert({
                id: user_id,
                email,
                full_name: full_name || null,
                avatar_url: avatar_url || null,
                role: 'user',
                user_type: codeData.user_type,
                credits: codeData.credits,
                updated_at: new Date().toISOString()
            }, { onConflict: 'id' })
            .select()
            .single();

        if (error) {
            console.error('Error upserting profile:', error);
            return res.status(500).json({
                success: false,
                error: 'Error creando perfil'
            });
        }

        return res.json({
            success: true,
            profile
        });

    } catch (error) {
        console.error('Error in register:', error);
        return res.status(500).json({
            success: false,
            error: 'Error del servidor'
        });
    }
});

/**
 * GET /api/auth/me
 * Get current user profile (requires user_id in query)
 */
router.get('/me', async (req, res) => {
    try {
        const { user_id } = req.query;

        if (!user_id) {
            return res.status(400).json({
                success: false,
                error: 'user_id requerido'
            });
        }

        const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user_id)
            .single();

        if (error || !profile) {
            return res.status(404).json({
                success: false,
                error: 'Perfil no encontrado'
            });
        }

        return res.json({
            success: true,
            profile
        });

    } catch (error) {
        console.error('Error getting profile:', error);
        return res.status(500).json({
            success: false,
            error: 'Error del servidor'
        });
    }
});

module.exports = router;
