import React from 'react'
import { Pressable, Text, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { theme } from './theme'

type Props = {
  title: string
  onPress: () => void
  loading?: boolean
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  style?: ViewStyle
}

export function Button({ title, onPress, loading, disabled, variant = 'primary', style }: Props) {
  const isDisabled = disabled || loading

  if (variant === 'primary') {
    return (
      <Pressable onPress={onPress} disabled={isDisabled} style={[{ opacity: isDisabled ? 0.65 : 1 }, style]}>
        <LinearGradient
          colors={[theme.colors.brandA, theme.colors.brandB]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.primary}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{title}</Text>}
        </LinearGradient>
      </Pressable>
    )
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={[
        styles.base,
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost,
        variant === 'danger' && styles.danger,
        { opacity: isDisabled ? 0.65 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'danger' ? theme.colors.danger : '#fff'} />
      ) : (
        <Text
          style={[
            styles.text,
            variant === 'secondary' && { color: theme.colors.text },
            variant === 'ghost' && { color: theme.colors.textMuted },
            variant === 'danger' && { color: theme.colors.danger },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  primary: {
    borderRadius: theme.radius.lg,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  base: {
    borderRadius: theme.radius.lg,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  secondary: {
    backgroundColor: theme.colors.bg1,
    borderColor: theme.colors.border,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  danger: {
    backgroundColor: theme.colors.bg2,
    borderColor: '#7f1d1d',
  },
  text: { color: '#fff', fontWeight: '800', fontSize: 15 },
})

