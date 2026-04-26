import { useCallback, useState } from 'react'

export type AnzarAnalysisResult =
  | { success: true; data: string; timestamp: number }
  | { success: false; error: string; timestamp: number }

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Impossible de lire le fichier'))
    reader.readAsDataURL(file)
  })
}

/**
 * Hook V1 (UI-first) pour analyse de fichiers.
 *
 * Note: Pour l’instant, on renvoie un résultat “soft-fail” car l’intégration
 * Vision/PDF dépend du backend (upload, OCR, etc.). On garde une API stable
 * pour brancher ensuite DeepSeek/Kimi via le backend.
 */
export function useAnzarIA() {
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearError = useCallback(() => setError(null), [])

  const analyzeImage = useCallback(async (file: File, _prompt: string): Promise<AnzarAnalysisResult> => {
    setIsAnalyzing(true)
    setError(null)
    try {
      // Préparer les données (on garde ce code, utile quand on branchera Vision)
      await readFileAsDataUrl(file)
      return {
        success: false,
        error: "Analyse d'image non disponible (V1). À brancher via le backend.",
        timestamp: Date.now(),
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur analyse image'
      setError(msg)
      return { success: false, error: msg, timestamp: Date.now() }
    } finally {
      setIsAnalyzing(false)
    }
  }, [])

  const analyzeDocument = useCallback(async (file: File, _prompt: string): Promise<AnzarAnalysisResult> => {
    setIsAnalyzing(true)
    setError(null)
    try {
      // Placeholder pour PDF/TXT/JSON: on garde une API stable
      await file.arrayBuffer()
      return {
        success: false,
        error: 'Analyse document non disponible (V1). À brancher via le backend.',
        timestamp: Date.now(),
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur analyse document'
      setError(msg)
      return { success: false, error: msg, timestamp: Date.now() }
    } finally {
      setIsAnalyzing(false)
    }
  }, [])

  return { analyzeImage, analyzeDocument, isAnalyzing, error, clearError }
}

