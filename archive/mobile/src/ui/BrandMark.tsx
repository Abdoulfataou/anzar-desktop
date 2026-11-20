import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { theme } from './theme'

export function BrandMark(props: { size?: number }) {
  const size = props.size ?? 56
  const radius = Math.round(size * 0.28)
  return (
    <View style={{ alignItems: 'center' }}>
      <LinearGradient
        colors={[theme.colors.brandA, theme.colors.brandB]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.mark, { width: size, height: size, borderRadius: radius }]}
      >
        <Text style={styles.text}>AZ</Text>
      </LinearGradient>
    </View>
  )
}

const styles = StyleSheet.create({
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#fff',
    fontWeight: '900',
    letterSpacing: 0.5,
  },
})

