const OpenAI = require('openai');

/**
 * Analyze event image using OpenAI Vision API (gpt-4o-mini)
 * @param {string} imageData - Base64 image data or image URL
 * @param {string} title - Optional title/context for the image
 * @returns {Promise<Object>} Analysis result with event data
 */
async function analyzeEventImage(imageData, title = 'Evento') {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const openai = new OpenAI({ apiKey });

  try {
    console.log(`[EVENT_VISION] 📸 Analyzing event image: "${title}"`);

    const now = new Date();
    const currentDay = now.getDate();
    const currentMonth = now.toLocaleString('es', { month: 'long' });
    const currentYear = now.getFullYear();

    const systemPrompt = `Eres un especialista en análisis de imágenes de eventos.

CONTEXTO TEMPORAL: Hoy es ${currentDay} de ${currentMonth} de ${currentYear}. Si la imagen solo muestra un día de la semana o número de día sin mes/año explícito, usa el mes y año actual. Si el número de día ya pasó este mes, usa el siguiente mes. IMPORTANTE: No restes ni ajustes el día - si la imagen dice "11", la fecha debe ser día 11, no día 10.

TAREA: Analiza esta imagen de evento y extrae TODA la información visible.

EXTRAE:
- Nombre del evento (event_name)
- Fecha del evento (date) en formato YYYY-MM-DD
- Hora de inicio (time) en formato HH:MM (24 horas)
- Hora de fin (end_time) en formato HH:MM (24 horas) - si se menciona
- Descripción/detalles del evento (description)
- Ubicación/lugar (location)
- Organizador (organizer) - busca @usuario de Instagram, nombre de organizador, promotor, o quien presenta el evento
- Precio (price) - "Gratis", "Q50", "50 GTQ", etc.
- URL de registro (registration_url) - si hay un link visible

EVENTOS RECURRENTES:
Si el flyer indica que el evento se repite (ej: "todos los lunes", "cada sábado de febrero", "los días 5, 12 y 19"), debes:
1. Marcar is_recurring como true
2. En recurring_pattern describir el patrón (ej: "Todos los lunes de febrero ${currentYear}")
3. En recurring_dates listar TODAS las fechas específicas en formato YYYY-MM-DD

Ejemplos de patrones recurrentes:
- "Todos los lunes de febrero" → calcular todos los lunes de febrero ${currentYear}
- "Cada sábado" → si no especifica mes, usar el mes actual o siguiente
- "Los días 5, 12, 19 y 26" → convertir a fechas completas del mes indicado
- "Todos los viernes de marzo a mayo" → listar todos los viernes de esos meses

INSTRUCCIONES:
- Si encuentras múltiples fechas individuales, usa la primera como date principal
- Si no encuentras algún dato, indica "No especificado"
- Transcribe texto exactamente como aparece
- Detecta información en español e inglés
- Para fechas en formato texto (ej: "15 de agosto"), conviértelas a YYYY-MM-DD
- Para horas, usa formato 24 horas (ej: "8:00 PM" → "20:00")
- Si dice "de 7pm a 10pm", extrae time="19:00" y end_time="22:00"
- Para organizador, busca: @handles de Instagram, "presenta:", "organiza:", "by:", logos de promotoras, nombres de DJs/artistas principales

FORMATO DE SALIDA (JSON estricto):
{
  "event_name": "...",
  "date": "YYYY-MM-DD o No especificado",
  "time": "HH:MM o No especificado",
  "end_time": "HH:MM o No especificado",
  "description": "...",
  "location": "...",
  "organizer": "@instagram o nombre del organizador o No especificado",
  "price": "Gratis, Q50, etc. o No especificado",
  "registration_url": "https://... o No especificado",
  "is_recurring": true/false,
  "recurring_pattern": "descripción del patrón o null si no es recurrente",
  "recurring_dates": ["YYYY-MM-DD", "YYYY-MM-DD", ...] o [],
  "confidence": "high|medium|low",
  "extracted_text": "Todo el texto visible en la imagen"
}`;

    // Determinar si es URL o base64
    const isUrl = imageData.startsWith('http://') || imageData.startsWith('https://');
    const imageUrl = isUrl ? imageData : imageData;

    const messages = [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analiza esta imagen de evento: "${title}"`
          },
          {
            type: 'image_url',
            image_url: {
              url: imageUrl,
              detail: 'high' // High detail for better text recognition
            }
          }
        ]
      }
    ];

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Vision-capable, cost-effective
      messages,
      max_tokens: 2048,
      temperature: 0.1, // Low temperature for deterministic output
      response_format: { type: 'json_object' } // Force JSON response
    });

    const rawContent = response.choices?.[0]?.message?.content;

    if (!rawContent) {
      throw new Error('Empty response from OpenAI Vision');
    }

    console.log(`[EVENT_VISION] 📝 Raw response length: ${rawContent.length} chars`);

    // Parse JSON response
    let analysis;
    try {
      analysis = JSON.parse(rawContent);
    } catch (parseError) {
      console.error('[EVENT_VISION] ❌ JSON parse error:', parseError.message);
      console.error('[EVENT_VISION] Raw content:', rawContent);

      // Fallback: return structured error
      analysis = {
        event_name: 'Error en análisis',
        date: 'No especificado',
        time: 'No especificado',
        end_time: 'No especificado',
        description: rawContent.substring(0, 500),
        location: 'No especificado',
        organizer: 'No especificado',
        price: 'No especificado',
        registration_url: 'No especificado',
        is_recurring: false,
        recurring_pattern: null,
        recurring_dates: [],
        confidence: 'low',
        extracted_text: rawContent
      };
    }

    // Validate required fields
    const requiredFields = ['event_name', 'date', 'time', 'description', 'location', 'organizer', 'confidence'];
    const missingFields = requiredFields.filter(field => !analysis.hasOwnProperty(field));

    if (missingFields.length > 0) {
      console.warn('[EVENT_VISION] ⚠️ Missing fields:', missingFields);
      // Fill missing fields with default values
      missingFields.forEach(field => {
        analysis[field] = 'No especificado';
      });
      if (!analysis.confidence) analysis.confidence = 'low';
    }

    // Set defaults for new optional fields
    if (!analysis.end_time) analysis.end_time = 'No especificado';
    if (!analysis.price) analysis.price = 'No especificado';
    if (!analysis.registration_url) analysis.registration_url = 'No especificado';
    if (analysis.is_recurring === undefined) analysis.is_recurring = false;
    if (!analysis.recurring_pattern) analysis.recurring_pattern = null;
    if (!Array.isArray(analysis.recurring_dates)) analysis.recurring_dates = [];

    // Extract token usage
    const tokensUsed = response.usage?.total_tokens || 0;

    console.log(`[EVENT_VISION] ✅ Analysis completed - Confidence: ${analysis.confidence}, Tokens: ${tokensUsed}`);

    return {
      analysis,
      metadata: {
        model: 'gpt-4o-mini',
        tokens_used: tokensUsed,
        analyzed_at: new Date().toISOString()
      }
    };

  } catch (error) {
    console.error('[EVENT_VISION] ❌ Analysis error:', error.message);
    throw error;
  }
}

/**
 * Validate image data format
 * @param {string} imageData - Image data to validate
 * @returns {Object} Validation result
 */
function validateImageData(imageData) {
  if (!imageData || typeof imageData !== 'string') {
    return { valid: false, error: 'Image data must be a string' };
  }

  const isUrl = imageData.startsWith('http://') || imageData.startsWith('https://');
  const isBase64 = imageData.startsWith('data:image/');

  if (!isUrl && !isBase64) {
    return { valid: false, error: 'Image must be a URL or base64 encoded data' };
  }

  return { valid: true };
}

module.exports = {
  analyzeEventImage,
  validateImageData
};
