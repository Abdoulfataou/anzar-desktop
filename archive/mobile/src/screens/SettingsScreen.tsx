import React, { useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useSettingsStore } from '../stores/settingsStore'
import { useAuthStore } from '../stores/authStore'
import { Card } from '../ui/Card'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { theme } from '../ui/theme'

export default function SettingsScreen() {
  const user = useAuthStore((s) => s.user)
  const clearSession = useAuthStore((s) => s.clearSession)
  const backendUrl = useSettingsStore((s) => s.backendUrl)
  const setBackendUrl = useSettingsStore((s) => s.setBackendUrl)

  const [draft, setDraft] = useState(backendUrl)
  const [saved, setSaved] = useState<string | null>(null)

  const save = () => {
    const next = draft.trim().replace(/\/+$/, '')
    setBackendUrl(next)
    setSaved('Sauvegardé')
    setTimeout(() => setSaved(null), 1200)
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Paramètres</Text>

      <Card variant="elevated" style={styles.card}>
        <Text style={styles.label}>Compte</Text>
        <Text style={styles.value}>{user?.email || '—'}</Text>
      </Card>

      <Card variant="elevated" style={styles.card}>
        <Text style={styles.label}>URL Backend</Text>
        <Text style={styles.hint}>
          Sur téléphone, utilise l’IP de ton PC en dev (ex: http://192.168.1.10:8000).
        </Text>
        <Input
          value={draft}
          onChangeText={setDraft}
          autoCapitalize="none"
          placeholder="http://..."
        />
        <Button title="Enregistrer" onPress={save} style={{ marginTop: 12 }} />
        {saved ? <Text style={styles.saved}>{saved}</Text> : null}
      </Card>

      <Button title="Se déconnecter" variant="danger" onPress={() => clearSession()} style={{ marginTop: 8 }} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg0, padding: 16 },
  title: { color: theme.colors.text, fontSize: 22, fontWeight: '900', marginBottom: 14 },
  card: {
    marginBottom: 12,
  },
  label: { color: theme.colors.text, fontWeight: '900', marginBottom: 8 },
  value: { color: theme.colors.textMuted },
  hint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18, marginBottom: 10 },
  saved: { color: theme.colors.success, marginTop: 10, textAlign: 'center', fontWeight: '800' },
})
