import React, { useMemo, useState } from 'react'
import { View, Text, StyleSheet, FlatList, KeyboardAvoidingView, Platform } from 'react-native'
import { chat, type ChatMessage } from '../api'
import { Card } from '../ui/Card'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { theme } from '../ui/theme'

type UiMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16)
}

export default function ChatScreen() {
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const apiMessages = useMemo<ChatMessage[]>(() => {
    const base: ChatMessage[] = [
      {
        role: 'system',
        content:
          "Tu es ANZAR, un assistant de vibecoding. Réponds en français, sois concis et propose une prochaine étape claire.",
      },
    ]
    for (const m of messages) base.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })
    return base
  }, [messages])

  const send = async () => {
    const content = input.trim()
    if (!content || loading) return

    setInput('')
    const userMsg: UiMessage = { id: uid(), role: 'user', content }
    setMessages((prev) => [userMsg, ...prev])

    setLoading(true)
    try {
      const data = await chat([...apiMessages, { role: 'user', content }], 'deepseek')
      const answer = data?.choices?.[0]?.message?.content || '…'
      const aiMsg: UiMessage = { id: uid(), role: 'assistant', content: answer }
      setMessages((prev) => [aiMsg, ...prev])
    } catch (e: any) {
      const msg =
        e?.response?.data?.error?.message ||
        e?.response?.data?.detail ||
        e?.message ||
        "Erreur de connexion au backend"
      const aiMsg: UiMessage = { id: uid(), role: 'assistant', content: `❌ ${msg}` }
      setMessages((prev) => [aiMsg, ...prev])
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
    >
      <FlatList
        data={messages}
        inverted
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <View style={[styles.row, item.role === 'user' ? styles.rowUser : styles.rowAi]}>
            <Card style={[styles.bubble, item.role === 'user' ? styles.bubbleUser : styles.bubbleAi]}>
              <Text style={styles.bubbleText}>{item.content}</Text>
            </Card>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Card variant="elevated" style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Bienvenue</Text>
              <Text style={styles.emptyText}>
                Décris ce que tu veux créer (site, app, doc). Je te guide étape par étape.
              </Text>
              <View style={styles.chips}>
                {[
                  'Crée un site vitrine moderne',
                  'Crée une petite app de gestion',
                  'Corrige mon rapport de stage',
                ].map((p) => (
                  <Button
                    key={p}
                    title={p}
                    variant="secondary"
                    onPress={() => setInput(p)}
                    style={styles.chipBtn}
                  />
                ))}
              </View>
            </Card>
          </View>
        }
      />

      <View style={styles.inputRow}>
        <Input
          value={input}
          onChangeText={setInput}
          placeholder="Écris ton message…"
          style={styles.input}
          multiline
        />
        <Button title={loading ? '…' : 'Envoyer'} onPress={() => void send()} disabled={loading} style={styles.sendBtn} />
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg0 },
  row: { flexDirection: 'row', marginBottom: 10 },
  rowUser: { justifyContent: 'flex-end' },
  rowAi: { justifyContent: 'flex-start' },
  bubble: {
    padding: 12,
    borderRadius: theme.radius.lg,
    maxWidth: '92%',
  },
  bubbleUser: {
    backgroundColor: '#0b3a8f',
    borderColor: '#1d4ed8',
  },
  bubbleAi: {
    backgroundColor: theme.colors.bg1,
    borderColor: theme.colors.border,
  },
  bubbleText: { color: theme.colors.text, fontSize: 14, lineHeight: 20 },
  inputRow: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.bg0,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sendBtn: { width: 110 },
  emptyWrap: { paddingVertical: 26, paddingHorizontal: 10 },
  emptyCard: { padding: 16 },
  emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '900', marginBottom: 6 },
  emptyText: { color: theme.colors.textMuted, lineHeight: 20 },
  chips: { marginTop: 12, gap: 10 },
  chipBtn: { paddingVertical: 10 },
})
