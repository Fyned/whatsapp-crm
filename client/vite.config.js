import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3005, // İstediğin portu buraya sabitliyoruz
    strictPort: true, // Eğer 3005 doluysa hata versin, başka porta geçmesin
  }
})