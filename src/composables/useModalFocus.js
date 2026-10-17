import { nextTick, onBeforeUnmount, toValue, watch } from 'vue'

const focusableSelector = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]'

function canFocus(element) {
  return element?.isConnected && typeof element.focus === 'function'
    && !element.closest('[inert], [hidden], [aria-hidden="true"], .event-drawer-leave-active')
    && !element.matches(':disabled') && element.getClientRects().length > 0
    && !['hidden', 'collapse'].includes(getComputedStyle(element).visibility)
}

function visibleOpener(element) {
  if (!canFocus(element)) return false
  const rect = element.getBoundingClientRect()
  const viewport = window.visualViewport
  const top = viewport?.offsetTop || 0
  const left = viewport?.offsetLeft || 0
  return rect.bottom > top && rect.right > left
    && rect.top < top + (viewport?.height || window.innerHeight)
    && rect.left < left + (viewport?.width || window.innerWidth)
}

export function useModalFocus({ dialog, active, opener, fallbackSelector = '', initialFocus }) {
  let currentDialog = null
  let returnTarget = null
  let lastFocused = null
  let listening = false
  let restorePending = false
  let generation = 0

  function controls() {
    return [...(currentDialog?.querySelectorAll(focusableSelector) || [])]
      .filter((element) => element.tabIndex >= 0 && canFocus(element))
  }

  function focusInside() {
    const preferred = lastFocused || toValue(initialFocus)
    const target = currentDialog?.contains(preferred) && canFocus(preferred)
      ? preferred
      : controls()[0] || currentDialog
    target?.focus({ preventScroll: true })
  }

  function containFocus(event) {
    if (!listening) return
    if (currentDialog?.contains(event.target)) lastFocused = event.target
    else focusInside()
  }

  function trapTab(event) {
    if (!listening || event.key !== 'Tab' || event.defaultPrevented) return
    const items = controls()
    const index = items.indexOf(document.activeElement)
    const next = index < 0
      ? event.shiftKey ? items.length - 1 : 0
      : (index + (event.shiftKey ? -1 : 1) + items.length) % items.length
    event.preventDefault()
    const target = items[next] || currentDialog
    target?.focus()
  }

  function stopListening() {
    listening = false
    document.removeEventListener('keydown', trapTab)
    document.removeEventListener('focusin', containFocus)
  }

  function close() {
    const restore = (listening || restorePending) && (document.activeElement === document.body
      || currentDialog?.contains(document.activeElement))
    const target = returnTarget
    const closingDialog = currentDialog
    const token = ++generation
    stopListening()
    currentDialog = null
    returnTarget = null
    lastFocused = null
    restorePending = false
    if (!restore) return
    nextTick(() => {
      if (token !== generation || (document.activeElement !== document.body
        && !closingDialog?.contains(document.activeElement))) return
      const fallback = toValue(fallbackSelector)
      const destination = visibleOpener(target) ? target : fallback
        ? [...document.querySelectorAll(fallback)].find(visibleOpener)
        : null
      destination?.focus({ preventScroll: true })
    })
  }

  const stop = watch(
    [() => toValue(dialog), () => Boolean(toValue(active))],
    ([element, enabled]) => {
      if (currentDialog && currentDialog !== element) close()
      if (!element) return
      if (!currentDialog) {
        currentDialog = element
        returnTarget = toValue(opener) || document.activeElement
        if (!element.hasAttribute('tabindex')) element.tabIndex = -1
      }
      const token = ++generation
      if (listening) restorePending = document.activeElement === document.body
        || currentDialog.contains(document.activeElement)
      stopListening()
      if (!enabled) return
      restorePending = false
      listening = true
      document.addEventListener('keydown', trapTab)
      document.addEventListener('focusin', containFocus)
      nextTick(() => {
        if (token !== generation || !listening || !canFocus(currentDialog)) return
        if (!currentDialog.contains(document.activeElement)) focusInside()
      })
    },
    { immediate: true, flush: 'sync' },
  )

  onBeforeUnmount(() => {
    stop()
    close()
  })
}
