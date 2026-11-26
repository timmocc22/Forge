import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { useAppearanceStore } from './stores/appearance';
import './styles/index.less';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
useAppearanceStore(pinia);
app.mount('#app');
