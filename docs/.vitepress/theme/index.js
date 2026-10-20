import DefaultTheme from 'vitepress/theme'
import Landing from './Landing.vue'
import './theme.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Landing', Landing)
  },
}
