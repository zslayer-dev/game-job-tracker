import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Supabase Redirect URLs와 Edge Function CORS가 이 주소를 정확히 쓰므로 포트를 고정한다
  server: { port: 5173, strictPort: true },
})
