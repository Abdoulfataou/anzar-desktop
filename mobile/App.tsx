import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// Screens
import DashboardScreen from './src/screens/DashboardScreen';
import NewProjectScreen from './src/screens/NewProjectScreen';
import ProjectsScreen from './src/screens/ProjectsScreen';
import AgentsScreen from './src/screens/AgentsScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer>
          <Tab.Navigator
            screenOptions={({ route }) => ({
              tabBarIcon: ({ focused, color, size }) => {
                let iconName;

                switch (route.name) {
                  case 'Dashboard':
                    iconName = focused ? 'home' : 'home-outline';
                    break;
                  case 'New Project':
                    iconName = focused ? 'add-circle' : 'add-circle-outline';
                    break;
                  case 'Projects':
                    iconName = focused ? 'folder' : 'folder-outline';
                    break;
                  case 'Agents':
                    iconName = focused ? 'hardware-chip' : 'hardware-chip-outline';
                    break;
                  case 'Settings':
                    iconName = focused ? 'settings' : 'settings-outline';
                    break;
                  default:
                    iconName = 'help-circle-outline';
                }

                return <Icon name={iconName} size={size} color={color} />;
              },
              tabBarActiveTintColor: '#3b82f6',
              tabBarInactiveTintColor: '#9ca3af',
              tabBarStyle: {
                backgroundColor: '#1f2937',
                borderTopColor: '#374151',
              },
              headerStyle: {
                backgroundColor: '#111827',
              },
              headerTintColor: '#fff',
              headerTitleStyle: {
                fontWeight: 'bold',
              },
            })}
          >
            <Tab.Screen name="Dashboard" component={DashboardScreen} />
            <Tab.Screen name="New Project" component={NewProjectScreen} />
            <Tab.Screen name="Projects" component={ProjectsScreen} />
            <Tab.Screen name="Agents" component={AgentsScreen} />
            <Tab.Screen name="Settings" component={SettingsScreen} />
          </Tab.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}