import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'

export function useMobileComposerInput({ textarea, mobile, draft }) {
  let observer
  let fitted = false
  function fit() {
    const input = textarea.value
    if (!input) return
    if (!mobile()) {
      if (fitted) input.style.removeProperty('height')
      fitted = false
      return
    }
    fitted = true
    input.style.height = '64px'
    input.style.height = `${Math.max(64, Math.min(160, input.scrollHeight))}px`
  }
  watch([mobile, draft], () => nextTick(fit), { flush: 'post' })
  onMounted(() => {
    let width = 0
    observer = new ResizeObserver(() => {
      const next = textarea.value?.clientWidth || 0
      if (width === next) return
      width = next
      fit()
    })
    if (textarea.value) observer.observe(textarea.value)
    fit()
  })
  onBeforeUnmount(() => observer?.disconnect())
}
