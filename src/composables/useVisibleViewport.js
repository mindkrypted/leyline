import { onMounted, onUnmounted, shallowRef } from 'vue'

export function useVisibleViewport() {
  const viewport = shallowRef({ width: window.innerWidth, height: window.innerHeight, top: 0 })
  let frame = 0

  function update() {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const visible = window.visualViewport
      if (visible && Math.abs(visible.scale - 1) > 0.01) return
      const height = visible?.height || window.innerHeight
      const top = visible?.offsetTop || 0
      viewport.value = { width: visible?.width || window.innerWidth, height, top }
      const style = document.documentElement.style
      style.setProperty('--app-height', `${height}px`)
      style.setProperty('--app-top', `${top}px`)
      style.setProperty('--app-bottom', `${Math.max(0, window.innerHeight - top - height)}px`)
    })
  }

  onMounted(() => {
    update()
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
  })
  onUnmounted(() => {
    cancelAnimationFrame(frame)
    window.removeEventListener('resize', update)
    window.visualViewport?.removeEventListener('resize', update)
    window.visualViewport?.removeEventListener('scroll', update)
    for (const name of ['--app-height', '--app-top', '--app-bottom']) document.documentElement.style.removeProperty(name)
  })
  return viewport
}
