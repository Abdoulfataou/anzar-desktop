import React from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { createStackNavigator } from '@react-navigation/stack'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/Ionicons'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

import LoginScreen from './src/screens/LoginScreen'
import ChatScreen from './src/screens/ChatScreen'
import SettingsScreen from './src/screens/SettingsScreen'
import { useAuthStore } from './src/stores/authStore'

const Tab = createBottomTabNavigator()
const Stack = createStackNavigator()

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          const iconName =
            route.name === 'Chat'
              ? focused
                ? 'chatbubbles'
                : 'chatbubbles-outline'
              : focused
                ? 'settings'
                : 'settings-outline'
          return <Icon name={iconName} size={size} color={color} />
        },
        tabBarActiveTintColor: '#3b82f6',
        tabBarInactiveTintColor: '#9ca3af',
        tabBarStyle: { backgroundColor: '#0f172a', borderTopColor: '#1f2937' },
        headerStyle: { backgroundColor: '#0b1220' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
      })}
    >
      <Tab.Screen name="Chat" component={ChatScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  )
}

export default function App() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            {isLoggedIn ? (
              <Stack.Screen name="Main" component={MainTabs} />
            ) : (
              <Stack.Screen name="Login" component={LoginScreen} />
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
