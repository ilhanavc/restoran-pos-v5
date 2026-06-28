// MUST be the very first import (React Navigation / gesture-handler requirement).
import 'react-native-gesture-handler';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and sets up the Expo Go / dev-client environment correctly.
registerRootComponent(App);
