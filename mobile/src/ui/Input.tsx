import React from 'react'
import { TextInput, TextInputProps, StyleSheet } from 'react-native'
import { theme } from './theme'

export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={theme.colors.textFaint}
      {...props}
      style={[styles.input, props.style]}
    />
  )
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: theme.colors.bg0,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: theme.colors.text,
    fontSize: 14,
  },
})

