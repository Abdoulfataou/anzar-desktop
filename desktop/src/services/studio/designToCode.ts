/**
 * DesignToCode — Service de conversion design → code.
 *
 * Inspiré de TRAE SOLO Semi D2C (Design-to-Code):
 *  - Upload d'image (screenshot, mockup, Figma export)
 *  - Analyse via VisionAgent (description structurée du design)
 *  - Génération de code via CoderAgent à partir de l'analyse
 *  - Streaming SSE des fichiers générés
 *
 * Flux:
 *  1. Image → VisionAgent → description JSON structurée
 *  2. Description → CoderAgent → fichiers HTML/CSS/React
 *  3. Fichiers streamés vers le studio pour preview live
 */

import { getBackendUrl, getAuthHeaders, type OnAgentUpdate } from '@/services/projectGeneration';

// ============================================================================
// TYPES
// ============================================================================

export interface DesignAnalysis {
  /** Layout structure (grid, flex, columns) */
  layout: string;
  /** Color palette extracted */
  colors: string[];
  /** Typography (fonts, sizes, weights) */
  typography: string;
  /** Components identified (navbar, hero, cards, footer...) */
  components: string[];
  /** Interactions detected (hover, animations, transitions) */
  interactions: string[];
  /** Full textual description */
  description: string;
  /** Raw AI response */
  raw: string;
}

export interface DesignToCodeRequest {
  /** Base64-encoded image */
  imageData?: string;
  /** Image URL (alternative) */
  imageUrl?: string;
  /** Target framework */
  framework: 'html' | 'react' | 'vue';
  /** CSS approach */
  cssMode: 'tailwind' | 'css-modules' | 'inline' | 'vanilla';
  /** Whether to generate responsive code */
  responsive: boolean;
  /** Additional instructions from user */
  instructions?: string;
  /** Existing project files for context */
  existingFiles?: Record<string, string>;
}

export interface DesignToCodeResult {
  success: boolean;
  files: Record<string, string>;
  analysis?: DesignAnalysis;
  error?: string;
  tokensUsed?: number;
}

// ============================================================================
// DESIGN ANALYSIS PROMPT (for VisionAgent)
// ============================================================================

const DESIGN_ANALYSIS_PROMPT = `Tu es un expert en UI/UX et développement frontend. Analyse cette maquette/screenshot et décris PRÉCISÉMENT le design pour qu'un développeur puisse le reproduire en code.

STRUCTURE TA RÉPONSE EN JSON:
{
  "layout": "Description du layout global (flexbox, grid, colonnes, structure)",
  "sections": [
    {
      "name": "Nom de la section (ex: navbar, hero, features, footer)",
      "position": "Position dans la page (haut, milieu, bas)",
      "layout": "Layout interne (flex row, grid 3 cols, stack vertical)",
      "elements": ["Liste des éléments visibles (logo, bouton, texte, image, icône)"],
      "styles": "Styles notables (couleur fond, border-radius, shadows, spacing)"
    }
  ],
  "colors": {
    "primary": "#hex",
    "secondary": "#hex",
    "background": "#hex",
    "text": "#hex",
    "accent": "#hex"
  },
  "typography": {
    "headingFont": "Type de police (serif, sans-serif, monospace)",
    "bodyFont": "Type de police du corps",
    "sizes": "Tailles approximatives (titre: 48px, sous-titre: 24px, body: 16px)"
  },
  "components": ["Liste des composants UI (boutons, cartes, formulaires, modals, navigation)"],
  "interactions": ["Effets hover, animations, transitions visibles ou suggérées"],
  "responsive": "Indices de responsive design (breakpoints, éléments adaptatifs)",
  "textContent": {
    "headings": ["Tous les titres/headings visibles"],
    "paragraphs": ["Textes de paragraphe visibles"],
    "buttons": ["Labels des boutons"],
    "links": ["Textes des liens"]
  }
}

RÈGLES:
1. Sois EXHAUSTIF — ne rate aucun élément visible
2. Donne des VALEURS PRÉCISES pour les couleurs (hex), tailles (px), espacements
3. Décris le CONTENU TEXTUEL exact visible dans l'image
4. Identifie les PATTERNS de design (card grid, hero section, sidebar layout)
5. Note les DÉTAILS visuels (ombres, gradients, border-radius, opacité)`;

// ============================================================================
// SERVICE
// ============================================================================

class DesignToCodeService {

  /**
   * Convert a design image to code via the backend pipeline.
   * Streams SSE events for real-time updates.
   */
  async convert(
    projectId: string,
    request: DesignToCodeRequest,
    onUpdate: OnAgentUpdate,
    signal?: AbortSignal,
  ): Promise<DesignToCodeResult> {
    const url = `${getBackendUrl()}/api/projects/${projectId}/design-to-code`;

    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      signal,
      body: JSON.stringify({
        image_data: request.imageData || null,
        image_url: request.imageUrl || null,
        framework: request.framework,
        css_mode: request.cssMode,
        responsive: request.responsive,
        instructions: request.instructions || '',
        existing_files: request.existingFiles || {},
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      return { success: false, files: {}, error: `HTTP ${response.status}: ${text}` };
    }

    if (!response.body) {
      return { success: false, files: {}, error: 'No response body' };
    }

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const files: Record<string, string> = {};
    let analysis: DesignAnalysis | undefined;
    let tokensUsed = 0;
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const event = JSON.parse(trimmed);

            switch (event.type) {
              case 'step':
                onUpdate({
                  type: 'step',
                  action: event.action,
                  label: event.label,
                  file: event.file || null,
                });
                break;

              case 'analysis':
                analysis = event.analysis;
                onUpdate({
                  type: 'step',
                  action: 'analyzing',
                  label: 'Design analysé — génération du code...',
                  file: null,
                });
                break;

              case 'file':
                files[event.path] = event.content;
                onUpdate({
                  type: 'file',
                  path: event.path,
                  content: event.content,
                });
                break;

              case 'done':
                tokensUsed = event.tokens_used || 0;
                break;

              case 'error':
                return {
                  success: false,
                  files,
                  analysis,
                  error: event.message || event.error || 'Unknown error',
                };
            }
          } catch {
            // skip non-JSON lines
          }
        }
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        return { success: false, files, analysis, error: 'Annulé' };
      }
      throw e;
    }

    return {
      success: Object.keys(files).length > 0,
      files,
      analysis,
      tokensUsed,
    };
  }

  /**
   * Convert a File object to base64 string.
   */
  async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data:image/...;base64, prefix
        const base64 = result.split(',')[1] || result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * Validate that an image is suitable for design analysis.
   */
  validateImage(file: File): { valid: boolean; error?: string } {
    const maxSize = 10 * 1024 * 1024; // 10MB
    const validTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

    if (!validTypes.includes(file.type)) {
      return { valid: false, error: 'Format non supporté. Utilisez PNG, JPEG, WebP ou GIF.' };
    }
    if (file.size > maxSize) {
      return { valid: false, error: 'Image trop grande (max 10 Mo).' };
    }
    return { valid: true };
  }

  /**
   * Get the analysis prompt for the VisionAgent.
   */
  getAnalysisPrompt(): string {
    return DESIGN_ANALYSIS_PROMPT;
  }
}

export const designToCode = new DesignToCodeService();
