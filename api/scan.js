// Vercel Serverless Function: AI Pokédex
// Version 1.4: Using models identified for the user's specific API key
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { image, query } = req.body;
    const API_KEY = process.env.GEMINI_API_KEY;

    if (!API_KEY) {
        return res.status(500).json({ error: 'GEMINI_API_KEY fehlerhaft konfiguriert.' });
    }

    // List based on your key's actual capabilities (gemini-2.0 / 2.5)
    const modelsToTry = [
        'gemini-2.0-flash',
        'gemini-2.0-flash-001',
        'gemini-2.0-flash-lite',
        'gemini-2.5-flash',
        'gemini-2.5-pro'
    ];

    let payload = {
        contents: [{
            parts: []
        }],
        generationConfig: { response_mime_type: "application/json" }
    };

    if (image && image !== 'base64_placeholder') {
        const base64Data = image.includes(',') ? image.split(',')[1] : image;
        payload.contents[0].parts.push({ text: "Identifiziere das Meereslebewesen. JSON Format: { 'name': '...', 'description': '...', 'visual': '...', 'advice': '...' }" });
        payload.contents[0].parts.push({ inline_data: { mime_type: "image/jpeg", data: base64Data } });
    } else if (query) {
        payload.contents[0].parts.push({ text: `Meereslebewesen-Bestimmung für: "${query}". JSON Format: { 'name': '...', 'description': '...', 'visual': '...', 'advice': '...' }` });
    }

    let lastError = "Kein Modell antwortete.";

    for (const modelId of modelsToTry) {
        try {
            // Version check: Try V1BETA for experimental models
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${API_KEY}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (result.error) {
                lastError = `[${modelId}] ${result.error.message}`;
                continue;
            }

            if (result.candidates && result.candidates[0].content.parts[0].text) {
                const text = result.candidates[0].content.parts[0].text;
                return res.status(200).json(JSON.parse(text));
            }
        } catch (err) {
            lastError = `[${modelId}] Systemfehler: ${err.message}`;
            continue;
        }
    }

    res.status(500).json({ 
        error: 'Alle spezifischen Modelle schlugen fehl.',
        details: lastError 
    });
}
