import React from 'react'
import { View, ViewProps, StyleSheet } from 'react-native'
import { theme } from './theme'

export function Card(props: ViewProps & { variant?: 'default' | 'elevated' }) {
  const variant = props.variant ?? 'default'
  return (
    <View
      {...props}
      style={[
        styles.base,
        variant === 'elevated' && styles.elevated,
        props.style,
      ]}
    />
  )
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: theme.colors.bg1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    padding: 14,
  },
  elevated: {
    backgroundColor: theme.colors.bg2,
    ...theme.shadow.soft,
  },
})

