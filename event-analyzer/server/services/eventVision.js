const OpenAI = require('openai');

/**
 * Map Spanish day names to JS Date day indices (0=Sunday, 6=Saturday)
 */
const DAY_NAME_TO_INDEX = {
  'domingo': 0,
  'lunes': 1,
  'martes': 2,
  'miércoles': 3,
  'miercoles': 3,
  'jueves': 4,
  'viernes': 5,
  'sábado': 6,
  'sabado': 6
};

/**
 * Calculate recurring dates programmatically from pattern info
 * @param {Object} analysis - The Vision analysis result
 * @returns {string[]} Array of dates in YYYY-MM-DD format
 */
function calculateRecurringDates(analysis) {
  if (!analysis.is_recurring) return [];

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed

  // Parse month range
  let startMonth, startYear, endMonth, endYear;

  if (analysis.recurring_month_start) {
    const [sy, sm] = analysis.recurring_month_start.split('-').map(Number);
    startYear = sy;
    startMonth = sm - 1; // convert to 0-indexed
  } else {
    startYear = currentYear;
    startMonth = currentMonth;
  }

  if (analysis.recurring_month_end) {
    const [ey, em] = analysis.recurring_month_end.split('-').map(Number);
    endYear = ey;
    endMonth = em - 1;
  } else {
    endYear = startYear;
    endMonth = startMonth;
  }

  const dates = [];

  // Case 1: Day-of-week based (e.g. "todos los viernes" o "viernes y sábado")
  // Soporta tanto string como array para compatibilidad
  const rawDays = analysis.recurring_days_of_week || analysis.recurring_day_of_week;
  const dayNames = Array.isArray(rawDays)
    ? rawDays.map(d => d.toLowerCase().trim())
    : rawDays ? [rawDays.toLowerCase().trim()] : [];
  const dayIndices = dayNames.map(d => DAY_NAME_TO_INDEX[d]).filter(i => i !== undefined);

  if (dayIndices.length > 0) {
    let year = startYear;
    let month = startMonth;

    while (year < endYear || (year === endYear && month <= endMonth)) {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(year, month, day);
        if (dayIndices.includes(d.getDay())) {
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          dates.push(`${yyyy}-${mm}-${dd}`);
        }
      }
      // Next month
      month++;
      if (month > 11) { month = 0; year++; }
    }
    // Ordenar por fecha
    dates.sort();
  }

  // Case 2: Specific day numbers (e.g. "los días 5, 12, 19, 26")
  const specificDays = analysis.recurring_specific_days;
  if (Array.isArray(specificDays) && specificDays.length > 0 && dates.length === 0) {
    let year = startYear;
    let month = startMonth;

    while (year < endYear || (year === endYear && month <= endMonth)) {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      for (const day of specificDays) {
        if (day >= 1 && day <= daysInMonth) {
          const mm = String(month + 1).padStart(2, '0');
          const dd = String(day).padStart(2, '0');
          dates.push(`${year}-${mm}-${dd}`);
        }
      }
      month++;
      if (month > 11) { month = 0; year++; }
    }
  }

  console.log(`[EVENT_VISION] 📅 Calculated ${dates.length} recurring dates: ${dates.join(', ')}`);
  return dates;
}

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
- Categoría (category): clasifica el evento en una de estas tres categorías:
  • "music" → concierto, festival, dj, arte, teatro, cine, danza, exposición, karaoke
  • "volunteer" → limpieza, reforestación, donación, ayuda comunitaria, causas sociales, salud
  • "general" → conferencia, taller, feria, reunión, clase, deporte, mercado, networking

- Subcategoría (subcategory): elige el id más preciso según la categoría. Si no hay coincidencia clara → null
  music: rock-concert|pop-concert|electronic-concert|reggaeton-urbano|jazz-blues|classical-music|latin-salsa|folk-traditional|indie-alternative|hip-hop-rap|metal-hardcore|acoustic-unplugged|open-mic|live-band|music-festival|dj-set|karaoke|choir-performance|art-exhibition|theater-play|dance-performance|comedy-show|poetry-slam|film-screening|cultural-festival|art-music-gathering
  volunteer: environmental-cleanup|tree-planting|animal-rescue|food-bank|community-build|tutoring-education|medical-campaign|blood-donation|clothing-drive|elderly-support|children-support|disability-support|disaster-relief|habitat-restoration|fundraiser-walk|beach-cleanup|digital-literacy|mental-health-awareness|social-housing|youth-mentorship|lgbt-awareness|political-youth|university-awareness|ong-campaign|human-rights|womens-rights|indigenous-rights|migrant-support|anti-corruption|climate-activism|disability-rights|animal-rights|peace-culture|civic-education|social-entrepreneurship
  general: networking-event|startup-pitch|workshop-skills|conference-talk|sports-game|running-race|yoga-wellness|food-tasting|craft-beer|flea-market|farmers-market|art-craft-fair|book-club|language-exchange|gaming-tournament|board-games|tech-meetup|photography-walk|hiking-outdoors|spiritual-retreat|trivia-quiz|hackathon|graduation-ceremony|launch-party|private-party

- Tags (tags): array de 1-4 tags del evento que apliquen visualmente o por contexto:
  music: outdoor|indoor|18+|todo-público|bar|gratis|boletos|VIP|acústico|festival|noche|tarde
  volunteer: fin-de-semana|presencial|familias|estudiantes|sin-experiencia|certificado|transporte|comida-incluida
  general: outdoor|indoor|18+|todo-público|gratis|networking|noche|tarde|fin-de-semana|familias|pets-ok

- Características del evento (event_features): inferir del contexto visual, descripción y tipo de evento:
  mood: "energético"|"relajado"|"romántico"|"social"|"íntimo"
  vibe: "casual"|"formal"|"underground"|"familiar"|"exclusivo"
  timeOfDay: "mañana"|"tarde"|"noche"|"madrugada"
  socialSetting: "en pareja"|"con amigos"|"solo"|"en grupo"|"familiar"

EVENTOS RECURRENTES vs FECHAS MÚLTIPLES ESPECÍFICAS — LEE ESTO CON CUIDADO:

CASO A — FECHAS ESPECÍFICAS (is_recurring: false):
El flyer menciona días concretos con número. Aunque diga el nombre del día, si tiene número, son fechas puntuales.
Ejemplos: "viernes 13 y sábado 14", "jueves 5 y viernes 6", "13 y 14 de febrero"
→ is_recurring: false
→ date: primera fecha (ej: "2026-02-13")
→ recurring_specific_days: los números de día [13, 14]
→ recurring_days_of_week: []

CASO B — RECURRENTE POR DÍA DE SEMANA (is_recurring: true):
El flyer indica que el evento se repite sin números específicos, usando "todos los", "cada", o solo el nombre del día sin número.
Ejemplos: "todos los viernes de febrero", "cada viernes y sábado", "viernes y sábados de febrero"
→ is_recurring: true
→ recurring_days_of_week: ["viernes"] o ["viernes", "sábado"]
→ recurring_specific_days: []

CASO C — RANGO DE FECHAS CONTINUO (is_recurring: true):
El flyer indica un período continuo de varios días seguidos.
Ejemplos: "del 12 al 18 de febrero", "del viernes al domingo", "3 al 5 de marzo"
→ is_recurring: true
→ recurring_pattern: "del 12 al 18 de febrero"
→ recurring_specific_days: todos los números del rango [12, 13, 14, 15, 16, 17, 18]
→ recurring_days_of_week: []

CASO D — EVENTO MENSUAL (is_recurring: true):
El flyer indica que ocurre cada mes en el mismo día o día de semana.
Ejemplos: "cada primer sábado del mes", "el 15 de cada mes", "mensualmente los jueves"
→ is_recurring: true
→ recurring_pattern: describir el patrón mensual exacto
→ recurring_days_of_week: ["sábado"] (si es por día de semana)
→ recurring_specific_days: [15] (si es por número de día)
→ recurring_month_start: mes actual en "YYYY-MM"
→ recurring_month_end: 3-6 meses adelante (estimado razonable)

CASO E — EVENTO ANUAL (is_recurring: false):
El flyer indica que es un evento anual o de edición especial con fecha fija.
Ejemplos: "edición 2026", "aniversario 10", "feria anual agosto 2026", "festival 15 al 20 de julio"
→ is_recurring: false
→ date: primera fecha del evento
→ recurring_specific_days: si son varios días consecutivos [15, 16, 17, 18, 19, 20]

CASO F — TEMPORADA O TOUR (is_recurring: true):
El flyer cubre múltiples fechas en distintos meses (gira, temporada teatral, serie de conciertos).
Ejemplos: "gira febrero-abril", "temporada marzo a mayo", "todos los sábados de febrero a abril"
→ is_recurring: true
→ recurring_pattern: describir la temporada
→ recurring_days_of_week: ["sábado"] si aplica
→ recurring_month_start: "2026-02"
→ recurring_month_end: "2026-04"

CASO G — MÚLTIPLES FECHAS SALTADAS (is_recurring: false):
El flyer lista fechas específicas no consecutivas y no semanales.
Ejemplos: "5, 19 y 26 de febrero", "martes 3 y jueves 17"
→ is_recurring: false
→ date: primera fecha
→ recurring_specific_days: [3, 17] o [5, 19, 26]

REGLA CLAVE: Si el nombre del día va acompañado de un número ("viernes 13"), es fecha específica. Si solo dice el nombre del día sin número ("los viernes"), es recurrente.

Para eventos recurrentes (Casos B, C, D, F):
- recurring_month_start: mes de inicio en formato "YYYY-MM"
- recurring_month_end: mes de fin en formato "YYYY-MM"
- DEJAR recurring_dates: [] — el servidor calcula las fechas exactas

IMPORTANTE: NO calcules las fechas recurrentes tú mismo.

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
  "category": "music|volunteer|general",
  "subcategory": "rock-concert|... o null",
  "tags": ["outdoor", "noche"],
  "event_features": {
    "mood": "energético|relajado|romántico|social|íntimo",
    "vibe": "casual|formal|underground|familiar|exclusivo",
    "timeOfDay": "mañana|tarde|noche|madrugada",
    "socialSetting": "en pareja|con amigos|solo|en grupo|familiar"
  },
  "is_recurring": true/false,
  "recurring_pattern": "descripción del patrón o null si no es recurrente",
  "recurring_days_of_week": ["viernes", "sábado"] o [] si no aplica,
  "recurring_specific_days": [5, 12, 19] o [],
  "recurring_month_start": "YYYY-MM o null",
  "recurring_month_end": "YYYY-MM o null",
  "recurring_dates": [],
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
    if (!analysis.category) analysis.category = analysis.event_type || 'general';
    delete analysis.event_type;
    if (!analysis.subcategory) analysis.subcategory = null;
    if (!Array.isArray(analysis.tags)) analysis.tags = [];
    if (!analysis.event_features || typeof analysis.event_features !== 'object') analysis.event_features = null;
    if (analysis.is_recurring === undefined) analysis.is_recurring = false;
    if (!analysis.recurring_pattern) analysis.recurring_pattern = null;

    // Calculate recurring dates programmatically (never trust LLM calendar math)
    if (analysis.is_recurring) {
      // Caso B y C: recurrente por día de semana o rango
      analysis.recurring_dates = calculateRecurringDates(analysis);
    } else if (Array.isArray(analysis.recurring_specific_days) && analysis.recurring_specific_days.length > 1) {
      // Caso A: fechas específicas múltiples (ej: "viernes 13 y sábado 14")
      // Derivar el mes desde la fecha principal del evento
      const baseDate = analysis.date && analysis.date !== 'No especificado' ? analysis.date : null;
      if (baseDate) {
        const [y, m] = baseDate.split('-').map(Number);
        analysis.recurring_dates = analysis.recurring_specific_days
          .map(day => `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
          .sort();
        console.log(`[EVENT_VISION] 📅 Fechas específicas múltiples: ${analysis.recurring_dates.join(', ')}`);
      } else {
        analysis.recurring_dates = [];
      }
    } else {
      analysis.recurring_dates = [];
    }

    // Clean up intermediate fields not needed in final output
    delete analysis.recurring_days_of_week;
    delete analysis.recurring_day_of_week;  // compatibilidad con respuestas antiguas
    delete analysis.recurring_specific_days;
    delete analysis.recurring_month_start;
    delete analysis.recurring_month_end;

    // Extract token usage
    const tokensUsed = response.usage?.total_tokens || 0;

    console.log(`[EVENT_VISION] ✅ Analysis completed - Confidence: ${analysis.confidence}, Tokens: ${tokensUsed}`);
    console.log(`[EVENT_VISION] 📋 "${analysis.event_name}" | ${analysis.date} ${analysis.time || ''} | ${analysis.location || 'Sin ubicación'}`);
    console.log(`[EVENT_VISION] 🏷️  category=${analysis.category} | subcategory=${analysis.subcategory ?? 'null'} | tags=${JSON.stringify(analysis.tags ?? [])}`);
    console.log(`[EVENT_VISION] ✨ mood=${analysis.event_features?.mood ?? 'null'} | vibe=${analysis.event_features?.vibe ?? 'null'} | timeOfDay=${analysis.event_features?.timeOfDay ?? 'null'} | socialSetting=${analysis.event_features?.socialSetting ?? 'null'}`);
    if (analysis.is_recurring) {
      console.log(`[EVENT_VISION] 🔁 recurring=true | pattern="${analysis.recurring_pattern}" | dates=${JSON.stringify(analysis.recurring_dates)}`);
    }

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
