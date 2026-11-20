import React, { useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { sendOtpCode, verifyOtpCode } from '../api'
import { useAuthStore } from '../stores/authStore'
import { BrandMark } from '../ui/BrandMark'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { theme } from '../ui/theme'

export default function LoginScreen() {
  const setSession = useAuthStore((s) => s.setSession)

  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const onSendCode = async () => {
    const v = email.trim().toLowerCase()
    if (!v.includes('@')) {
      setError('Email invalide')
      return
    }
    setLoading(true)
    setError(null)
    setInfo(null)
    try {
      const res = await sendOtpCode(v)
      setInfo(res.message || 'Code envoyé')
      setStep('code')
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || e?.response?.data?.detail || e?.message || 'Erreur')
    } finally {
      setLoading(false)
    }
  }

  const onVerify = async () => {
    const vEmail = email.trim().toLowerCase()
    const vCode = code.trim()
    if (vCode.length !== 6) {
      setError('Le code doit contenir 6 chiffres')
      return
    }
    setLoading(true)
    setError(null)
    setInfo(null)
    try {
      const res = await verifyOtpCode(vEmail, vCode)
      setSession(res.token, res.user)
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || e?.response?.data?.detail || e?.message || 'Erreur')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <BrandMark size={58} />
        <Text style={styles.title}>ANZAR</Text>
        <Text style={styles.subtitle}>Connexion par code email</Text>
      </View>

      {(error || info) && (
        <Card style={[styles.notice, error ? styles.noticeError : styles.noticeInfo]}>
          <Text style={[styles.noticeText, error ? { color: theme.colors.danger } : { color: theme.colors.success }]}>
            {error || info}
          </Text>
        </Card>
      )}

      {step === 'email' ? (
        <Card variant="elevated" style={styles.panel}>
          <Text style={styles.label}>Email</Text>
          <Input
            value={email}
            onChangeText={setEmail}
            placeholder="ex: toi@gmail.com"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Button title="Envoyer le code" onPress={() => void onSendCode()} loading={loading} style={{ marginTop: 12 }} />
          <Text style={styles.hint}>
            Astuce : vérifie tes spams si tu ne reçois pas le code.
          </Text>
        </Card>
      ) : (
        <Card variant="elevated" style={styles.panel}>
          <Text style={styles.label}>Code (6 chiffres)</Text>
          <Input
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            keyboardType="number-pad"
            maxLength={6}
          />
          <Button title="Se connecter" onPress={() => void onVerify()} loading={loading} style={{ marginTop: 12 }} />
          <Button
            title="Changer d’email"
            variant="ghost"
            onPress={() => {
              setStep('email')
              setCode('')
              setError(null)
              setInfo(null)
            }}
            disabled={loading}
            style={{ marginTop: 6 }}
          />
        </Card>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.bg0,
    padding: 18,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    color: theme.colors.text,
    fontSize: 34,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 14,
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
  },
  panel: {
    padding: 16,
  },
  label: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 10,
  },
  hint: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: 10,
    lineHeight: 18,
  },
  notice: {
    marginBottom: 12,
  },
  noticeError: {
    borderColor: '#7f1d1d',
  },
  noticeInfo: {
    borderColor: '#14532d',
  },
  noticeText: {
    textAlign: 'center',
    fontWeight: '700',
  },
})
