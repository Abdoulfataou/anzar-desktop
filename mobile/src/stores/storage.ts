import AsyncStorage from '@react-native-async-storage/async-storage'

// Adaptateur zustand persist (AsyncStorage)
export const zustandStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return AsyncStorage.getItem(name)
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await AsyncStorage.setItem(name, value)
  },
  removeItem: async (name: string): Promise<void> => {
    await AsyncStorage.removeItem(name)
  },
}

